<?php

namespace App\Http\Controllers\API\AI;

use App\Contracts\FaceRecognition;
use App\Http\Controllers\Controller;
use App\Http\Resources\TaggedPhotoResource;
use App\Jobs\AI\AnalyzePhotoFaces;
use App\Models\AuditLog;
use App\Models\GalleryMedia;
use App\Models\GraduationPhoto;
use App\Models\Photo;
use App\Models\Setting;
use App\Models\TaggedPhoto;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class FaceRecognitionController extends Controller
{
    public function __construct(
        private readonly FaceRecognition $faceRecognition,
    ) {}

    /**
     * Index faces into AWS Rekognition.
     *
     * Mobile (authenticated student): POST { image_base64, student_id? }
     * Admin bulk sync (no image_base64): re-index all students with profile photos.
     */
    public function syncStudents(Request $request): JsonResponse
    {
        if ($request->filled('image_base64')) {
            return $this->registerFaceFromBase64($request);
        }

        $this->ensureAdmin($request);

        try {
            $students = User::with('studentRecord')
                ->where(function ($query) {
                    $query->whereNotNull('profile_picture')
                        ->where('profile_picture', '!=', '');
                })
                ->orWhereHas('studentRecord', function ($query) {
                    $query->whereNotNull('photo')
                        ->where('photo', '!=', '');
                })
                ->get();
            $result   = $this->faceRecognition->syncStudents($students);

            AuditLog::record(
                $request,
                'Sync Faces',
                "Indexed: {$result['indexed']}, Skipped: {$result['skipped']}"
            );

            return response()->json([
                'success' => true,
                'indexed' => $result['indexed'],
                'skipped' => $result['skipped'],
                'errors'  => $result['errors'] ?? [],
            ]);
        } catch (\Exception $e) {
            AuditLog::record($request, 'Sync Faces Error', $e->getMessage(), 'Warning');

            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Real-time face registration from a mobile base64 capture.
     * Indexes the face into AWS Rekognition ONLY — does not change profile_picture.
     */
    private function registerFaceFromBase64(Request $request): JsonResponse
    {
        $actor = $request->user();

        if (! $actor) {
            return response()->json([
                'success' => false,
                'message' => 'Authentication required.',
            ], 401);
        }

        $request->validate([
            'image_base64' => 'required|string',
            'student_id'   => 'nullable|string|max:255',
            'user_id'      => 'nullable|integer',
        ]);

        if (! $this->faceRecognition->isEnabled()) {
            return response()->json([
                'success' => false,
                'message' => 'Face recognition is not configured on the server.',
                'code'    => 'FACE_RECOGNITION_DISABLED',
            ], 503);
        }

        $target = $this->resolveFaceSyncTarget($request, $actor);

        if (! $target) {
            return response()->json([
                'success' => false,
                'message' => 'Student identifier does not match an allowed account.',
                'code'    => 'STUDENT_MISMATCH',
            ], 403);
        }

        $raw = (string) $request->input('image_base64');
        if (str_contains($raw, ',')) {
            $raw = substr($raw, strpos($raw, ',') + 1);
        }

        $bytes = base64_decode($raw, true);
        if ($bytes === false || strlen($bytes) < 256) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid face image payload.',
                'code'    => 'INVALID_FACE_IMAGE',
            ], 422);
        }

        try {
            $indexResult = $this->faceRecognition->indexStudentFromBytes(
                $target->loadMissing('studentRecord'),
                $bytes
            );
        } catch (\Throwable $e) {
            Log::warning('Face sync failed', [
                'user_id' => $target->id,
                'error'   => $e->getMessage(),
            ]);
            AuditLog::record($request, 'Face Sync Error', $e->getMessage(), 'Warning');

            return response()->json([
                'success' => false,
                'message' => 'Unable to register face. Please try again.',
                'code'    => 'FACE_SYNC_ERROR',
            ], 500);
        }

        if (! ($indexResult['indexed'] ?? false)) {
            AuditLog::record(
                $request,
                'Face Sync Failed',
                $indexResult['reason'] ?? 'No face indexed',
                'Failed'
            );

            return response()->json([
                'success' => false,
                'message' => $indexResult['reason']
                    ?? 'No usable face was detected. Please retake the photo in good lighting.',
                'code'    => 'FACE_NOT_INDEXED',
            ], 422);
        }

        AuditLog::record(
            $request,
            'Face Sync Success',
            "User #{$target->id} face indexed via mobile sync (Rekognition only; profile_picture unchanged)"
        );

        return response()->json([
            'success'           => true,
            'message'           => 'Face registered successfully.',
            'indexed'           => true,
            'user_id'           => $target->id,
            'student_id'        => $target->student_id,
            'external_image_id' => $indexResult['external_image_id'] ?? null,
            'face_records'      => $indexResult['face_records'] ?? 0,
        ]);
    }

    /**
     * Resolve which user account the face should be indexed against.
     */
    private function resolveFaceSyncTarget(Request $request, User $actor): ?User
    {
        $isAdmin = in_array($actor->role, ['admin', 'super_admin'], true);
        $studentId = $request->filled('student_id')
            ? trim((string) $request->input('student_id'))
            : null;
        $userId = $request->filled('user_id')
            ? (int) $request->input('user_id')
            : null;

        if ($userId) {
            if (! $isAdmin && $userId !== (int) $actor->id) {
                return null;
            }

            return User::with('studentRecord')->find($userId);
        }

        if ($studentId !== null && $studentId !== '') {
            $matchesSelf =
                (string) $actor->student_id === $studentId
                || (string) $actor->id === $studentId
                || (string) ($actor->student_record_id ?? '') === $studentId;

            if ($matchesSelf) {
                return $actor->loadMissing('studentRecord');
            }

            if (! $isAdmin) {
                return null;
            }

            return User::with('studentRecord')
                ->where('student_id', $studentId)
                ->orWhere('id', $studentId)
                ->orWhere('student_record_id', $studentId)
                ->first();
        }

        return $actor->loadMissing('studentRecord');
    }

    // Search for a student by uploaded face photo 

    public function search(Request $request): JsonResponse
    {
        $request->validate([
            'face_image' => 'required|image|max:5120',
        ]);

        try {
            $threshold = (float) Setting::getValue('face_recognition_threshold', '75');
            $file      = $request->file('face_image');

            // Search Rekognition returns ALL matches (student:X and photo:X)
            $rekognitionResult = $this->faceRecognition->searchIndexedFaces($file, 30, $threshold);

            $rawMatches   = collect($rekognitionResult['matches'] ?? []);
            $matches      = $rawMatches
                ->filter(fn ($m) => filled($m['account_user_id'] ?? $m['user_id'] ?? null))
                ->map(function (array $match) {
                    $studentRecordId = $match['student_record_id'] ?? $match['user_id'] ?? null;
                    $accountUserId   = $match['account_user_id'] ?? $match['user_id'] ?? null;

                    return array_merge($match, [
                        'user_id' => $accountUserId ? (int) $accountUserId : null,
                        'student_record_id' => $studentRecordId ? (int) $studentRecordId : null,
                    ]);
                })
                ->filter(fn ($m) => filled($m['user_id']))
                ->values()
                ->all();
            $studentIds   = [];
            $photoIds     = [];
            $galleryMediaIds = [];
            $graduationPhotoIds = [];

            foreach ($rawMatches as $match) {
                $extId = (string) ($match['external_image_id'] ?? '');

                if (str_starts_with($extId, 'student:')) {
                    $studentIds[] = (int) substr($extId, strlen('student:'));
                } elseif (str_starts_with($extId, 'graduation_photo:')) {
                    $graduationPhotoIds[] = (int) substr($extId, strlen('graduation_photo:'));
                } elseif (str_starts_with($extId, 'gallery_media:')) {
                    $galleryMediaIds[] = (int) substr($extId, strlen('gallery_media:'));
                } elseif (str_starts_with($extId, 'photo:')) {
                    $photoIds[] = (int) substr($extId, strlen('photo:'));
                }
            }

            $studentIds = array_unique($studentIds);
            $photoIds   = array_unique($photoIds);
            $galleryMediaIds = array_unique($galleryMediaIds);
            $graduationPhotoIds = array_unique($graduationPhotoIds);

            // Get photos directly matched by face
            $directPhotos = Photo::whereIn('id', $photoIds)
                ->with('album:id,title,event_date')
                ->get()
                ->map(fn ($p) => [
                    'photo_id'  => $p->id,
                    'file_path' => $p->file_path,
                    'caption'   => $p->caption,
                    'album'     => $p->album ? [
                        'id'         => $p->album->id,
                        'title'      => $p->album->title,
                        'event_date' => $p->album->event_date,
                    ] : null,
                    'source' => 'direct_match',
                ])
                ->values()
                ->all();

            $directGraduationPhotos = GraduationPhoto::whereIn('id', $graduationPhotoIds)
                ->with('album:id,title,event_date,category')
                ->get()
                ->map(fn ($p) => [
                    'photo_id' => $p->id,
                    'graduation_photo_id' => $p->id,
                    'file_path' => $p->file_path,
                    'caption' => null,
                    'album' => $p->album ? [
                        'id' => $p->album->id,
                        'title' => $p->album->title,
                        'event_date' => $p->album->event_date,
                        'category' => $p->album->category,
                    ] : null,
                    'source' => 'graduation_direct_match',
                ])
                ->values()
                ->all();

            $directGalleryMedia = GalleryMedia::whereIn('id', $galleryMediaIds)
                ->where('resource_type', 'image')
                ->with([
                    'gallery' => fn ($q) => $q
                        ->select(['id', 'album_id', 'user_id', 'caption', 'status', 'visibility'])
                        ->with('album:id,title,event_date,type'),
                ])
                ->get()
                ->filter(fn ($m) => $m->gallery?->status === 'approved' && $m->gallery?->visibility === 'public')
                ->map(fn ($m) => [
                    'photo_id' => $m->gallery_id,
                    'gallery_media_id' => $m->id,
                    'gallery_id' => $m->gallery_id,
                    'file_path' => $m->file_path,
                    'caption' => $m->gallery?->caption,
                    'album' => $m->gallery?->album ? [
                        'id' => $m->gallery->album->id,
                        'title' => $m->gallery->album->title,
                        'event_date' => $m->gallery->album->event_date,
                        'type' => $m->gallery->album->type,
                    ] : null,
                    'source' => 'gallery_media_direct_match',
                ])
                ->values()
                ->all();

            // Get photos from tagged_photos for matched students
            $taggedPhotos = [];
            if (!empty($studentIds)) {
                $taggedPhotos = TaggedPhoto::whereIn('user_id', $studentIds)
                    ->with(['photo:id,file_path,caption,album_id', 'photo.album:id,title,event_date'])
                    ->get()
                    ->map(fn ($t) => [
                        'photo_id'  => $t->photo_id,
                        'file_path' => $t->photo?->file_path,
                        'caption'   => $t->photo?->caption,
                        'album'     => $t->photo?->album ? [
                            'id'         => $t->photo->album->id,
                            'title'      => $t->photo->album->title,
                            'event_date' => $t->photo->album->event_date,
                        ] : null,
                        'source' => 'tagged',
                    ])
                    ->values()
                    ->all();
            }

            // Merge and deduplicate
            $allPhotos = collect(array_merge($directPhotos, $directGraduationPhotos, $directGalleryMedia, $taggedPhotos))
                ->unique(fn ($p) => ($p['graduation_photo_id'] ?? null)
                    ? 'graduation:' . $p['graduation_photo_id']
                    : (($p['gallery_media_id'] ?? null)
                        ? 'gallery_media:' . $p['gallery_media_id']
                        : 'photo:' . ($p['photo_id'] ?? '')))
                ->values()
                ->all();

            $status = count($matches) > 0 || count($allPhotos) > 0 ? 'matched' : 'no_matches';

            AuditLog::record($request, 'Face Search',
                'Students found: ' . count($matches) . ', photos found: ' . count($allPhotos)
            );

            return response()->json([
                'status'  => $status,
                'matches' => $matches,
                'photos'  => $allPhotos,
                'message' => $status === 'matched' ? null : 'No matching faces found.',
            ]);

        } catch (\Exception $e) {
            AuditLog::record($request, 'Face Search Error', $e->getMessage(), 'Warning');

            return response()->json([
                'status'  => 'error',
                'matches' => [],
                'photos'  => [],
                'message' => $e->getMessage(),
            ], 500);
        }
    }
    // Return face tags for a single photo

    public function photoTags(int $photo): JsonResponse
    {
        $photo = Photo::find($photo);

        if (! $photo) {
            return response()->json([
                'photo_id'    => null,
                'status'      => 'not_found',
                'face_count'  => 0,
                'analyzed_at' => null,
                'provider'    => 'aws-rekognition',
                'tags'        => [],
            ]);
        }

        $tags = $photo->taggedPhotos()
            ->with('user:id,name,profile_picture,student_record_id')
            ->orderByDesc('similarity')
            ->get();

        $meta = $photo->ai_metadata ?? [];

        return response()->json([
            'photo_id'    => $photo->id,
            'status' => data_get($meta, 'status', $tags->isEmpty() ? 'pending' : 'analyzed'),
            'face_count'  => data_get($meta, 'face_count', $tags->count()),
            'analyzed_at' => data_get($meta, 'analyzed_at'),
            'provider'    => data_get($meta, 'provider', 'aws-rekognition'),
            'tags'        => TaggedPhotoResource::collection($tags),
            
        ]);
    }

    // Admin: queue analysis for a single photo 

    public function analyzePhoto(Request $request, Photo $photo): JsonResponse
    {
        $this->ensureAdmin($request);

        AnalyzePhotoFaces::dispatch($photo, force: true);
        AuditLog::record($request, 'Photo Analyze', "Queued Photo #{$photo->id}");

        return response()->json(['queued' => true, 'photo_id' => $photo->id]);
    }

    // Admin: bulk-queue analysis for every photo in an album
    // Staggers dispatch 2s apart to respect Rekognition TPS limits.

    public function analyzeAlbum(Request $request, int $albumId): JsonResponse
    {
        $this->ensureAdmin($request);

        $photos = Photo::where('album_id', $albumId)->get();
        $count  = 0;

        foreach ($photos as $index => $photo) {
            AnalyzePhotoFaces::dispatch($photo, force: true)
                ->delay(now()->addSeconds($index * 2));
            $count++;
        }

        AuditLog::record($request, 'Album Analyze', "Queued {$count} photos in Album #{$albumId}");

        return response()->json([
            'queued'   => $count,
            'album_id' => $albumId,
            'message'  => "Face analysis queued for {$count} photo(s).",
        ]);
    }

    // All gallery photos a student appears in

    public function studentPhotos(int $userId): JsonResponse
    {
        $tags = TaggedPhoto::where('user_id', $userId)
            // Include both AI and manual tags
            ->whereIn('source', ['rekognition', 'manual'])
            // Only show approved tags 
            ->where(function ($q) {
                $q->where('status', 'approved')
                ->orWhereNull('status'); // keep backward compat for old AI tags
            })
            // Only tags that have a valid photo_id 
            ->whereNotNull('photo_id')
            ->with([
                'photo:id,file_path,caption,album_id,user_id,created_at,ai_metadata',
                'photo.album:id,title,event_date',
                'photo.media:id,photo_id,file_path,public_id,resource_type,sort_order',
                'photo.user:id,name,profile_picture,student_record_id',
                'photo.taggedStudents:id,name,profile_picture,student_record_id',
            ])
            ->orderByDesc('created_at') // more reliable than similarity for mixed sources
            ->paginate(24);

        return response()->json([
            'data' => collect($tags->items())->map(fn (TaggedPhoto $t) => [
                'tag_id'     => $t->id,
                'photo_id'   => $t->photo_id,
                'similarity' => $t->similarity,
                'confidence' => $t->confidence,
                'source'     => $t->source,
                'photo'      => $t->photo ? [
                    'id'        => $t->photo->id,
                    'file_path' => $t->photo->file_path,
                    'caption'   => $t->photo->caption,
                    'user_id'   => $t->photo->user_id,
                    'created_at' => $t->photo->created_at,
                    'ai_metadata' => $t->photo->ai_metadata,
                    'media'     => $t->photo->media->map(fn ($m) => [
                        'file_path'     => $m->file_path,
                        'public_id'     => $m->public_id,
                        'resource_type' => $m->resource_type,
                        'sort_order'    => $m->sort_order,
                    ])->values(),
                    'user'      => $t->photo->user ? [
                        'id'              => $t->photo->user->id,
                        'name'            => $t->photo->user->name,
                        'profile_picture' => $t->photo->user->profile_picture,
                    ] : null,
                    'tagged_students' => $t->photo->taggedStudents->map(fn ($u) => [
                        'id'              => $u->id,
                        'name'            => $u->name,
                        'profile_picture' => $u->profile_picture,
                    ])->values(),
                    'album'     => $t->photo->album ? [
                        'id'         => $t->photo->album->id,
                        'title'      => $t->photo->album->title,
                        'event_date' => $t->photo->album->event_date,
                    ] : null,
                ] : null,
            ]),
            'meta' => [
                'total'        => $tags->total(),
                'current_page' => $tags->currentPage(),
                'last_page'    => $tags->lastPage(),
            ],
        ]);
    }

    // Private
    private function ensureAdmin(Request $request): void
    {
        if ($request->user()?->role !== 'admin') {
            abort(403, 'Unauthorized access.');
        }
    }
}
