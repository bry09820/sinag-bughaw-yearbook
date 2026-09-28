<?php

use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Laravel\Sanctum\Http\Middleware\AuthenticateSession;
use Laravel\Sanctum\Sanctum;

return [

    /*
    |--------------------------------------------------------------------------
    | Stateful Domains
    |--------------------------------------------------------------------------
    |
    | Set SANCTUM_STATEFUL_DOMAINS in .env for production (Hostinger + Vercel),
    | e.g. your-api.hostinger.com,sinag-bughaw.vercel.app,sinagbughawadmin.vercel.app
    |
    */

    'stateful' => array_values(array_filter(array_map('trim', explode(',', env('SANCTUM_STATEFUL_DOMAINS', sprintf(
        '%s%s',
        'localhost,localhost:3000,localhost:5173,localhost:8000,127.0.0.1,127.0.0.1:8000,127.0.0.1:5173,::1,',
        Sanctum::currentApplicationUrlWithPort(),
    )))))),

    'guard' => ['web'],

    'expiration' => (int) env('SANCTUM_EXPIRATION', 480),

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),

    'middleware' => [
        'authenticate_session' => AuthenticateSession::class,
        'encrypt_cookies' => EncryptCookies::class,
        'validate_csrf_token' => ValidateCsrfToken::class,
    ],

];
