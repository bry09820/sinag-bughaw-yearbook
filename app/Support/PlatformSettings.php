<?php

namespace App\Support;

use App\Models\Setting;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

class PlatformSettings
{
    public const ALLOWED_KEYS = [
        'school_name',
        'yearbook_name',
        'contact_email',
        'maintenance_mode',
        'academic_year',
        'graduation_batch',
        'graduation_date',
        'graduation_theme',
        'publish_yearbook',
        'max_upload_size_mb',
        'allowed_file_types',
        'allow_student_posts',
        'allow_comments',
        'allow_reactions',
        'enable_premium_subscription',
        'premium_storage_limit_mb',
        'premium_badge_display',
        'enable_flipbook_viewer',
        'enable_yearbook_pdf_download',
        'enable_student_directory_search',
        'session_timeout_minutes',
        'max_login_attempts',
        'auto_backup_database',
        'audit_logs_enabled',
    ];

    public const GRADUATION_KEYS = [
        'academic_year',
        'graduation_batch',
        'graduation_date',
        'graduation_theme',
        'publish_yearbook',
    ];

    /** Safe keys exposed to the student app (no security-sensitive values). */
    public const PUBLIC_KEYS = [
        'school_name',
        'yearbook_name',
        'contact_email',
        'maintenance_mode',
        'academic_year',
        'graduation_batch',
        'graduation_date',
        'graduation_theme',
        'publish_yearbook',
        'max_upload_size_mb',
        'allowed_file_types',
        'allow_student_posts',
        'allow_comments',
        'allow_reactions',
        'enable_premium_subscription',
        'premium_badge_display',
        'enable_flipbook_viewer',
        'enable_yearbook_pdf_download',
        'enable_student_directory_search',
    ];

    public const DEFAULTS = [
        'school_name'                      => 'National University - Lipa',
        'yearbook_name'                    => 'Sinag-Bughaw Digital Yearbook',
        'contact_email'                    => '',
        'maintenance_mode'                 => '0',
        'academic_year'                    => '2025-2026',
        'graduation_batch'                 => '',
        'graduation_date'                  => '',
        'graduation_theme'                 => '',
        'publish_yearbook'                 => '0',
        'max_upload_size_mb'               => '10',
        'allowed_file_types'               => 'jpg,jpeg,png,mp4,mp3,pdf',
        'allow_student_posts'              => '1',
        'allow_comments'                   => '1',
        'allow_reactions'                  => '1',
        'enable_premium_subscription'      => '1',
        'premium_storage_limit_mb'         => '5120',
        'premium_badge_display'            => '1',
        'enable_flipbook_viewer'           => '1',
        'enable_yearbook_pdf_download'     => '1',
        'enable_student_directory_search'  => '1',
        'session_timeout_minutes'          => '120',
        'max_login_attempts'               => '5',
        'auto_backup_database'             => '0',
        'audit_logs_enabled'               => '1',
    ];

    private const EXTENSION_MIMES = [
        'jpg'  => ['image/jpeg'],
        'jpeg' => ['image/jpeg'],
        'png'  => ['image/png'],
        'gif'  => ['image/gif'],
        'webp' => ['image/webp'],
        'heic' => ['image/heic', 'image/heif'],
        'heif' => ['image/heif', 'image/heic'],
        'mp4'  => ['video/mp4', 'video/mpeg'],
        'mov'  => ['video/quicktime'],
        'mpeg' => ['video/mpeg'],
        'webm' => ['video/webm'],
        'avi'  => ['video/x-msvideo'],
        'mp3'  => ['audio/mpeg', 'audio/mp3'],
        'pdf'  => ['application/pdf'],
    ];

    public static function all(): array
    {
        try {
            $stored = Setting::query()
                ->whereIn('key', self::ALLOWED_KEYS)
                ->pluck('value', 'key');

            return array_merge(self::DEFAULTS, $stored->all());
        } catch (QueryException $e) {
            Log::warning('PlatformSettings::all failed; using defaults', [
                'message' => $e->getMessage(),
            ]);

            return self::DEFAULTS;
        }
    }

    public static function publicConfig(): array
    {
        $all = self::all();

        return array_intersect_key(
            $all,
            array_flip(self::PUBLIC_KEYS)
        );
    }

    public static function get(string $key, ?string $default = null): string
    {
        $fallback = $default ?? self::DEFAULTS[$key] ?? '';

        try {
            return (string) (Setting::getValue($key, $fallback) ?? $fallback);
        } catch (QueryException $e) {
            Log::warning('PlatformSettings::get failed; using default', [
                'key'     => $key,
                'message' => $e->getMessage(),
            ]);

            return (string) $fallback;
        }
    }

    public static function bool(string $key): bool
    {
        return self::get($key) === '1';
    }

    public static function isAuditLoggingEnabled(): bool
    {
        return self::bool('audit_logs_enabled');
    }

    public static function uploadMaxKilobytes(): int
    {
        $mb = max(1, (int) self::get('max_upload_size_mb'));

        return $mb * 1024;
    }

    /** @return list<string> */
    public static function allowedMimeTypes(): array
    {
        $extensions = array_filter(array_map(
            'trim',
            explode(',', strtolower(self::get('allowed_file_types')))
        ));

        $mimes = [];
        foreach ($extensions as $ext) {
            foreach (self::EXTENSION_MIMES[$ext] ?? [] as $mime) {
                $mimes[] = $mime;
            }
        }

        return array_values(array_unique($mimes ?: [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'video/mp4', 'video/quicktime',
        ]));
    }

    public static function premiumStorageLimitBytes(): int
    {
        $mb = max(100, (int) self::get('premium_storage_limit_mb'));

        return $mb * 1024 * 1024;
    }

    public static function directoryRoles(): array
    {
        return ['student', 'alumni'];
    }

    public static function featureDisabled(string $featureKey, string $label): ?JsonResponse
    {
        if (self::bool($featureKey)) {
            return null;
        }

        return response()->json([
            'message' => "{$label} is currently disabled by the administrator.",
            'code'    => 'FEATURE_DISABLED',
            'feature' => $featureKey,
        ], 403);
    }

    public static function maintenanceResponse(): JsonResponse
    {
        return response()->json([
            'message'          => 'Sinag-Bughaw is under maintenance. Please try again later.',
            'code'             => 'MAINTENANCE',
            'maintenance_mode' => true,
            'contact_email'    => self::get('contact_email'),
        ], 503);
    }

    public static function validationRulesForKeys(array $keys): array
    {
        $all = [
            'school_name'                     => 'nullable|string|max:255',
            'yearbook_name'                   => 'nullable|string|max:255',
            'contact_email'                   => 'nullable|email|max:255',
            'maintenance_mode'                => 'in:0,1',
            'academic_year'                   => 'nullable|string|max:32',
            'graduation_batch'                => 'nullable|string|max:255',
            'graduation_date'                 => 'nullable|date_format:Y-m-d',
            'graduation_theme'                => 'nullable|string|max:255',
            'publish_yearbook'                => 'in:0,1',
            'max_upload_size_mb'              => 'integer|min:1|max:500',
            'allowed_file_types'              => 'nullable|string|max:500',
            'allow_student_posts'             => 'in:0,1',
            'allow_comments'                  => 'in:0,1',
            'allow_reactions'                 => 'in:0,1',
            'enable_premium_subscription'     => 'in:0,1',
            'premium_storage_limit_mb'        => 'integer|min:100|max:102400',
            'premium_badge_display'           => 'in:0,1',
            'enable_flipbook_viewer'          => 'in:0,1',
            'enable_yearbook_pdf_download'    => 'in:0,1',
            'enable_student_directory_search' => 'in:0,1',
            'session_timeout_minutes'         => 'integer|min:15|max:1440',
            'max_login_attempts'              => 'integer|min:1|max:20',
            'auto_backup_database'            => 'in:0,1',
            'audit_logs_enabled'              => 'in:0,1',
        ];

        return array_intersect_key($all, array_flip($keys));
    }
}
