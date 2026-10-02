<?php

namespace App\Providers;

use App\Contracts\FaceRecognition;
use App\Contracts\StorageServiceInterface;
use App\Models\Photo;
use App\Observers\PhotoObserver;
use App\Policies\PhotoPolicy;
use App\Services\AI\AwsRekognitionFaceRecognition;
use App\Services\Notification\BrevoMailService;
use App\Services\Storage\CloudinaryService;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Face Recognition
        $this->app->singleton(FaceRecognition::class, function () {
            return new AwsRekognitionFaceRecognition([
                'key'        => config('services.rekognition.key'),
                'secret'     => config('services.rekognition.secret'),
                'region'     => config('services.rekognition.region'),
                'collection' => config('services.rekognition.collection'),
                'threshold'  => config('services.rekognition.threshold', 90),
            ]);
        });

        // Storage / Cloudinary (credentials only via config/cloudinary.php)
        $this->app->singleton(StorageServiceInterface::class, function () {
            if (
                ! config('cloudinary.cloud_name')
                || ! config('cloudinary.api_key')
                || ! config('cloudinary.api_secret')
            ) {
                return new \App\Services\Storage\LocalStorageService();
            }

            return new CloudinaryService();
        });

        // Brevo email API
        $this->app->singleton(BrevoMailService::class, fn() => new BrevoMailService());

        // WatermarkService (yearbook PDF watermarking) 
        if (class_exists(\App\Services\Yearbook\WatermarkService::class)) {
            $this->app->singleton(
                \App\Services\Yearbook\WatermarkService::class,
                \App\Services\Yearbook\WatermarkService::class,
            );
        }
    }

    public function boot(): void
    {
        // Hostinger / shared hosting sits behind a reverse proxy — force HTTPS URLs in production.
        if ($this->app->environment('production')) {
            URL::forceScheme('https');

            // Skipped in console so render-start.sh's cache commands stay DB-free.
            if (! $this->app->runningInConsole()) {
                try {
                    \Illuminate\Support\Facades\Artisan::call('migrate', ['--force' => true]);
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning('Auto-migrate failed: ' . $e->getMessage());
                }
            }
        }

        Photo::observe(PhotoObserver::class);

        Gate::policy(Photo::class, PhotoPolicy::class);
    }
}
