<?php

namespace App\Http\Controllers\API\Social;

use App\Events\MessageSent;
use App\Events\UserTyping;
use App\Http\Controllers\Controller;
use App\Jobs\Notification\SendNewMessageEmail;
use App\Jobs\SendPushNotification;
use App\Models\Message;
use App\Models\User;
use App\Models\UserNotification;
use App\Services\Storage\CloudinaryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class MessageController extends Controller
{
    public function __construct(private readonly CloudinaryService $cloudinary) {}

    // Conversations list

    public function conversations(Request $request): JsonResponse
    {
        $userId = $request->user()->id;
        $seen   = [];

        $conversations = Message::query()
            ->where(function ($q) use ($userId) {
                $q->where('sender_id', $userId)
                    ->orWhere('receiver_id', $userId);
            })
            ->with([
                'sender:id,name,first_name,last_name,profile_picture,student_record_id',
                'sender.studentRecord:id,course,photo',
                'receiver:id,name,first_name,last_name,profile_picture,student_record_id',
                'receiver.studentRecord:id,course,photo',
            ])
            ->latest()
            ->get()
            ->filter(function ($message) use ($userId, &$seen) {
                $otherId = $message->sender_id === $userId
                    ? $message->receiver_id
                    : $message->sender_id;

                if (!$otherId)              return false;
                if (isset($seen[$otherId])) return false;

                $seen[$otherId] = true;
                return true;
            })
            ->map(function ($message) use ($userId) {
                $other = $message->sender_id === $userId
                    ? $message->receiver
                    : $message->sender;

                if (!$other) return null;

                return [
                    'id'           => $message->id,
                    'body'         => $message->body,
                    'image_path'   => $message->image_path,
                    'image_url'    => $message->image_url,
                    'is_read'      => $message->is_read,
                    'sender_id'    => $message->sender_id,
                    'receiver_id'  => $message->receiver_id,
                    'created_at'   => $message->created_at->toISOString(),
                    'sender'       => $message->sender,
                    'receiver'     => $message->receiver,
                    'other_user'   => $other,
                    'unread_count' => Message::where('sender_id', $other->id)
                        ->where('receiver_id', $userId)
                        ->where('is_read', false)
                        ->count(),
                ];
            })
            ->filter()
            ->values();

        return response()->json($conversations);
    }

    // Unread badge count 

    public function unreadCount(Request $request): JsonResponse
    {
        $count = Message::unreadFor($request->user()->id)->count();
        return response()->json(['unread_count' => $count]);
    }

    /**
     * Search students/alumni to start a conversation (by name, course, or batch year).
     * GET /api/messages/search?q=&batch_year=
     */
    public function searchUsers(Request $request): JsonResponse
    {
        $q = trim((string) $request->get('q', ''));
        $batchYear = $request->get('batch_year');
        $limit = min(max((int) $request->get('limit', 20), 1), 50);
        $myId = (int) $request->user()->id;

        if ($q === '' && blank($batchYear)) {
            return response()->json(['data' => []]);
        }

        // Allow typing a graduation year in the free-text box (e.g. "2026").
        if (blank($batchYear) && preg_match('/^\d{4}$/', $q)) {
            $batchYear = $q;
        }

        $users = User::query()
            ->with('studentRecord:id,course,graduation_year,photo,student_no')
            ->where('id', '!=', $myId)
            ->whereIn('role', ['student', 'alumni'])
            ->when($q !== '' && ! preg_match('/^\d{4}$/', $q), function ($query) use ($q) {
                $query->where(function ($sub) use ($q) {
                    $sub->where('name', 'like', "%{$q}%")
                        ->orWhere('first_name', 'like', "%{$q}%")
                        ->orWhere('last_name', 'like', "%{$q}%")
                        ->orWhere('email', 'like', "%{$q}%")
                        ->orWhere('course', 'like', "%{$q}%")
                        ->orWhere('student_id', 'like', "%{$q}%")
                        ->orWhereHas('studentRecord', function ($student) use ($q) {
                            $student->where('first_name', 'like', "%{$q}%")
                                ->orWhere('last_name', 'like', "%{$q}%")
                                ->orWhere('student_no', 'like', "%{$q}%")
                                ->orWhere('course', 'like', "%{$q}%");
                        });
                });
            })
            ->when(filled($batchYear), function ($query) use ($batchYear) {
                $year = (int) $batchYear;
                $query->where(function ($sub) use ($year) {
                    $sub->where('graduation_year', $year)
                        ->orWhereHas('studentRecord', fn ($s) => $s->where('graduation_year', $year));
                });
            })
            ->orderBy('name')
            ->limit($limit)
            ->get();

        return response()->json([
            'data' => $users->map(fn (User $user) => [
                'id'              => $user->id,
                'user_id'         => $user->id,
                'account_user_id' => $user->id,
                'name'            => $this->displayName($user),
                'profile_picture' => $user->profile_picture ?: $user->studentRecord?->photo,
                'course'          => $user->studentRecord?->course ?? $user->course,
                'batch_year'      => $user->studentRecord?->graduation_year ?? $user->graduation_year,
                'graduation_year' => $user->studentRecord?->graduation_year ?? $user->graduation_year,
                'student_id'      => $user->student_id ?? $user->studentRecord?->student_no,
            ])->values(),
        ]);
    }

    /**
     * Resolve / open a conversation peer (no message created until first send).
     * POST /api/messages/start  { user_id }
     */
    public function start(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => 'required|integer|exists:users,id',
        ]);

        if ((int) $request->input('user_id') === (int) $request->user()->id) {
            return response()->json(['message' => 'You cannot message yourself.'], 422);
        }

        $user = $this->resolveParticipant($request, (int) $request->input('user_id'));

        if ((int) $user->id === (int) $request->user()->id) {
            return response()->json(['message' => 'You cannot message yourself.'], 422);
        }

        $hasThread = Message::thread($request->user()->id, $user->id)->exists();

        return response()->json([
            'user' => [
                'id'              => $user->id,
                'user_id'         => $user->id,
                'name'            => $this->displayName($user),
                'profile_picture' => $user->profile_picture,
                'course'          => $user->studentRecord?->course ?? $user->course,
                'batch_year'      => $user->studentRecord?->graduation_year ?? $user->graduation_year,
            ],
            'has_existing_thread' => $hasThread,
        ]);
    }

    // Thread 

    public function participant(Request $request, int $userId): JsonResponse
    {
        $user = $this->resolveParticipant($request, $userId);

        return response()->json([
            'id' => $user->id,
            'user_id' => $user->id,
            'name' => $this->displayName($user),
            'profile_picture' => $user->profile_picture,
            'course' => $user->studentRecord?->course ?? $user->course,
            'batch_year' => $user->studentRecord?->graduation_year ?? $user->graduation_year,
        ]);
    }

    public function thread(Request $request, int $userId): JsonResponse
    {
        $myId = $request->user()->id;
        $participant = $this->resolveParticipant($request, $userId);
        $userId = $participant->id;

        $messages = Message::thread($myId, $userId)
            ->with('sender:id,name,profile_picture')
            ->orderBy('created_at')
            ->paginate(50);

        Message::where('sender_id', $userId)
            ->where('receiver_id', $myId)
            ->where('is_read', false)
            ->update([
                'is_read' => true,
                'read_at' => now(),
            ]);

        return response()->json($messages);
    }

    // Send

    public function send(Request $request): JsonResponse
    {
        // Mobile / alternate clients may send recipient_id or message instead of receiver_id / body.
        if (! $request->filled('receiver_id')) {
            $receiver = $request->input('recipient_id')
                ?? $request->input('user_id')
                ?? $request->input('receiverId');
            if ($receiver !== null && $receiver !== '') {
                $request->merge(['receiver_id' => $receiver]);
            }
        }
        if (! $request->filled('body')) {
            $body = $request->input('message')
                ?? $request->input('content')
                ?? $request->input('text');
            if ($body !== null && $body !== '') {
                $request->merge(['body' => $body]);
            }
        }

        $request->validate([
            'receiver_id' => 'required|exists:users,id',
            'body'        => 'nullable|required_without:image|string|max:5000',
            'image'       => 'nullable|image|max:5120',
        ]);

        $imagePath = null;
        if ($request->hasFile('image')) {
            try {
                $result = $this->cloudinary->uploadPhoto(
                    file: $request->file('image'),
                    userId: $request->user()->id,
                    folder: 'messages',
                    options: [
                        'skip_mime_check' => true,
                        'skip_size_check' => true,
                    ],
                );
                $imagePath = $result['secure_url'] ?? null;

                if (! $imagePath) {
                    throw new \RuntimeException('Cloud upload returned no secure URL.');
                }
            } catch (\Throwable $e) {
                Log::warning('Message image cloud upload failed: ' . $e->getMessage());

                return response()->json([
                    'message' => 'Image upload failed. Please try again.',
                ], 422);
            }
        }
        $body = trim((string) $request->input('body', ''));
        if ($body === '' && ! $imagePath) {
            return response()->json(['message' => 'Message body or image is required.'], 422);
        }

        $preview = $body !== '' ? $body : 'Sent an image';

        $message = Message::create([
            'sender_id'   => $request->user()->id,
            'receiver_id' => (int) $request->receiver_id,
            // Empty string for image-only (schema allows NOT NULL text).
            'body'        => $body !== '' ? $body : '',
            'image_path'  => $imagePath,
        ]);

        // Broadcast (realtime)
        try {
            broadcast(new MessageSent($message))->toOthers();
        } catch (\Throwable $e) {
            Log::warning('MessageSent broadcast failed: ' . $e->getMessage());
        }

        // Push notification 
        try {
            $senderName = $this->displayName($request->user());

            SendPushNotification::dispatch(
                $request->receiver_id,
                $senderName,
                $preview,
                [
                    'type' => 'chat',
                    'sender_id' => (string) $request->user()->id,
                    'conversation_user_id' => (string) $request->user()->id,
                    'message_id' => (string) $message->id,
                    'sender_name' => $senderName,
                    'sender_avatar' => $request->user()->profile_picture,
                    'action_url' => rtrim(config('app.frontend_url'), '/') . '/messages/' . $request->user()->id,
                ],
                'chat'
            );
        } catch (\Throwable $e) {
            Log::warning('Push notification failed: ' . $e->getMessage());
        }

        //Email notification 
        try {
            $receiver = User::find($request->receiver_id);
            if ($receiver?->email) {
                SendNewMessageEmail::dispatch(
                    email:          $receiver->email,
                    name:           $receiver->name ?? $receiver->email,
                    senderName:     $this->displayName($request->user()),
                    messagePreview: $preview,
                );
            }
        } catch (\Throwable $e) {
            Log::warning('Message email notification failed: ' . $e->getMessage());
        }

        return response()->json($message->load('sender:id,name,first_name,last_name,profile_picture,student_record_id'), 201);
    }

    // Mark read 

    public function markRead(Request $request, int $id): JsonResponse
    {
        $message = Message::where('receiver_id', $request->user()->id)->findOrFail($id);

        $message->update([
            'is_read' => true,
            'read_at' => now(),
        ]);

        return response()->json(['message' => 'Marked as read.']);
    }

    // Typing indicator 

    public function typing(Request $request): JsonResponse
    {
        $request->validate([
            'receiver_id' => 'required|exists:users,id',
            'is_typing'   => 'required|boolean',
        ]);

        try {
            broadcast(new UserTyping(
                senderId:   $request->user()->id,
                receiverId: $request->receiver_id,
                senderName: $this->displayName($request->user()),
                isTyping:   $request->boolean('is_typing'),
            ))->toOthers();
        } catch (\Throwable $e) {
            Log::warning('UserTyping broadcast failed: ' . $e->getMessage());
        }

        return response()->json(['ok' => true]);
    }

    private function displayName(User $user): string
    {
        return trim((string) $user->name)
            ?: trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''))
            ?: $user->email
            ?: 'Someone';
    }

    private function resolveParticipant(Request $request, int $id): User
    {
        $user = User::with('studentRecord')->find($id);
        if ($user) {
            return $user;
        }

        $message = Message::where('id', $id)
            ->where(function ($query) use ($request) {
                $query->where('sender_id', $request->user()->id)
                    ->orWhere('receiver_id', $request->user()->id);
            })
            ->first();

        if (! $message) {
            $notification = UserNotification::where('id', $id)
                ->where('user_id', $request->user()->id)
                ->firstOrFail();

            $data = $notification->data ?? [];
            $senderId = $data['conversation_user_id'] ?? $data['sender_id'] ?? null;

            if ($senderId && User::whereKey($senderId)->exists()) {
                return User::with('studentRecord')->findOrFail($senderId);
            }

            $message = Message::where('receiver_id', $request->user()->id)
                ->where('body', $notification->body)
                ->latest()
                ->firstOrFail();
        }

        $participantId = $message->sender_id === $request->user()->id
            ? $message->receiver_id
            : $message->sender_id;

        return User::with('studentRecord')->findOrFail($participantId);
    }
}
