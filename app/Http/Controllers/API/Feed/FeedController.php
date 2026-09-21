<?php

namespace App\Http\Controllers\API\Feed;

use App\Http\Controllers\Controller;
use App\Models\ContentView;
use App\Models\Photo;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class FeedController extends Controller
{
    /**
     * GET /api/feed
     *
     * filter = all | public | batchmates | mine
     */
    public function index(Request $request): JsonResponse
    {
        $user    = $request->user();
        $filter  = $request->query('filter', 'all');
        $search  = trim((string) $request->query('q', ''));
        $perPage = (int) $request->query('per_page', 10);

        $user->loadMissing('studentRecord');

        $query = Photo::query()
            ->with([
                'user' => function ($q) {
                    $q->select('id', 'name', 'first_name', 'last_name', 'profile_picture', 'batch_id', 'student_record_id')
                        ->withCount([
                            'photos as feed_posts_count' => fn ($photo) => $photo->where('status', 'approved'),
                            'taggedPhotos as feed_tagged_count' => fn ($tag) => $tag->where('status', 'approved'),
                        ]);
                },
                'user.studentRecord:id,course,photo',
                'taggedStudents:id,name,first_name,last_name,student_record_id',
                'taggedStudents.studentRecord:id,course,photo',
                'media',
            ])
            ->where('status', 'approved');

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('caption', 'like', "%{$search}%")
                    ->orWhereHas('user', function ($userQuery) use ($search) {
                        $userQuery->where('name', 'like', "%{$search}%")
                            ->orWhere('email', 'like', "%{$search}%")
                            ->orWhereHas('studentRecord', function ($studentQuery) use ($search) {
                                $studentQuery->where('student_no', 'like', "%{$search}%")
                                    ->orWhere('course', 'like', "%{$search}%")
                                    ->orWhere('first_name', 'like', "%{$search}%")
                                    ->orWhere('last_name', 'like', "%{$search}%");
                            });
                    })
                    ->orWhereHas('taggedStudents', function ($studentQuery) use ($search) {
                        $studentQuery->where('name', 'like', "%{$search}%")
                            ->orWhereHas('studentRecord', function ($recordQuery) use ($search) {
                                $recordQuery->where('student_no', 'like', "%{$search}%")
                                    ->orWhere('course', 'like', "%{$search}%")
                                    ->orWhere('first_name', 'like', "%{$search}%")
                                    ->orWhere('last_name', 'like', "%{$search}%");
                            });
                    });
            });
        }

        match ($filter) {

            //Public filter
            'public' => $query->where('visibility', 'public'),

            // Batchmates filter
            'batchmates' => $query
                ->where('visibility', 'friends')
                ->whereHas('user', fn ($q) => $this->constrainBatchmateAuthor($q, $user)),

            // Mine filter 
            'mine' => $query->where('user_id', $user->id),

            // All filter (default) 
            default => $query->where(fn ($q) => $q
                ->where('visibility', 'public')
                ->orWhere('user_id', $user->id)
                ->orWhere(fn ($q2) => $q2
                    ->where('visibility', 'friends')
                    ->whereHas('user', fn ($q3) => $this->constrainBatchmateAuthor($q3, $user))
                )
            ),
        };

        $paginator = $query
            ->orderByDesc('created_at')
            ->paginate($perPage);

        return response()->json([
            'data' => $paginator->map(fn (Photo $photo) =>
                $this->formatPost($photo, $user)
            ),
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page'    => $paginator->lastPage(),
                'per_page'     => $paginator->perPage(),
                'total'        => $paginator->total(),
            ],
        ]);
    }

    public function recordView(Request $request, Photo $photo): JsonResponse
    {
        $user = $request->user();

        if (! $this->canViewPost($photo, $user)) {
            abort(404);
        }

        if ($photo->user_id !== $user->id) {
            ContentView::firstOrCreate(
                [
                    'content_type'   => 'post',
                    'content_id'     => $photo->id,
                    'viewer_user_id' => $user->id,
                ],
                [
                    'viewer_ip' => $request->ip(),
                    'title'     => $photo->caption ?: 'Feed post',
                    'category'  => $photo->visibility,
                    'url'       => "/students/{$photo->user_id}?post={$photo->id}",
                ]
            );
        }

        return response()->json([
            'recorded'    => true,
            'views_count' => ContentView::where('content_type', 'post')
                ->where('content_id', $photo->id)
                ->count(),
        ]);
    }

    private function formatPost(Photo $photo, User $authUser): array
    {
        // Media handling 
        $media = $photo->media->isNotEmpty()
            ? $photo->media->map(fn ($m) => [
                'id'            => $m->id,
                'file_path'     => $m->file_path,
                'resource_type' => $m->resource_type,
                'width'         => $m->width,
                'height'        => $m->height,
                'is_reported'   => (bool) $m->is_reported,
            ])->values()->toArray()
            : ($photo->file_path ? [[
                'id'            => null,
                'file_path'     => $photo->file_path,
                'resource_type' => $photo->ai_metadata['resource_type'] ?? 'image',
                'width'         => null,
                'height'        => null,
                'is_reported'   => false,
            ]] : []);

        // User data 
        $userData = $photo->user
            ? [
                'id'              => $photo->user->id,
                'name'            => $this->displayName($photo->user),
                'course'          => $photo->user->course,
                'profile_picture' => $photo->user->profile_picture,
                'posts_count'     => (int) ($photo->user->feed_posts_count ?? 0),
                'tagged_count'    => (int) ($photo->user->feed_tagged_count ?? 0),
            ]
            : null;

        // Tagged students 
        $taggedStudents = $photo->taggedStudents->map(fn ($s) => [
            'id'              => $s->id,
            'name'            => $this->displayName($s),
            'course'          => $s->course,
            'profile_picture' => $s->profile_picture,
        ])->values()->toArray();

        return [
            'id'              => $photo->id,
            'caption'         => $photo->caption,
            'visibility'      => $photo->visibility === 'friends' ? 'batchmates' : $photo->visibility,
            'is_profile_post' => $photo->is_profile_post,
            'views_count'     => ContentView::where('content_type', 'post')
                ->where('content_id', $photo->id)
                ->count(),
            'time_ago'        => $photo->created_at?->diffForHumans() ?? '',
            'created_at'      => $photo->created_at?->toIso8601String(),

            'user_id' => $photo->user_id,
            'user'   => $userData,

            'media'           => $media,
            'is_reported'     => collect($media)->contains(fn ($m) => (bool) ($m['is_reported'] ?? false)),

            'tagged_students' => $taggedStudents,
        ];
    }

    private function displayName(User $user): string
    {
        return trim((string) $user->name)
            ?: trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''))
            ?: 'Student';
    }

    private function constrainBatchmateAuthor($query, User $viewer): void
    {
        $viewer->loadMissing('studentRecord');

        $year      = $viewer->graduation_year;
        $course    = trim((string) $viewer->course);
        $sectionId = $viewer->section_id ?: $viewer->studentRecord?->section_id;

        if (! $year) {
            $query->whereRaw('1 = 0');
            return;
        }

        $query
            ->where(function ($author) use ($year) {
                $author
                    ->where('graduation_year', $year)
                    ->orWhereHas('studentRecord', fn ($student) =>
                        $student->where('graduation_year', $year)
                    );
            })
            ->where(function ($author) use ($course, $sectionId) {
                if ($sectionId) {
                    $author
                        ->orWhere('section_id', $sectionId)
                        ->orWhereHas('studentRecord', fn ($student) =>
                            $student->where('section_id', $sectionId)
                        );
                }

                if ($course !== '') {
                    $author
                        ->orWhere('course', $course)
                        ->orWhereHas('studentRecord', fn ($student) =>
                            $student->where('course', $course)
                        );
                }

                if (! $sectionId && $course === '') {
                    $author->whereRaw('1 = 0');
                }
            });
    }

    private function canViewPost(Photo $photo, User $viewer): bool
    {
        if ((int) $photo->user_id === (int) $viewer->id) {
            return true;
        }

        if ($photo->visibility === 'public') {
            return true;
        }

        if ($photo->visibility !== 'friends') {
            return false;
        }

        $photo->loadMissing('user.studentRecord');

        return $photo->user instanceof User && $this->areBatchmates($viewer, $photo->user);
    }

    private function areBatchmates(User $viewer, User $author): bool
    {
        $viewer->loadMissing('studentRecord');
        $author->loadMissing('studentRecord');

        $viewerYear = $viewer->graduation_year;
        $authorYear = $author->graduation_year;

        if (! $viewerYear || ! $authorYear || (int) $viewerYear !== (int) $authorYear) {
            return false;
        }

        $viewerSection = $viewer->section_id ?: $viewer->studentRecord?->section_id;
        $authorSection = $author->section_id ?: $author->studentRecord?->section_id;

        if ($viewerSection && $authorSection && (int) $viewerSection === (int) $authorSection) {
            return true;
        }

        $viewerCourse = trim((string) $viewer->course);
        $authorCourse = trim((string) $author->course);

        return $viewerCourse !== '' && $authorCourse !== '' && strcasecmp($viewerCourse, $authorCourse) === 0;
    }
}
