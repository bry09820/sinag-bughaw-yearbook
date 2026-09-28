<?php

/**
 * CORS for SPA (Vercel) + mobile clients talking to Hostinger API.
 *
 * Production origins MUST be set via CORS_ALLOWED_ORIGINS in .env
 * (comma-separated). Local Vite defaults remain for development only.
 */
$localOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
];

$productionDefaults = [
    'https://sinag-bughaw.vercel.app',
    'https://sinagbughawadmin.vercel.app',
];

$fromEnv = array_values(array_filter(array_map(
    'trim',
    explode(',', (string) env('CORS_ALLOWED_ORIGINS', ''))
)));

$isLocal = in_array(env('APP_ENV', 'production'), ['local', 'development'], true);

return [
    'paths' => [
        'api/*',
        'broadcasting/auth',
        'sanctum/csrf-cookie',
        'auth/*',
    ],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_values(array_unique(array_filter(array_merge(
        $isLocal ? $localOrigins : [],
        $productionDefaults,
        $fromEnv
    )))),

    // Dev/LAN patterns only — never open private-network origins in production.
    'allowed_origins_patterns' => $isLocal ? [
        '#^https?://172\.20\.10\.\d+(:\d+)?$#',
        '#^https?://192\.168\.\d+\.\d+(:\d+)?$#',
        '#^https?://10\.\d+\.\d+\.\d+(:\d+)?$#',
        '#^exp://172\.20\.10\.\d+(:\d+)?$#',
        '#^exp://192\.168\.\d+\.\d+(:\d+)?$#',
    ] : [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 3600,

    'supports_credentials' => true,
];
