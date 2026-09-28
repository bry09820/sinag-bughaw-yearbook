<?php

namespace App\Http\Controllers\API\Yearbook;

use App\Contracts\FaceRecognition;
use App\Http\Controllers\Controller;
use App\Models\Album;
use App\Models\Gallery;
use App\Models\GalleryMedia;
use App\Models\GraduationPhoto;
use App\Models\Subscription;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class GalleryController extends Controller
{
    public function __construct(private readonly FaceRecognition $faceRecognition) {}

    public function index(Request $request): JsonResponse
    {
        $type     = $request->query('type', 'general');
        $category = $request->query('category');

        $query = Album::withCount([
            'galleries as photos_count' => fn ($q) => $this->applyGalleryVisibility($q, $request->user()),
        ])->latest('event_date');

        if ($type === 'graduation') {
            $query->graduation();
            if ($category) {
                $query->where('category', $category);
            }
        } else {
            $query->general();
        }

        $result = $query->get();

        return response()->json([
            'success' => true,
            'data'    => $result,
        ]);
    }

    // GET /api/gallery/{id}
    public function show(int $id): JsonResponse
    {
        $viewer = Auth::user();

        $album = Album::with([
            'photos' => function ($q) use ($viewer) {
                $this->applyGalleryVisibility($q, $viewer)
                  ->select([
                      'id',
                      'album_id',
                      'user_id',
                      'caption',
                      'status',
                      'visibility',
                      'ai_metadata',
                      'sort_order',
                      'created_at',
                  ])
                  ->orderByDesc('created_at')
                  ->orderBy('sort_order')
                  ->with([
                      'media' => fn ($m) => $m->select([
                          'id',
                          'gallery_id',
                          'file_path',
                          'public_id',
                          'resource_type',
                          'bytes',
                          'width',
                          'height',
                          'sort_order',
                      ])->orderBy('sort_order'),
                      'user:id,name,profile_picture',
                  ]);
            },
        ])->findOrFail($id);

        // Hoist the first media file_path onto each photo so the frontend
        $album->photos->each(function ($photo) {
            $media = $photo->media->first();
            $photo->media_id = $media?->id;
            $photo->file_path = $media?->file_path;
            $photo->resource_type = $media?->resource_type ?? ($photo->ai_metadata['resource_type'] ?? 'image');
            $photo->file_type = $photo->resource_type;
            $photo->bytes = $media?->bytes;
            $photo->width = $media?->width;
            $photo->height = $media?->height;
        });

        return response()->json([
            'success' => true,
            'data'    => $album,
        ]);
    }

    // POST /api/gallery/face-search
    public function faceSearch(Request $request): JsonResponse
    {
        $request->validate(['face_image' => 'required|image|max:5120']);

        $type     = $request->input('type', 'general');
        $category = $request->input('category');

        $result = $this->faceRecognition->searchIndexedFaces($request->file('face_image'), 30);

        $photos = [];

        if (!empty($result['matches'])) {
            $rawMatches = collect($result['matches']);
            $studentMatches = $rawMatches->filter(fn ($m) => filled($m['user_id']))->values();

            $similarityMap = $studentMatches
                ->keyBy('user_id')
                ->map(fn ($m) => $m['similarity'] ?? 0);

            $userIds = $similarityMap->keys()->all();

            if ($type === 'graduation') {
                $directPhotoSimilarity = $rawMatches
                    ->mapWithKeys(function ($match) {
                        $externalId = (string) ($match['external_image_id'] ?? '');

                        if (str_starts_with($externalId, 'graduation_photo:')) {
                            return [(int) substr($externalId, strlen('graduation_photo:')) => $match['similarity'] ?? 0];
                        }

                        if (str_starts_with($externalId, 'photo:')) {
                            return [(int) substr($externalId, strlen('photo:')) => $match['similarity'] ?? 0];
                        }

                        return [];
                    })
                    ->filter(fn ($similarity, $id) => $id > 0);

                $photosQuery = GraduationPhoto::query()
                    ->whereHas('album', function ($q) use ($category) {
                        $q->published();
                        if ($category) {
                            $q->ofCategory($category);
                        }
                    })
                    ->where('resource_type', 'image');

                $photosQuery->where(function ($q) use ($userIds, $directPhotoSimilarity) {
                    if ($directPhotoSimilarity->isNotEmpty()) {
                        $q->whereIn('id', $directPhotoSimilarity->keys()->all());
                    }

                    foreach ($userIds as $uid) {
                        $method = $directPhotoSimilarity->isNotEmpty() ? 'orWhereJsonContains' : 'whereJsonContains';
                        $q->{$method}('ai_metadata->matches', ['user_id' => (int) $uid]);
                    }
                });

                $photos = $photosQuery
                    ->with(['album:id,title,category'])
                    ->select(['id', 'graduation_album_id', 'file_path', 'resource_type', 'ai_metadata'])
                    ->latest()
                    ->limit(30)
                    ->get()
                    ->map(function ($photo) use ($similarityMap, $directPhotoSimilarity) {
                        $aiMatches = $photo->ai_metadata['matches'] ?? [];
                        $topMatch  = collect($aiMatches)
                            ->whereIn('user_id', $similarityMap->keys()->toArray())
                            ->sortByDesc('similarity')
                            ->first();

                        $photo->similarity = $directPhotoSimilarity->get($photo->id)
                            ?? ($topMatch['similarity'] ?? 0);
                        $photo->album_id   = $photo->graduation_album_id;
                        $photo->photo_id   = $photo->id;
                        return $photo;
                    });

            } else {
                // General gallery: search via GalleryMedia Gallery Album
                $directMediaSimilarity = $rawMatches
                    ->mapWithKeys(function ($match) {
                        $externalId = (string) ($match['external_image_id'] ?? '');

                        if (str_starts_with($externalId, 'gallery_media:')) {
                            return [(int) substr($externalId, strlen('gallery_media:')) => $match['similarity'] ?? 0];
                        }

                        return [];
                    })
                    ->filter(fn ($similarity, $id) => $id > 0);

                $mediaRows = GalleryMedia::query()
                    ->where('resource_type', 'image')
                    ->where(function ($q) use ($directMediaSimilarity, $userIds) {
                        if ($directMediaSimilarity->isNotEmpty()) {
                            $q->whereIn('id', $directMediaSimilarity->keys()->all());
                        }

                        if (! empty($userIds)) {
                            $method = $directMediaSimilarity->isNotEmpty() ? 'orWhereHas' : 'whereHas';
                            $q->{$method}('gallery', function ($gq) use ($userIds) {
                                $gq->where(function ($inner) use ($userIds) {
                                    foreach ($userIds as $uid) {
                                        $inner->orWhereJsonContains(
                                            'ai_metadata->matches',
                                            ['user_id' => (int) $uid]
                                        );
                                    }
                                });
                            });
                        }
                    })
                    ->whereHas('gallery', function ($q) {
                        $this->applyGalleryVisibility($q, Auth::user())
                            ->whereHas('album', fn ($aq) => $aq->where('type', 'general'));
                    })
                    ->with([
                        'gallery' => fn ($q) => $q
                            ->select(['id', 'album_id', 'user_id', 'caption', 'ai_metadata'])
                            ->with([
                                'album:id,title',
                                'user:id,name,profile_picture',
                            ]),
                    ])
                    ->select(['id', 'gallery_id', 'file_path', 'resource_type', 'sort_order'])
                    ->orderBy('sort_order')
                    ->limit(30)
                    ->get()
                    ->map(function ($media) use ($similarityMap, $directMediaSimilarity) {
                        $media->similarity      = $directMediaSimilarity->get($media->id)
                            ?? $similarityMap->get($media->gallery?->user_id, 0);
                        $media->album_id        = $media->gallery?->album_id;
                        $media->caption         = $media->gallery?->caption;
                        $media->album           = $media->gallery?->album;
                        $media->name            = $media->gallery?->user?->name;
                        $media->profile_picture = $media->gallery?->user?->profile_picture;
                        return $media;
                    });

                $photos = $mediaRows;
            }
        }

        if (collect($photos)->isEmpty()) {
            $photos = $type === 'graduation'
                ? $this->exactGraduationPhotoMatches($request, $category)
                : $this->exactGalleryMediaMatches($request);

            if (collect($photos)->isNotEmpty()) {
                $result['status'] = 'matched';
            }
        }

        return response()->json([
            'status'  => $result['status'],
            'matches' => collect($result['matches'] ?? [])->filter(fn ($m) => filled($m['user_id']))->values(),
            'photos'  => $photos,
        ]);
    }

    // DELETE /api/gallery/media/{mediaId}
    private function exactGalleryMediaMatches(Request $request)
    {
        $file = $request->file('face_image');
        $path = $file?->getRealPath();

        if (! $path || ! is_readable($path)) {
            return collect();
        }

        $uploadedBytes = file_get_contents($path);
        if ($uploadedBytes === false || $uploadedBytes === '') {
            return collect();
        }

        $uploadedSize = strlen($uploadedBytes);
        $uploadedHash = md5($uploadedBytes);

        return GalleryMedia::query()
            ->where('resource_type', 'image')
            ->where('bytes', $uploadedSize)
            ->whereHas('gallery', function ($q) {
                $this->applyGalleryVisibility($q, Auth::user())
                    ->whereHas('album', fn ($aq) => $aq->where('type', 'general'));
            })
            ->with([
                'gallery' => fn ($q) => $q
                    ->select(['id', 'album_id', 'user_id', 'caption', 'ai_metadata'])
                    ->with([
                        'album:id,title',
                        'user:id,name,profile_picture',
                    ]),
            ])
            ->limit(30)
            ->get()
            ->filter(fn ($media) => $this->remoteHashMatches($media->file_path, $uploadedHash))
            ->map(function ($media) {
                $media->similarity      = 100;
                $media->album_id        = $media->gallery?->album_id;
                $media->caption         = $media->gallery?->caption;
                $media->album           = $media->gallery?->album;
                $media->name            = $media->gallery?->user?->name;
                $media->profile_picture = $media->gallery?->user?->profile_picture;
                $media->match_source    = 'exact_file';
                return $media;
            })
            ->values();
    }

    private function exactGraduationPhotoMatches(Request $request, ?string $category)
    {
        $file = $request->file('face_image');
        $path = $file?->getRealPath();

        if (! $path || ! is_readable($path)) {
            return collect();
        }

        $uploadedBytes = file_get_contents($path);
        if ($uploadedBytes === false || $uploadedBytes === '') {
            return collect();
        }

        $uploadedHash = md5($uploadedBytes);

        return GraduationPhoto::query()
            ->where('resource_type', 'image')
            ->whereHas('album', function ($q) use ($category) {
                $q->published();
                if ($category) {
                    $q->ofCategory($category);
                }
            })
            ->with(['album:id,title,event_date,category'])
            ->latest()
            ->limit(200)
            ->get()
            ->filter(fn ($photo) => $this->remoteHashMatches($photo->file_path, $uploadedHash))
            ->map(function ($photo) {
                $photo->similarity = 100;
                $photo->album_id = $photo->graduation_album_id;
                $photo->photo_id = $photo->id;
                $photo->graduation_photo_id = $photo->id;
                $photo->match_source = 'exact_file';
                return $photo;
            })
            ->values();
    }

    private function remoteHashMatches(?string $url, string $hash): bool
    {
        if (! $url) {
            return false;
        }

        $context = stream_context_create([
            'http' => ['timeout' => 8, 'follow_location' => true],
            'ssl' => ['verify_peer' => false, 'verify_peer_name' => false],
        ]);

        $bytes = @file_get_contents($url, false, $context);

        return $bytes !== false && $bytes !== '' && md5($bytes) === $hash;
    }

    public function destroyMedia(int $mediaId): JsonResponse
    {
        $media   = GalleryMedia::with('gallery.album')->findOrFail($mediaId);
        $gallery = $media->gallery;
        $actor   = Auth::user();

        abort_unless(
            $actor && (
                $actor->role === 'admin' ||
                $gallery?->user_id === $actor->id ||
                $gallery?->album?->user_id === $actor->id
            ),
            403,
            'You can only delete media that you uploaded.'
        );

        $media->delete();

        if ($gallery && $gallery->media()->count() === 0) {
            $gallery->delete();
        }

        return response()->json(['success' => true]);
    }

    // GET /api/gallery/albums
    public function listAlbums(Request $request): JsonResponse
    {
        $type     = $request->query('type', 'general');
        $query = Album::withCount([
            'galleries as photos_count' => fn ($q) => $this->applyGalleryVisibility($q, $request->user()),
        ])->latest('event_date');

        $type === 'graduation' ? $query->graduation() : $query->general();

        $result = $query->get();

        return response()->json([
            'success' => true,
            'data'    => $result,
        ]);
    }

    // POST /api/gallery/albums
    public function storeAlbum(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
            ], 401);
        }

        if ($response = $this->requireSubscribed($request)) {
            return $response;
        }

        $data = $request->validate([
            'title'       => 'required|string|max:255',
            'description' => 'nullable|string',
            'type'        => 'nullable|in:general,graduation',
            'event_date'  => 'nullable|date',
        ]);

        $data['user_id'] = $user->id;
        $data['type']    = $data['type'] ?? 'general';

        $album = Album::create($data);

        return response()->json([
            'success' => true,
            'data'    => $album,
        ], 201);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title'       => 'required|string|max:255',
            'description' => 'nullable|string',
            'type'        => 'nullable|in:general,graduation',
            'event_date'  => 'nullable|date',
        ]);

        $actor = $request->user();
        $data['user_id'] = $actor instanceof User ? $actor->id : null;
        $data['type']    = $data['type'] ?? 'general';

        $album = Album::create($data);

        return response()->json([
            'success' => true,
            'data'    => $album,
        ], 201);
    }

    public function destroy(int $id): JsonResponse
    {
        $album = Album::findOrFail($id);
        $album->delete();

        return response()->json([
            'success' => true,
            'message' => 'Album moved to trash.',
        ]);
    }

    private function requireSubscribed(Request $request): ?JsonResponse
    {
        if (! \App\Support\SubscriptionAccess::isStandard($request->user())) {
            return response()->json([
                'success' => false,
                'message' => 'Gallery uploads require a Standard or Premium subscription.',
                'code' => 'UPGRADE_REQUIRED',
            ], 403);
        }

        return null;
    }

    private function applyGalleryVisibility($query, ?User $viewer)
    {
        return $query->where(function ($visibilityQuery) use ($viewer) {
            $visibilityQuery->where(function ($public) {
                $public->where('status', 'approved')
                    ->where('visibility', 'public');
            });

            if (! $viewer) {
                return;
            }

            $visibilityQuery->orWhere('user_id', $viewer->id);

            if ($viewer->batch_id) {
                $visibilityQuery->orWhere(function ($batchmates) use ($viewer) {
                    $batchmates->where('status', 'approved')
                        ->whereIn('visibility', ['friends', 'batchmates'])
                        ->whereHas('user', fn ($user) => $user->where('batch_id', $viewer->batch_id));
                });
            }
        });
    }

}
