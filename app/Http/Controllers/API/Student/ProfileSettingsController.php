<?php

namespace App\Http\Controllers\API\Student;

use App\Http\Controllers\Controller;
use App\Models\AlumniActivity;
use App\Models\AuditLog;
use App\Models\ProfileView;
use App\Models\User;
use App\Models\UserNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProfileSettingsController extends Controller
{
    private function notifyProfileUpdate(User $user, string $body): void
    {
        UserNotification::create([
            'user_id' => $user->id,
            'type' => 'profile_update',
            'title' => 'Profile updated',
            'body' => $body,
            'data' => [
                'type' => 'profile_update',
                'sender_name' => 'Sinag-Bughaw',
                'action_url' => '/profile',
            ],
        ]);
    }

    // Update visibility 
    public function updateVisibility(Request $request): JsonResponse
    {
        $request->validate([
            'visibility' => 'required|in:public,private,batchmates',
        ]);

        $user = $request->user();
        $user->update(['profile_visibility' => $request->visibility]);
        $user->refresh();
        $this->notifyProfileUpdate($user, 'Your profile visibility was updated successfully.');

        return response()->json([
            'message' => 'Visibility updated.',
            'visibility' => $user->profile_visibility,
            'profile_visibility' => $user->profile_visibility,
            'user' => [
                'id' => $user->id,
                'profile_visibility' => $user->profile_visibility,
                'visibility' => $user->profile_visibility,
            ],
        ]);
    }

    // Update motto 
    public function updateMotto(Request $request): JsonResponse
    {
        $request->validate(['motto' => 'nullable|string|max:255']);

        $user = $request->user()->loadMissing('studentRecord');

        if ($user->studentRecord) {
            $user->studentRecord->update(['motto' => $request->motto]);
        } else {
            $user->update(['motto' => $request->motto]);
        }

        $this->notifyProfileUpdate($user, 'Your motto was updated successfully.');

        return response()->json(['message' => 'Motto updated.']);
    }

    // Update academic info 
    public function updateAcademic(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'student_id'      => 'nullable|string|max:255',
            'course'          => 'nullable|string|max:255',
            'graduation_year' => 'nullable|integer|min:1990|max:2100',
            'batch'           => 'nullable|string|max:255',
        ]);

        if (array_key_exists('graduation_year', $validated) && $validated['graduation_year'] !== null) {
            $validated['graduation_year'] = (int) $validated['graduation_year'];
        }

        $user = $request->user()->loadMissing('studentRecord');

        if ($user->studentRecord) {
            $studentPayload = [];

            if (array_key_exists('student_id', $validated)) {
                $studentPayload['student_no'] = $validated['student_id'];
            }

            foreach (['course', 'graduation_year'] as $field) {
                if (array_key_exists($field, $validated)) {
                    $studentPayload[$field] = $validated[$field];
                }
            }

            if ($studentPayload) {
                $user->studentRecord->update($studentPayload);
            }
        } else {
            $user->update($validated);
        }

        AuditLog::record($request, 'API Update Academic', 'Updated academic info for ' . $request->user()->email);
        $this->notifyProfileUpdate($user, 'Your academic info was updated successfully.');

        return response()->json([
            'success' => true,
            'message' => 'Academic info updated.',
            'user' => $user->fresh()->load('studentRecord', 'section'),
        ]);
    }

    // Update achievements 
    // Expects: { achievements: [{ id, title, subtitle, type: '{"icon":"fa-star","color":"#fdb813"}' }] }
    public function updateAchievements(Request $request): JsonResponse
    {
        $user  = $request->user();
        $items = $request->input('achievements', []);

        $keptIds = [];

        foreach ($items as $item) {
            $payload = [
                'title'    => $item['title']    ?? '',
                'subtitle' => $item['subtitle'] ?? null,
                'type'     => isset($item['type']) ? (string) $item['type'] : null,
            ];

            $itemId = $item['id'] ?? null;

            if ($itemId && is_numeric($itemId)) {
                // Check the record actually belongs to this user
                $existing = $user->achievements()->where('id', (int) $itemId)->first();

                if ($existing) {
                    $existing->update($payload);
                    $keptIds[] = $existing->id;
                } else {
                    // Numeric id but not owned by this user treat as
                    $created   = $user->achievements()->create($payload);
                    $keptIds[] = $created->id;
                }
            } else {
                // achievement (null id or Date.now() placeholder from React)
                $created   = $user->achievements()->create($payload);
                $keptIds[] = $created->id; // track so it isn't deleted below
            }
        }

        // Delete achievements the user removed from the list
        if (!empty($keptIds)) {
            $user->achievements()->whereNotIn('id', $keptIds)->delete();
        } else {
            // User intentionally cleared all achievements
            $user->achievements()->delete();
        }

        AuditLog::record($request, 'API Update Achievements', 'Updated achievements for ' . $user->email);
        $this->notifyProfileUpdate($user, 'Your achievements were updated successfully.');

        return response()->json(['success' => true, 'message' => 'Achievements updated.']);
    }

    //Get achievements for a user 
    public function getAchievements(Request $request): JsonResponse
    {
        $user = $request->user();

        $achievements = $user->achievements()
            ->orderBy('created_at', 'asc')
            ->get(['id', 'title', 'subtitle', 'type', 'date_awarded']);

        return response()->json(['data' => $achievements]);
    }

    // Track profile view 
    public function trackView(Request $request, int $id): JsonResponse
    {
        $profile = User::findOrFail($id);

        if ($request->user()?->id === $id) {
            return response()->json(['tracked' => false]);
        }

        ProfileView::create([
            'viewed_user_id' => $id,
            'viewer_user_id' => $request->user()?->id,
            'viewer_ip'      => $request->ip(),
        ]);

        $profile->increment('profile_views');

        AlumniActivity::create([
            'user_id'     => $id,
            'action'      => 'profile_viewed',
            'description' => 'Profile was viewed',
            'metadata'    => ['viewer_id' => $request->user()?->id],
        ]);

        return response()->json(['tracked' => true]);
    }

    // Top viewed profiles 
    public function topViewed(): JsonResponse
    {
        $students = User::withCount('profileViews')
            ->orderByDesc('profile_views')
            ->limit(10)
            ->get(['id', 'name', 'course', 'profile_picture', 'profile_views', 'student_id']);

        return response()->json($students);
    }
}
