<?php

namespace App\Http\Controllers\API\Social;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Mobile-friendly chat aliases for the existing MessageController.
 *
 * Expo app paths:
 *   GET  /api/chat/with/{userId}
 *   POST /api/chat/messages
 *   GET  /api/chat/conversations
 *
 * Available to every authenticated user (no subscription middleware).
 */
class ChatController extends Controller
{
    public function __construct(private readonly MessageController $messages) {}

    /**
     * Load (or open) a 1:1 thread with another user.
     * GET /api/chat/with/{userId}
     */
    public function withUser(Request $request, int $userId): JsonResponse
    {
        $thread = $this->messages->thread($request, $userId);
        $payload = $thread->getData(true);

        // Normalize paginator shape for the mobile chat client.
        $messages = is_array($payload['data'] ?? null)
            ? $payload['data']
            : (is_array($payload) && array_is_list($payload) ? $payload : []);

        return response()->json([
            'conversation_id' => 'peer-'.$userId,
            'thread_id' => 'peer-'.$userId,
            'id' => 'peer-'.$userId,
            'messages' => $messages,
            'meta' => [
                'current_page' => $payload['current_page'] ?? 1,
                'last_page' => $payload['last_page'] ?? 1,
                'per_page' => $payload['per_page'] ?? count($messages),
                'total' => $payload['total'] ?? count($messages),
            ],
        ]);
    }

    /**
     * Send a chat message from the mobile app.
     * POST /api/chat/messages
     *
     * Accepts mobile field aliases:
     *   recipient_id | receiver_id | user_id
     *   body | message | content | text
     */
    public function send(Request $request): JsonResponse
    {
        $this->normalizeMobilePayload($request);

        return $this->messages->send($request);
    }

    /**
     * Conversation list — same data as GET /api/messages/conversations.
     */
    public function conversations(Request $request): JsonResponse
    {
        return $this->messages->conversations($request);
    }

    private function normalizeMobilePayload(Request $request): void
    {
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
    }
}
