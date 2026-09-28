<?php

namespace App\Services\Analytics;

use App\Models\User;
use App\Models\ContentView;
use App\Models\ProfileView;
use Illuminate\Support\Facades\DB;

class EngagementAnalyticsService
{
    public function summary(): array
    {
        return [
            'total_students' => User::whereIn('role', ['student', 'alumni'])->count(),
            'total_photos'   => DB::table('photos')->count(),
            'total_messages' => DB::table('messages')->count(),
            'total_tagged'   => DB::table('tagged_photos')->where('status', 'approved')->count(),
        ];
    }

    public function myStats(User $user): array
    {
        return [
            'profile_views'     => $user->profile_views,
            'photos_uploaded'   => $user->photos()->count(),
            'times_tagged'      => $user->taggedPhotos()->where('status', 'approved')->count(),
            'messages_sent'     => DB::table('messages')->where('sender_id', $user->id)->count(),
            'messages_received' => DB::table('messages')->where('receiver_id', $user->id)->count(),
        ];
    }

    public function batchmateStats(User $user): array
    {
        $topProfiles = User::where('batch_id', $user->batch_id)
            ->whereIn('role', ['student', 'alumni'])
            ->where('profile_visibility', 'public')
            ->where('id', '!=', $user->id)
            ->orderByDesc('profile_views')
            ->take(5)
            ->with('studentRecord:id,course,graduation_year,photo')
            ->get(['id', 'name', 'profile_picture', 'profile_views', 'student_record_id', 'role'])
            ->map(fn($u) => [
                'id'              => $u->id,
                'name'            => $u->name,
                'profile_picture' => $u->profile_picture,
                'course'          => $u->course,
                'batch'           => $u->batch,
                'graduation_year' => $u->graduation_year,
                'role'            => $u->role,
                'views'           => $u->profile_views,
            ]);

        return [
            'batch_id'     => $user->batch_id,
            'top_profiles' => $topProfiles,
        ];
    }

    public function topViewed(int $limit = 10): array
    {
        // Use Eloquent + eager-load studentRecord so accessors work.
        return User::whereIn('role', ['student', 'alumni'])
            ->where('profile_visibility', 'public')
            ->orderByDesc('profile_views')
            ->take($limit)
            ->with('studentRecord:id,course,graduation_year,photo')
            ->get(['id', 'name', 'profile_picture', 'profile_views', 'student_record_id', 'role'])
            ->map(fn($u) => [
                'id'              => $u->id,
                'name'            => $u->name,
                'profile_picture' => $u->profile_picture,
                'course'          => $u->course,
                'batch'           => $u->batch,
                'graduation_year' => $u->graduation_year,
                'role'            => $u->role,
                'views'           => $u->profile_views,
            ])
            ->toArray();
    }

    public function trending(int $limit = 10): array
    {
        // Join students table (via student_record_id) to get the real columns,
        // and use users.profile_picture which now exists after the migration.
        return DB::table('profile_views')
            ->select(
                'profile_views.viewed_user_id as id',
                DB::raw('COUNT(*) as views_this_week'),
                'users.name',
                'users.profile_picture',
                'users.role',
                'students.course',
                'students.graduation_year as batch',
                'students.graduation_year',
                'users.profile_views as total_views'
            )
            ->join('users', 'users.id', '=', 'profile_views.viewed_user_id')
            ->leftJoin('students', 'students.id', '=', 'users.student_record_id')
            ->where('profile_views.created_at', '>=', now()->subDays(7))
            ->where('users.profile_visibility', 'public')
            ->whereIn('users.role', ['student', 'alumni'])
            ->whereNull('users.deleted_at')
            ->groupBy(
                'profile_views.viewed_user_id',
                'users.name',
                'users.profile_picture',
                'users.role',
                'students.course',
                'students.graduation_year',
                'users.profile_views'
            )
            ->orderByDesc('views_this_week')
            ->limit($limit)
            ->get()
            ->toArray();
    }

    // Core record logic 
    public function recordView(int $viewedUserId, ?int $viewerUserId, string $ipAddress): void
    {
        if ($viewerUserId && $viewerUserId === $viewedUserId) {
            return;
        }

        $alreadyViewed = ProfileView::where('viewed_user_id', $viewedUserId)
            ->where(function ($q) use ($viewerUserId, $ipAddress) {
                if ($viewerUserId) {
                    $q->where('viewer_user_id', $viewerUserId);
                } else {
                    $q->whereNull('viewer_user_id')->where('viewer_ip', $ipAddress);
                }
            })
            ->where('created_at', '>=', now()->subHour())
            ->exists();

        if ($alreadyViewed) {
            return;
        }

        ProfileView::create([
            'viewed_user_id' => $viewedUserId,
            'viewer_user_id' => $viewerUserId,
            'viewer_ip'      => $ipAddress,
        ]);

        User::where('id', $viewedUserId)->increment('profile_views');
    }

    public function weeklyTrend(int $userId, int $days = 30): array
    {
        $rows = ProfileView::where('viewed_user_id', $userId)
            ->where('created_at', '>=', now()->subDays($days))
            ->selectRaw('DATE(created_at) as date, COUNT(*) as views')
            ->groupBy('date')
            ->orderBy('date')
            ->pluck('views', 'date')
            ->toArray();

        $filled = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $date          = now()->subDays($i)->toDateString();
            $filled[$date] = $rows[$date] ?? 0;
        }

        return $filled;
    }

    public function platformEngagement(): array
    {
        return [
            'views_today'          => ProfileView::whereDate('created_at', today())->count(),
            'views_this_week'      => ProfileView::where('created_at', '>=', now()->subDays(7))->count(),
            'views_this_month'     => ProfileView::where('created_at', '>=', now()->subDays(30))->count(),
            'unique_viewers_today' => ProfileView::whereDate('created_at', today())
                                        ->whereNotNull('viewer_user_id')
                                        ->distinct('viewer_user_id')
                                        ->count('viewer_user_id'),
        ];
    }

    public function mixedTopViewed(int $limit = 10): array
    {
        $profiles = collect($this->topViewed($limit))
            ->map(fn ($item) => [
                ...$item,
                'type' => 'profile',
                'url'  => "/profile/{$item['id']}",
            ]);

        $content = DB::table('content_views')
            ->select(
                'content_type',
                'content_id',
                DB::raw('MAX(title) as title'),
                DB::raw('MAX(category) as category'),
                DB::raw('MAX(url) as url'),
                DB::raw('COUNT(*) as views')
            )
            ->groupBy('content_type', 'content_id')
            ->orderByDesc('views')
            ->limit($limit)
            ->get()
            ->map(fn ($row) => $this->formatContentViewRow($row, 'views'));

        return $profiles
            ->merge($content)
            ->sortByDesc(fn ($item) => $item['views'] ?? 0)
            ->take($limit)
            ->values()
            ->toArray();
    }

    public function mixedTrending(int $limit = 10): array
    {
        $profiles = collect($this->trending($limit))
            ->map(function ($item) {
                $row = (array) $item;
                $row['type'] = 'profile';
                $row['url'] = "/profile/{$row['id']}";
                return $row;
            });

        $content = DB::table('content_views')
            ->select(
                'content_type',
                'content_id',
                DB::raw('MAX(title) as title'),
                DB::raw('MAX(category) as category'),
                DB::raw('MAX(url) as url'),
                DB::raw('COUNT(*) as views_this_week')
            )
            ->where('created_at', '>=', now()->subDays(7))
            ->groupBy('content_type', 'content_id')
            ->orderByDesc('views_this_week')
            ->limit($limit)
            ->get()
            ->map(fn ($row) => $this->formatContentViewRow($row, 'views_this_week'));

        return $profiles
            ->merge($content)
            ->sortByDesc(fn ($item) => $item['views_this_week'] ?? 0)
            ->take($limit)
            ->values()
            ->toArray();
    }

    public function recordContentView(
        string $contentType,
        int $contentId,
        ?int $viewerUserId,
        string $ipAddress,
        ?string $title = null,
        ?string $category = null,
        ?string $url = null
    ): void {
        $allowed = [
            'batch',
            'post',
            'gallery_album',
            'gallery_photo',
            'graduation_album',
            'graduation_photo',
            'graduation_video',
            'graduation_program',
            'graduation_invitation',
            'graduation_song',
            'graduation_speech',
            'baccalaureate_mass',
            'yearbook',
        ];

        if (! in_array($contentType, $allowed, true)) {
            return;
        }

        $alreadyViewed = ContentView::where('content_type', $contentType)
            ->where('content_id', $contentId)
            ->where(function ($q) use ($viewerUserId, $ipAddress) {
                if ($viewerUserId) {
                    $q->where('viewer_user_id', $viewerUserId);
                } else {
                    $q->whereNull('viewer_user_id')->where('viewer_ip', $ipAddress);
                }
            })
            ->where('created_at', '>=', now()->subHour())
            ->exists();

        if ($alreadyViewed) {
            return;
        }

        ContentView::create([
            'content_type'   => $contentType,
            'content_id'     => $contentId,
            'viewer_user_id' => $viewerUserId,
            'viewer_ip'      => $ipAddress,
            'title'          => $title,
            'category'       => $category,
            'url'            => $url,
        ]);
    }

    private function formatContentViewRow(object $row, string $viewsKey): array
    {
        $views = (int) ($row->{$viewsKey} ?? 0);

        return [
            'id'              => "{$row->content_type}:{$row->content_id}",
            'content_id'      => (int) $row->content_id,
            'type'            => $row->content_type,
            'name'            => $row->title ?: $this->labelForContentType($row->content_type),
            'profile_picture' => null,
            'course'          => $this->labelForContentType($row->content_type),
            'batch'           => $row->category,
            'graduation_year' => null,
            'views'           => $views,
            'views_this_week' => $views,
            'total_views'     => $views,
            'url'             => $row->url ?: '#',
        ];
    }

    private function labelForContentType(string $type): string
    {
        return match ($type) {
            'batch'                 => 'Batch',
            'post'                  => 'Post',
            'gallery_album'         => 'Gallery Album',
            'gallery_photo'         => 'Gallery Photo',
            'graduation_album'      => 'Graduation Album',
            'graduation_photo'      => 'Graduation Photo',
            'graduation_video'      => 'Graduation Video',
            'graduation_program'    => 'Program',
            'graduation_invitation' => 'Invitation',
            'graduation_song'       => 'Grad Song',
            'graduation_speech'     => 'Speech',
            'baccalaureate_mass'    => 'Baccalaureate Mass',
            'yearbook'              => 'Yearbook',
            default                 => ucwords(str_replace('_', ' ', $type)),
        };
    }
}
