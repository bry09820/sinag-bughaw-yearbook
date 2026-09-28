<?php

declare(strict_types=1);

namespace App\Http\Controllers\API\Student;

use App\Contracts\StorageServiceInterface;
use App\Exceptions\StorageLimitExceededException;
use App\Http\Controllers\Controller;
use App\Models\Album;
use App\Models\GalleryMedia;
use App\Models\Photo;
use App\Models\PostMedia;
use App\Models\TaggedPhoto;
use App\Models\User;
use App\Notifications\PhotoTaggedNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class ProfileController extends Controller
{
    public function __construct(
        private readonly StorageServiceInterface $storage
    ) {}


    // GET /api/students/{id}/posts
    public function getPosts(Request $request, int $id): JsonResponse
    {
        $isOwner      = Auth::id() === $id;
        $isSubscribed = $request->attributes->get('viewer_is_subscribed', false);
        $viewer       = Auth::user();
        $profileOwner = User::with('studentRecord')->findOrFail($id);
        $isBatchmate  = $viewer instanceof User && $this->areBatchmates($viewer, $profileOwner);

        if (! $isOwner && ! $isSubscribed) {
            return response()->json([
                'success'    => true,
                'restricted' => true,
                'data'       => ['data' => []],
            ]);
        }

        $photos = Photo::where('user_id', $id)
            ->where('is_profile_post', true)
            ->when(! $isOwner, fn ($q) => $q->where(function ($visibility) use ($isBatchmate) {
                $visibility->where('visibility', 'public');

                if ($isBatchmate) {
                    $visibility->orWhere('visibility', 'friends');
                }
            }))
            ->with([
                'user:id,name',
                'user.studentRecord:id,course,photo',         
                'taggedStudents:id,name',
                'taggedStudents.studentRecord:id,course,photo', 
                'media',
            ])
            ->latest()
            ->paginate(12);

        $photos->getCollection()->transform(fn ($p) => $this->formatPost($p));

        return response()->json([
            'success'    => true,
            'restricted' => false,
            'data'       => $photos,
        ]);
    }

    // POST /api/profile/upload

    public function uploadMedia(Request $request): JsonResponse
    {
        $maxKb        = max(\App\Support\PlatformSettings::uploadMaxKilobytes(), 102400);
        $allowedMimes = array_values(array_unique(array_merge(
            \App\Support\PlatformSettings::allowedMimeTypes(),
            [
                'image/jpeg',
                'image/png',
                'image/gif',
                'image/webp',
                'image/heic',
                'image/heif',
                'video/mp4',
                'video/mpeg',
                'video/quicktime',
                'video/webm',
                'video/x-msvideo',
                'audio/mpeg',
                'audio/mp3',
                'audio/wav',
                'audio/x-wav',
                'audio/ogg',
                'application/pdf',
            ],
        )));

        $request->validate([
            'files'             => ['required', 'array', 'min:1', 'max:20'],
            'files.*'           => [
                'required', 'file',
                function ($attribute, $value, $fail) use ($allowedMimes) {
                    $mime = $value->getMimeType();
                    if (! in_array($mime, $allowedMimes, true)) {
                        $fail("File type [{$mime}] is not allowed by platform settings.");
                    }
                },
                'max:' . $maxKb,
            ],
            'caption'           => ['nullable', 'string', 'max:255'],
            'visibility'        => ['nullable', 'in:public,batchmates,friends,private'],
            'tagged_user_ids'   => ['nullable', 'array'],
            'tagged_user_ids.*' => ['integer', 'exists:users,id'],
        ]);

        $user = Auth::user();

        // Subscription gate (skipped when premium billing is disabled globally)
        if (\App\Support\PlatformSettings::bool('enable_premium_subscription')) {
            if (! \App\Support\SubscriptionAccess::isStandard($user)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Uploading photos requires a Standard or Premium subscription.',
                    'code'    => 'UPGRADE_REQUIRED',
                ], 403);
            }
        }

        $files      = $request->file('files');
        $caption    = $request->input('caption', '');
        $visibility = $this->normalizeVisibility($request->input('visibility', 'public'));

        try {
            $album = Album::firstOrCreate(
                ['user_id' => $user->id, 'title' => 'My Uploads'],
                ['type' => 'profile', 'event_date' => now()->toDateString()]
            );

            // Create ONE Photo record for all files 
            $photo = Photo::create([
                'album_id'        => $album->id,
                'user_id'         => $user->id,
                'file_path'       => '',
                'public_id'       => '',
                'caption'         => $caption,
                'visibility'      => $visibility,
                'is_profile_post' => true,
                'status'          => 'approved',
                'ai_metadata'     => [
                    'resource_type' => 'image',
                    'multi'         => count($files) > 1,
                    'media_count'   => count($files),
                ],
            ]);

            foreach ($files as $index => $file) {
                $result       = $this->storage->uploadPhoto(
                    file:   $file,
                    userId: $user->id,
                    folder: 'profile',
                    options: [
                        'skip_mime_check' => true,
                        'skip_size_check' => true,
                    ],
                );
                $resourceType = str_starts_with((string) $file->getMimeType(), 'video/') ? 'video' : 'image';

                PostMedia::create([
                    'photo_id'      => $photo->id,
                    'file_path'     => $result['secure_url'],
                    'public_id'     => $result['public_id'],
                    'resource_type' => $resourceType,
                    'bytes'         => $result['bytes']  ?? 0,
                    'width'         => $result['width']  ?? null,
                    'height'        => $result['height'] ?? null,
                    'sort_order'    => $index,
                ]);

                if ($index === 0) {
                    $photo->update([
                        'file_path'   => $result['secure_url'],
                        'public_id'   => $result['public_id'],
                        'ai_metadata' => [
                            'resource_type' => $resourceType,
                            'bytes'         => $result['bytes']  ?? 0,
                            'width'         => $result['width']  ?? null,
                            'height'        => $result['height'] ?? null,
                            'multi'         => count($files) > 1,
                            'media_count'   => count($files),
                        ],
                    ]);
                }
            }

            // Tag people 
            if ($request->filled('tagged_user_ids')) {
                $this->tagUsersAndNotify(
                    $photo,
                    $request->input('tagged_user_ids', []),
                    $user
                );
            }

            $photo->load([
                'media',
                'taggedStudents:id,name',
                'taggedStudents.studentRecord:id,photo',
            ]);

            return response()->json([
                'success' => true,
                'message' => count($files) > 1
                    ? count($files) . ' photos uploaded as one post.'
                    : 'Photo uploaded successfully.',
                'data' => $this->formatPost($photo),
            ], 201);

        } catch (StorageLimitExceededException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'errors'  => $e->toArray(),
                'code'    => 'STORAGE_LIMIT_EXCEEDED',
            ], 422);

        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('uploadMedia failed', [
                'message' => $e->getMessage(),
                'line'    => $e->getLine(),
                'file'    => $e->getFile(),
            ]);
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'code'    => 'UPLOAD_FAILED',
            ], 500);
        }
    }

    
    // GET /api/profile/posts/{photoId}
    public function getPost(int $photoId): JsonResponse
    {
        $photo = Photo::where('id', $photoId)
            ->where('is_profile_post', true)
            ->with([
                'media',
                'taggedStudents:id,name',
                'taggedStudents.studentRecord:id,photo', 
            ])
            ->firstOrFail();

        return response()->json([
            'success' => true,
            'data'    => $this->formatPost($photo),
        ]);
    }

    // PATCH /api/profile/posts/{photoId}
    public function updatePost(Request $request, int $photoId): JsonResponse
    {
        $photo = Photo::where('id', $photoId)
            ->where('user_id', Auth::id())
            ->where('is_profile_post', true)
            ->firstOrFail();

        $validated = $request->validate([
            'caption'           => ['nullable', 'string', 'max:255'],
            'visibility'        => ['nullable', 'in:public,batchmates,friends,private'],
            'tagged_user_ids'   => ['nullable', 'array'],
            'tagged_user_ids.*' => ['integer', 'exists:users,id'],
        ]);

        $photo->update([
            'caption'    => $validated['caption']    ?? $photo->caption,
            'visibility' => isset($validated['visibility']) ? $this->normalizeVisibility($validated['visibility']) : $photo->visibility,
        ]);

        if (array_key_exists('tagged_user_ids', $validated)) {
            $newIds      = $validated['tagged_user_ids'] ?? [];
            $existingIds = TaggedPhoto::where('photo_id', $photo->id)
                ->where('source', 'manual')->pluck('user_id')->toArray();
            $addedIds    = array_values(array_diff($newIds, $existingIds));

            TaggedPhoto::where('photo_id', $photo->id)->where('source', 'manual')->delete();
            $this->tagUsersAndNotify($photo, $newIds, Auth::user(), $addedIds);
        }

        $photo->load([
            'media',
            'taggedStudents:id,name',
            'taggedStudents.studentRecord:id,photo',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Post updated.',
            'data'    => $this->formatPost($photo),
        ]);
    }

    // POST /api/profile/posts/{photoId}/report
    public function reportPost(Request $request, int $photoId): JsonResponse
    {
        $request->validate([
            'reason' => ['nullable', 'string', 'max:255'],
        ]);

        $photo = Photo::where('id', $photoId)
            ->where('is_profile_post', true)
            ->where('user_id', '!=', Auth::id())
            ->with('media')
            ->firstOrFail();

        $photo->media()->update(['is_reported' => true]);
        $photo->load('media');

        return response()->json([
            'success' => true,
            'message' => 'Report submitted for review.',
            'data'    => [
                'id'          => $photo->id,
                'is_reported' => true,
                'media'       => $photo->media->map(fn ($media) => [
                    'id'          => $media->id,
                    'is_reported' => (bool) $media->is_reported,
                ])->values(),
            ],
        ]);
    }

    // GET /api/profile/storage-usage
    public function storageUsage(): JsonResponse
    {
        $user = Auth::user();

        $subscription = \App\Models\Subscription::where('user_id', $user->id)
            ->where('status', 'active')
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->latest()->first();

        $tierKey    = $subscription?->storage_tier_key ?? 'free';
        $tierConfig = config("cloudinary.tiers.{$tierKey}");

        if (! is_array($tierConfig)) $tierConfig = config('cloudinary.tiers.free');
        if (! is_array($tierConfig)) $tierConfig = [
            'storage_limit_bytes' => 500 * 1024 * 1024,
            'hd_enabled'          => false,
        ];

        $postBytes = (int) PostMedia::whereHas(
            'photo',
            fn ($q) => $q->where('user_id', $user->id)
        )->sum('bytes');

        $galleryBytes = (int) GalleryMedia::whereHas(
            'gallery',
            fn ($q) => $q->where('user_id', $user->id)
        )->sum('bytes');

        $usedBytes = $postBytes + $galleryBytes;

        return response()->json([
            'success' => true,
            'data'    => [
                'used_bytes'  => $usedBytes,
                'limit_bytes' => $subscription?->storage_limit_bytes ?? $tierConfig['storage_limit_bytes'],
                'tier'        => $tierKey,
                'tier_label'  => $subscription?->storage_tier_label ?? ucfirst($tierKey),
                'hd_enabled'  => $subscription?->hd_enabled ?? $tierConfig['hd_enabled'],
            ],
        ]);
    }

    // DELETE /api/profile/posts/{photoId}
    public function deletePost(int $photoId): JsonResponse
    {
        $photo = Photo::where('id', $photoId)
            ->where('user_id', Auth::id())
            ->where('is_profile_post', true)
            ->with('media')
            ->firstOrFail();

        foreach ($photo->media as $media) {
            try {
                $this->storage->deletePhoto(
                    publicId:     $media->public_id,
                    resourceType: $media->resource_type,
                );
            } catch (\Throwable) {}
        }

        if ($photo->public_id && $photo->media->isEmpty()) {
            try {
                $this->storage->deletePhoto(
                    publicId:     $photo->public_id,
                    resourceType: $photo->ai_metadata['resource_type'] ?? 'image',
                );
            } catch (\Throwable) {}
        }

        TaggedPhoto::where('photo_id', $photo->id)->delete();
        $photo->delete();

        return response()->json(['success' => true, 'message' => 'Post deleted.']);
    }

    // PRIVATE HELPERS
    private function formatPost(Photo $photo): array
    {
        $media = $photo->relationLoaded('media') ? $photo->media : $photo->media()->get();

        // Backward compat: old posts have no PostMedia rows use file_path directly
        if ($media->isEmpty()) {
            $media = collect([[
                'file_path'     => $photo->file_path,
                'public_id'     => $photo->public_id,
                'resource_type' => $photo->ai_metadata['resource_type'] ?? 'image',
                'sort_order'    => 0,
            ]]);
        }

        $taggedStudents = $photo->relationLoaded('taggedStudents')
            ? $photo->taggedStudents
            : collect();

        return [
            'id'              => $photo->id,
            'caption'         => $photo->caption,
            'visibility'      => $this->displayVisibility($photo->visibility),
            'created_at'      => $photo->created_at,
            'file_path'       => $photo->file_path,
            'ai_metadata'     => $photo->ai_metadata,
            'media_count'     => $media->count(),
            'media'           => $media->map(fn ($m) => [
                'id'            => is_array($m) ? ($m['id'] ?? null) : $m->id,
                'file_path'     => is_array($m) ? $m['file_path']     : $m->file_path,
                'public_id'     => is_array($m) ? $m['public_id']     : $m->public_id,
                'resource_type' => is_array($m) ? $m['resource_type'] : $m->resource_type,
                'sort_order'    => is_array($m) ? $m['sort_order']    : $m->sort_order,
                'is_reported'   => is_array($m) ? (bool) ($m['is_reported'] ?? false) : (bool) $m->is_reported,
            ])->values(),
            'is_reported'     => $media->contains(fn ($m) => is_array($m)
                ? (bool) ($m['is_reported'] ?? false)
                : (bool) $m->is_reported),
            // profile_picture accessor resolves correctly because studentRecord
            // is now eager-loaded with the 'photo' column everywhere this is called.
            'tagged_users'    => $taggedStudents->map(fn ($u) => [
                'id'              => $u->id,
                'name'            => $u->name,
                'profile_picture' => $u->profile_picture,
            ])->values(),
            'tagged_students' => $taggedStudents->values(),
        ];
    }

    private function tagUsersAndNotify(
        Photo  $photo,
        array  $userIds,
        User   $tagger,
        ?array $notifyIds = null
    ): void {
        $notifyIds  = $notifyIds ?? $userIds;
        $photoUrl   = $photo->media()->orderBy('sort_order')->value('file_path')
                      ?? $photo->file_path
                      ?? '';

        foreach ($userIds as $userId) {
            if ($userId === $tagger->id) continue;

            TaggedPhoto::create([
                'photo_id'   => $photo->id,
                'user_id'    => $userId,
                'tagged_by'  => $tagger->id,
                'source'     => 'manual',
                'similarity' => 100,
                'confidence' => 100,
                'status'     => 'approved',
            ]);

            if (in_array($userId, $notifyIds)) {
                $taggedUser = User::find($userId);
                if ($taggedUser) {
                    try {
                        $actionUrl = rtrim(config('app.frontend_url'), '/') . '/profile/' . $photo->user_id . '?post=' . $photo->id;
                        PhotoTaggedNotification::dispatchFor($taggedUser, $tagger, $photoUrl, $actionUrl, $photo->id, $photo->user_id);
                    } catch (\Throwable) {}
                }
            }
        }
    }

    private function normalizeVisibility(?string $visibility): string
    {
        return $visibility === 'batchmates' ? 'friends' : ($visibility ?: 'public');
    }

    private function displayVisibility(?string $visibility): string
    {
        return $visibility === 'friends' ? 'batchmates' : ($visibility ?: 'public');
    }

    private function areBatchmates(User $viewer, User $profileOwner): bool
    {
        $viewer->loadMissing('studentRecord');
        $profileOwner->loadMissing('studentRecord');

        $viewerYear = $viewer->graduation_year;
        $ownerYear  = $profileOwner->graduation_year;

        if (! $viewerYear || ! $ownerYear || (int) $viewerYear !== (int) $ownerYear) {
            return false;
        }

        $viewerSection = $viewer->section_id ?: $viewer->studentRecord?->section_id;
        $ownerSection  = $profileOwner->section_id ?: $profileOwner->studentRecord?->section_id;

        if ($viewerSection && $ownerSection && (int) $viewerSection === (int) $ownerSection) {
            return true;
        }

        $viewerCourse = trim((string) $viewer->course);
        $ownerCourse  = trim((string) $profileOwner->course);

        return $viewerCourse !== '' && $ownerCourse !== '' && strcasecmp($viewerCourse, $ownerCourse) === 0;
    }
}
