<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\HandleCors;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web:      __DIR__.'/../routes/web.php',
        api:      __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health:   '/up',
    )
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['middleware' => ['auth:sanctum']]
    )
    ->withMiddleware(function (Middleware $middleware) {

        // CORS first — before everything including auth 
        $middleware->prepend(HandleCors::class);

        $middleware->statefulApi();

        // Override the login redirect so API routes never hit route('login')
        $middleware->redirectUsersTo(function (\Illuminate\Http\Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return null; // returns 401 JSON — no redirect
            }
            return '/login'; // SPA handles this on the frontend
        });

        $middleware->validateCsrfTokens(except: [
            'api/*',
        ]);

        $middleware->api(append: [
            \App\Http\Middleware\CheckMaintenanceMode::class,
            \App\Http\Middleware\SecurityHeaders::class,
            \App\Http\Middleware\EnsureAccountIsActive::class,
        ]);

        $middleware->alias([
            'auth'                => \App\Http\Middleware\Authenticate::class,

            'premium'             => \App\Http\Middleware\CheckPremium::class,
            'standard'            => \App\Http\Middleware\CheckStandard::class,
            'consent'             => \App\Http\Middleware\CheckConsent::class,
            'visibility'          => \App\Http\Middleware\CheckProfileVisibility::class,
            'content.security'    => \App\Http\Middleware\ContentSecurityMiddleware::class,
            'subscription.access' => \App\Http\Middleware\CheckSubscriptionAccess::class,
            'admin.only'          => \App\Http\Middleware\AdminOnly::class,
            'feature'             => \App\Http\Middleware\EnsureFeatureEnabled::class,
            'require.super_admin' => \App\Http\Middleware\RequireSuperAdmin::class,
            'active.account'      => \App\Http\Middleware\EnsureAccountIsActive::class,
            'verified'            => \App\Http\Middleware\EnsureEmailIsVerified::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {

        // ─Catch-all: any unauthenticated API request returns 401 JSON 
        $exceptions->render(function (
            \Illuminate\Auth\AuthenticationException $e,
            \Illuminate\Http\Request $request
        ) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return response()->json([
                    'message' => 'Unauthenticated.',
                ], 401);
            }
        });
    })
    ->withSchedule(function (\Illuminate\Console\Scheduling\Schedule $schedule) {

        //Session file garbage collection 
        $schedule->command('session:gc')->daily();

        // Memory digest emails ─
        $schedule->command('memory:send-digest')->weeklyOn(1, '08:00');
    })
    ->create();
