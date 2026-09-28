<?php

namespace App\Http\Controllers\API\Yearbook;

use App\Http\Controllers\Controller;
use App\Models\Batch;
use App\Models\Faculty;
use App\Models\Section;
use App\Models\Subscription;
use App\Models\User;
use App\Services\Security\DownloadAuditService;
use App\Services\Yearbook\WatermarkService;
use App\Support\PlatformSettings;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Illuminate\Support\Facades\Storage;

class YearbookPdfController extends Controller
{
    private const EXPORT_CACHE_VERSION = 'premium-fit-page-v6';

    public function __construct(
        private WatermarkService $watermark,
        private DownloadAuditService $downloadAudit,
    ) {}

    public function export(Request $request, int $batchId)
    {
        @set_time_limit(300);
        @ini_set('max_execution_time', '300');
        @ini_set('memory_limit', '1024M');

        $batch = Batch::findOrFail($batchId);
        $scope = $this->yearbookScope($request);
        $batchYear = $batch->year ?? now()->year;
        $filename = "yearbook-{$batchYear}{$this->yearbookScopeFileSuffix($scope)}.pdf";
        $cachePath = $this->yearbookExportCachePath($batchId, $batchYear, $scope);

        if (! $request->boolean('refresh') && Storage::exists($cachePath)) {
            return $this->watermarkedPdfResponse($request, $cachePath, $filename);
        }

        $faculties = Faculty::orderBy('name')
            ->get()
            ->map(fn ($faculty) => [
                'name' => $faculty->name,
                'title' => $faculty->title ?? 'Faculty',
                'department' => $faculty->department ?? '',
                'bio' => $faculty->bio ?? '',
                'email' => $faculty->email ?? '',
                'photo' => $this->resolveImageBase64($faculty->image ?? null),
            ])
            ->values()
            ->toArray();

        $facultyChunks = array_chunk($faculties, 4);

        $sections = Section::where('batch_id', $batchId)
            ->when($scope['department'] !== '', fn ($query) => $query->where('department', $scope['department']))
            ->when($scope['course'] !== '', fn ($query) => $query->where('course', $scope['course']))
            ->with(['students' => fn ($query) => $query->orderBy('last_name')->orderBy('first_name'), 'adviser'])
            ->orderBy('department')
            ->orderBy('course')
            ->orderBy('name')
            ->get()
            ->map(function ($section) {
                $students = $section->students
                    ->map(fn ($student) => $this->mapStudentForPdf($student))
                    ->values()
                    ->toArray();

                return [
                    'id' => $section->id,
                    'name' => $section->name,
                    'course' => $section->course ?? $section->strand ?? '',
                    'adviser' => $section->adviser?->name ?? '',
                    'student_count' => count($students),
                    'students' => $students,
                    'studentChunks' => array_chunk($students, 2),
                ];
            })
            ->values()
            ->toArray();

        if (empty($sections)) {
            return $this->withCorsHeaders($request, response()->json([
                'message' => 'No sections found for the selected yearbook scope.',
            ], 404));
        }

        $settings = PlatformSettings::all();
        $schoolName = $settings['school_name'] ?? config('app.name', 'National University');
        $yearbookTitle = $settings['yearbook_name'] ?? 'Sinag-Bughaw Yearbook';
        $classTheme = $settings['graduation_theme'] ?? 'Legacy in Motion';
        $academicYear = $settings['academic_year'] ?? null;
        $graduationDate = $settings['graduation_date'] ?? null;
        $logoBase64 = isset($settings['school_logo'])
            ? $this->resolveImageBase64($settings['school_logo'])
            : null;
        $logoBase64 ??= $this->resolvePublicImageBase64('images/NU_logo.png');
        $buildingBase64 = $this->resolvePublicImageBase64('images/NU-building.jpg');
        $galleryBase64 = $this->resolvePublicImageBase64('images/gallerynu.jpg');
        $facultyBase64 = $this->resolvePublicImageBase64('images/nufaculty.jpg');

        $students = collect($sections)->flatMap(fn ($section) => $section['students'])->values();
        $stats = [
            'total_graduates' => $students->count(),
            'sections' => count($sections),
            'honors_count' => $students->filter(fn ($student) => !empty($student['honors']))->count(),
            'achievement_count' => $students->filter(fn ($student) => !empty($student['achievements']))->count(),
            'organization_count' => $students->filter(fn ($student) => !empty($student['organizations']))->count(),
            'quote_count' => $students->filter(fn ($student) => !empty($student['quote']) || !empty($student['motto']))->count(),
            'courses' => $students->pluck('course')->filter()->countBy()->sortDesc()->toArray(),
            'honors' => $students->pluck('honors')->filter()->countBy()->sortDesc()->toArray(),
        ];

        $featured = [
            'achievements' => $this->featured($students, 'achievements', 8),
            'organizations' => $this->featured($students, 'organizations', 8),
            'memories' => $this->featured($students, 'fondest_memory', 6),
            'aspirations' => $this->featured($students, 'future_plans', 6),
            'quotes' => $this->featured($students, 'quote', 8),
        ];

        $toc = $this->buildPdfToc($sections, $faculties);

        $pdf = Pdf::loadView('pdf.yearbook-export', compact(
            'schoolName',
            'batchYear',
            'yearbookTitle',
            'classTheme',
            'academicYear',
            'graduationDate',
            'logoBase64',
            'buildingBase64',
            'galleryBase64',
            'facultyBase64',
            'facultyChunks',
            'faculties',
            'sections',
            'students',
            'stats',
            'featured',
            'toc'
        ))
            ->setPaper('A4', 'landscape')
            ->setOptions([
                'isRemoteEnabled' => false,
                'isHtml5ParserEnabled' => true,
                'defaultFont' => 'DejaVu Serif',
                'dpi' => 96,
                'isFontSubsettingEnabled' => true,
            ]);

        $bytes = $pdf->output();
        Storage::put($cachePath, $bytes);

        return $this->watermarkedPdfResponse($request, $cachePath, $filename);
    }

    public function mobileExport(Request $request, int $batchId)
    {
        $token = $request->query('token');

        if (! $token) {
            abort(401, 'Missing token.');
        }

        $accessToken = PersonalAccessToken::findToken($token);
        $user = $accessToken?->tokenable;

        if (! $user instanceof User) {
            abort(401, 'Invalid token.');
        }

        if (PlatformSettings::bool('enable_premium_subscription')) {
            if (! \App\Support\SubscriptionAccess::isStandard($user)) {
                abort(402, 'A Standard or Premium subscription is required to download the yearbook PDF.');
            }
        }

        $request->setUserResolver(fn () => $user);

        return $this->export($request, $batchId);
    }

    private function watermarkedPdfResponse(Request $request, string $sourcePath, string $filename)
    {
        $user = $request->user();
        $watermarkedPath = $this->watermark->apply(
            sourcePath: $sourcePath,
            userName: $user?->name ?: 'Sinag-Bughaw Protected Copy',
            userId: (int) ($user?->id ?? 0),
        );

        $bytes = Storage::get($watermarkedPath);
        $this->downloadAudit->record(
            $request,
            'yearbook_pdf_export',
            'yearbook_export',
            null,
            $filename,
            ['source_path' => $sourcePath, 'watermarked_path' => $watermarkedPath]
        );

        return $this->withCorsHeaders($request, response($bytes, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => "inline; filename=\"{$filename}\"",
            'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma' => 'no-cache',
            'Expires' => '0',
        ]));
    }

    private function shouldWatermarkPdf(?User $user): bool
    {
        if (! $user instanceof User) {
            return true;
        }

        return ! \App\Support\SubscriptionAccess::isPremium($user);
    }

    public function flipbookData(Request $request, int $batchId)
    {
        $batch = Batch::findOrFail($batchId);

        $faculty = Faculty::orderBy('name')
            ->get()
            ->map(fn ($faculty) => [
                'id' => $faculty->id,
                'name' => $faculty->name,
                'department' => $faculty->department ?? '',
                'position' => $faculty->title ?? 'Faculty',
                'photo' => $faculty->image ? $this->resolveImageUrl($faculty->image) : null,
                'email' => $faculty->email ?? null,
                'years' => null,
            ]);

        $sections = Section::where('batch_id', $batchId)
            ->with(['students' => fn ($query) => $query->orderBy('last_name')->orderBy('first_name')])
            ->orderBy('department')
            ->orderBy('course')
            ->orderBy('name')
            ->get()
            ->map(function ($section) {
                return [
                    'id' => $section->id,
                    'name' => $section->name,
                    'course' => $section->course ?? '',
                    'students' => $section->students->map(fn ($student) => [
                        'id' => $student->id,
                        'name' => trim("{$student->first_name} {$student->last_name}"),
                        'student_id' => $student->student_no ?? '',
                        'quote' => $student->student_quote ?? $student->motto ?? '',
                        'photo' => $student->photo ? $this->resolveImageUrl($student->photo) : null,
                        'achievements' => $student->achievements ?? '',
                    ])->values(),
                ];
            });

        $settings = PlatformSettings::all();

        return response()->json([
            'batch' => [
                'id' => $batch->id,
                'year' => $batch->year ?? now()->year,
                'name' => $batch->name ?? "Batch {$batch->year}",
            ],
            'school' => [
                'name' => $settings['school_name'] ?? config('app.name'),
                'logo' => isset($settings['school_logo'])
                    ? $this->resolveImageUrl($settings['school_logo'])
                    : null,
            ],
            'faculty' => $faculty,
            'sections' => $sections,
        ]);
    }

    private function mapStudentForPdf($student): array
    {
        return [
            'name' => trim("{$student->first_name} {$student->last_name}"),
            'student_id' => $student->student_no ?? '',
            'email' => $student->email ?? '',
            'course' => $student->course ?? '',
            'honors' => $student->honors ?? '',
            'nickname' => $student->nickname ?? '',
            'hometown' => $student->hometown ?? '',
            'motto' => $student->motto ?? '',
            'quote' => $student->student_quote ?? '',
            'organizations' => $student->organizations ?? '',
            'achievements' => $student->achievements ?? '',
            'fondest_memory' => $student->fondest_memory ?? '',
            'ambition' => $student->ambition ?? '',
            'future_plans' => $student->future_plans ?? '',
            'message_to_batchmates' => $student->message_to_batchmates ?? '',
            'message_to_parents' => $student->message_to_parents ?? '',
            'most_likely_to' => $student->most_likely_to ?? '',
            'photo' => $this->resolveImageBase64($student->photo ?? null),
        ];
    }

    private function withCorsHeaders(Request $request, $response)
    {
        $origin = $request->headers->get('Origin');

        if ($origin) {
            $response->headers->set('Access-Control-Allow-Origin', $origin);
            $response->headers->set('Access-Control-Allow-Credentials', 'true');
            $response->headers->set('Vary', 'Origin', false);
        }

        $response->headers->set('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type');

        return $response;
    }

    private function yearbookScope(Request $request): array
    {
        return [
            'department' => trim((string) $request->query('department', '')),
            'course' => trim((string) $request->query('course', '')),
        ];
    }

    private function yearbookScopeFileSuffix(array $scope): string
    {
        $value = $scope['course'] !== '' ? $scope['course'] : $scope['department'];

        if ($value === '') {
            return '';
        }

        $slug = strtolower((string) preg_replace('/[^a-zA-Z0-9]+/', '-', $value));
        $slug = trim($slug, '-');

        return $slug !== '' ? "-{$slug}" : '';
    }

    private function yearbookExportCachePath(int $batchId, int|string $batchYear, array $scope): string
    {
        $scopeKey = sha1(json_encode([
            'version' => self::EXPORT_CACHE_VERSION,
            'department' => $scope['department'],
            'course' => $scope['course'],
        ]));

        return "yearbooks/exports/{$batchYear}-{$batchId}-{$scopeKey}.pdf";
    }

    private function featured($students, string $field, int $limit): array
    {
        return collect($students)
            ->filter(fn ($student) => !empty($student[$field]))
            ->take($limit)
            ->values()
            ->toArray();
    }

    private function buildPdfToc(array $sections, array $faculties): array
    {
        $toc = [
            'Cover',
            'Table of Contents',
            'Welcome Messages',
            'Program Overview',
            'Class Statistics',
            'Achievements',
            'Organizations',
            'Memories',
            'Future Aspirations',
        ];

        foreach ($sections as $section) {
            $toc[] = $section['name'];
        }

        if (count($faculties) > 0) {
            $toc[] = 'Faculty';
        }

        $toc[] = 'Graduate Directory';
        $toc[] = 'Closing';

        return $toc;
    }

    private function resolveImageBase64(?string $path): ?string
    {
        if (empty($path)) {
            return null;
        }

        if (str_starts_with($path, 'http')) {
            try {
                $contents = @file_get_contents($path);
                if (!$contents) {
                    return null;
                }

                return 'data:' . $this->guessMime($path) . ';base64,' . base64_encode($contents);
            } catch (\Throwable) {
                return null;
            }
        }

        $clean = ltrim(preg_replace('#^(storage|public)/#', '', $path), '/');

        if (Storage::disk('public')->exists($clean)) {
            $contents = Storage::disk('public')->get($clean);

            return 'data:' . $this->guessMime($clean) . ';base64,' . base64_encode($contents);
        }

        $publicPath = public_path(ltrim($path, '/'));
        if (is_file($publicPath)) {
            return 'data:' . $this->guessMime($publicPath) . ';base64,' . base64_encode(file_get_contents($publicPath));
        }

        $cloudName = config('cloudinary.cloud_name');
        if ($cloudName) {
            $url = "https://res.cloudinary.com/{$cloudName}/image/upload/{$path}";
            $contents = @file_get_contents($url);
            if ($contents) {
                return 'data:' . $this->guessMime($url) . ';base64,' . base64_encode($contents);
            }
        }

        return null;
    }

    private function resolvePublicImageBase64(string $path): ?string
    {
        $fullPath = public_path(ltrim($path, '/'));

        if (!is_file($fullPath)) {
            return null;
        }

        return 'data:' . $this->guessMime($fullPath) . ';base64,' . base64_encode(file_get_contents($fullPath));
    }

    private function resolveImageUrl(?string $path): ?string
    {
        if (empty($path)) {
            return null;
        }

        if (str_starts_with($path, 'http')) {
            return $path;
        }

        $clean = ltrim(preg_replace('#^(storage|public)/#', '', $path), '/');

        if (Storage::disk('public')->exists($clean)) {
            $baseUrl = rtrim(config('filesystems.disks.public.url', url('/storage')), '/');

            return "{$baseUrl}/{$clean}";
        }

        return null;
    }

    private function guessMime(string $path): string
    {
        return match (strtolower(pathinfo($path, PATHINFO_EXTENSION))) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            default => 'image/jpeg',
        };
    }
}
