<?php

declare(strict_types=1);

namespace App\Providers;

use App\Contracts\TranscriptionServiceInterface;
use App\Services\AI\TranscriptionService;
use Illuminate\Support\ServiceProvider;

/**
 * Third-party integration bindings that are not owned by AppServiceProvider.
 * Face recognition and Cloudinary storage are registered in AppServiceProvider
 * via config('services.rekognition') and config('cloudinary').
 */
class IntegrationServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(
            TranscriptionServiceInterface::class,
            TranscriptionService::class
        );
    }

    public function boot(): void {}
}
