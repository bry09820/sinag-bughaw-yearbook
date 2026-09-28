<?php

declare(strict_types=1);

namespace App\Http\Controllers\API\Yearbook;

use App\Contracts\StorageServiceInterface;
use App\Exceptions\StorageLimitExceededException;
use App\Exceptions\StorageUploadException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Yearbook\BulkUploadRequest;
use App\Http\Requests\Yearbook\UploadVideoRequest;
use App\Http\Resources\MediaResource;
use App\Jobs\AI\AnalyzePhotoFaces;
use App\Models\Album;
use App\Models\Gallery;
use App\Models\GalleryMedia;
use App\Models\Subscription;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;

class MediaController extends Controller
{
    public function __construct(
        private readonly StorageServiceInterface $storage
    ) {}

    /**
     * POST /api/media/bulk-upload
     */
    public function bulkUpload(BulkUploadRequest $request): JsonResponse
    {
        if ($response = $this->requireSubscribed()) {
            return $response;
        }

        if ($response = $this->pendingImageUploadResponse()) {
            return $response;
        }

        $album = Album::findOrFail($request->validated('album_id'));
        $visibility = $this->normalizeVisibility($request->validated('visibility', 'public'));
        $caption = $request->validated('caption', null);

        try {
            $results = $this->storage->uploadBulk(
                files:  $request->file('photos'),
                userId: Auth::id(),
                folder: "albums/{$album->id}",
            );

            $uploaded = collect($results)->filter(fn ($r) => $r['success']);
            $failed   = collect($results)->filter(fn ($r) => ! $r['success']);

            $savedGalleries = $uploaded->map(function ($result) use ($album, $visibility, $caption) {

                // 1 Create the Gallery
                $gallery = Gallery::create([
                    'album_id'    => $album->id,
                    'user_id'     => Auth::id(),
                    'caption'     => $caption,
                    'status'      => 'pending',
                    'visibility'  => $visibility,
                    'sort_order'  => 0,
                    'ai_metadata' => [
                        'resource_type' => $result['resource_type'] ?? 'image',
                        'bytes'         => $result['bytes']         ?? 0,
                        'width'         => $result['width']         ?? null,
                        'height'        => $result['height']        ?? null,
                    ],
                ]);

                // 2 Create the GalleryMedia 
                GalleryMedia::create([
                    'gallery_id'    => $gallery->id,
                    'file_path'     => $result['secure_url'],
                    'public_id'     => $result['public_id']     ?? null,
                    'resource_type' => $result['resource_type'] ?? 'image',
                    'bytes'         => $result['bytes']         ?? 0,
                    'width'         => $result['width']         ?? null,
                    'height'        => $result['height']        ?? null,
                    'sort_order'    => 0,
                ]);

                if (($result['resource_type'] ?? 'image') === 'image') {
                    AnalyzePhotoFaces::dispatch($gallery)->delay(now()->addSeconds(3));
                }

                return $gallery;
            });

            return $this->success(
                message: "{$uploaded->count()} photo(s) uploaded, {$failed->count()} failed.",
                data: [
                    'uploaded' => MediaResource::collection($savedGalleries->values()),
                    'failed'   => $failed->values(),
                ],
                status: 201
            );

        } catch (StorageLimitExceededException $e) {
            return $this->error(message: $e->getMessage(), errors: $e->toArray(), status: 422);
        } catch (StorageUploadException $e) {
            return $this->error(message: $e->getMessage(), status: 500);
        }
    }

    /**
     * POST /api/media/upload-video
     */
    public function uploadVideo(UploadVideoRequest $request): JsonResponse
    {
        if ($response = $this->requireSubscribed()) {
            return $response;
        }

        $album = Album::findOrFail($request->validated('album_id'));
        $visibility = $this->normalizeVisibility($request->validated('visibility', 'public'));

        try {
            $result = $this->storage->uploadPhoto(
                file:   $request->file('video'),
                userId: Auth::id(),
                folder: "albums/{$album->id}/videos",
            );

            // 1 Create the Gallery
            $gallery = Gallery::create([
                'album_id'    => $album->id,
                'user_id'     => Auth::id(),
                'caption'     => $request->validated('caption'),
                'status'      => 'pending',
                'visibility'  => $visibility,
                'sort_order'  => 0,
                'ai_metadata' => [
                    'resource_type' => 'video',
                    'bytes'         => $result['bytes']    ?? 0,
                    'duration'      => $result['duration'] ?? null,
                ],
            ]);

            // 2 Create the GalleryMedia 
            GalleryMedia::create([
                'gallery_id'    => $gallery->id,
                'file_path'     => $result['secure_url'],
                'public_id'     => $result['public_id'] ?? null,
                'resource_type' => 'video',
                'bytes'         => $result['bytes']     ?? 0,
                'width'         => null,
                'height'        => null,
                'sort_order'    => 0,
            ]);

            return $this->success(
                message: 'Video uploaded successfully.',
                data:    new MediaResource($result),
                status:  201
            );

        } catch (StorageLimitExceededException $e) {
            return $this->error(message: $e->getMessage(), errors: $e->toArray(), status: 422);
        } catch (StorageUploadException $e) {
            return $this->error(message: $e->getMessage(), status: 500);
        }
    }

     //DELETE /api/media/photo/{id}
    public function deletePhoto(int $id): JsonResponse
    {
        // Try GalleryMedia first (new architecture)
        $media = GalleryMedia::with('gallery.album')->find($id);

        if ($media) {
            $gallery = $media->gallery;

            Log::info('deletePhoto (GalleryMedia) debug', [
                'auth_user_id'    => Auth::id(),
                'gallery_user_id' => $gallery?->user_id,
                'media_id'        => $media->id,
                'gallery_id'      => $gallery?->id,
            ]);

            $actor = Auth::user();

            abort_unless(
                $actor && (
                    $actor->role === 'admin' ||
                    $gallery?->user_id === $actor->id ||
                    $gallery?->album?->user_id === $actor->id
                ),
                403,
                'You can only delete media that you uploaded.'
            );

            try {
                if ($media->public_id) {
                    $this->storage->deletePhoto(
                        publicId:     $media->public_id,
                        resourceType: $media->resource_type ?? 'image',
                    );
                }

                $media->delete();

                // Clean up the parent Gallery row if no media files remain
                if ($gallery && $gallery->media()->count() === 0) {
                    $gallery->delete();
                }

                return $this->success(message: 'Photo deleted successfully.');

            } catch (StorageUploadException $e) {
                return $this->error(message: $e->getMessage(), status: 500);
            }
        }

        // Fallback: legacy Photo model (old architecture rows still in DB)
        $photo = \App\Models\Photo::with('album')->findOrFail($id);

        Log::info('deletePhoto (legacy Photo) debug', [
            'auth_user_id'  => Auth::id(),
            'photo_user_id' => $photo->user_id,
            'album_user_id' => $photo->album?->user_id,
            'photo_id'      => $photo->id,
        ]);

        Gate::authorize('delete', $photo);

        try {
            if ($photo->public_id) {
                $this->storage->deletePhoto(
                    publicId:     $photo->public_id,
                    resourceType: $photo->ai_metadata['resource_type'] ?? 'image',
                );
            }

            $photo->delete();

            return $this->success(message: 'Photo deleted successfully.');

        } catch (StorageUploadException $e) {
            return $this->error(message: $e->getMessage(), status: 500);
        }
    }

    /**
     * GET /api/profile/storage-usage
     */
    public function storageUsage(): JsonResponse
    {
        $userId = Auth::id();
        $user = Auth::user();

        $tier = \App\Support\SubscriptionAccess::tierFor($user);

        $limitBytes = match ($tier) {
            'premium'          => 50  * 1024 * 1024 * 1024,
            'premium_standard' => 10  * 1024 * 1024 * 1024,
            'standard'         => 2   * 1024 * 1024 * 1024,
            default            => 500 * 1024 * 1024,
        };

        $label = match ($tier) {
            'premium'          => 'Premium HD',
            'premium_standard' => 'Premium Standard',
            'standard'         => 'Standard',
            default            => 'Free',
        };

        // Sum actual bytes used from gallery_media for this user
        $usedBytes = GalleryMedia::whereHas(
            'gallery',
            fn ($q) => $q->where('user_id', $userId)
        )->sum('bytes');

        return $this->success(data: [
            'used_bytes'  => (int) $usedBytes,
            'limit_bytes' => $limitBytes,
            'tier'        => $tier,
            'label'       => $label,
            'percent'     => $limitBytes > 0
                ? round(($usedBytes / $limitBytes) * 100, 2)
                : 0,
        ]);
    }

    // Response helpers

    private function requireSubscribed(): ?JsonResponse
    {
        if (! \App\Support\SubscriptionAccess::isStandard(Auth::user())) {
            return $this->error(
                message: 'Gallery uploads require a Standard or Premium subscription.',
                errors: ['code' => 'UPGRADE_REQUIRED'],
                status: 403
            );
        }

        return null;
    }

    private function pendingImageUploadResponse(): ?JsonResponse
    {
        $pending = Gallery::query()
            ->where('user_id', Auth::id())
            ->where('status', 'pending')
            ->whereHas('media', fn ($media) => $media->where('resource_type', 'image'))
            ->latest()
            ->first();

        if (! $pending) {
            return null;
        }

        return $this->error(
            message: 'You already uploaded an image that is waiting for admin approval. We will notify you by email and in-app notification once it is approved.',
            errors: [
                'code' => 'PENDING_IMAGE_APPROVAL',
                'gallery_id' => $pending->id,
            ],
            status: 422
        );
    }

    private function normalizeVisibility(?string $visibility): string
    {
        return $visibility === 'batchmates' ? 'friends' : ($visibility ?: 'public');
    }

    private function success(string $message = 'OK', mixed $data = [], int $status = 200): JsonResponse
    {
        return response()->json([
            'success' => true,
            'message' => $message,
            'data'    => $data,
        ], $status);
    }

    private function error(string $message, array $errors = [], int $status = 400): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $message,
            'errors'  => $errors,
        ], $status);
    }
}
