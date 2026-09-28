<?php

return [

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key'    => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', env('AWS_REGION', 'ap-southeast-1')),
    ],

    // AWS Rekognition (Singapore region default — closest to PH / Hostinger)
    'rekognition' => [
        'key'        => env('AWS_ACCESS_KEY_ID'),
        'secret'     => env('AWS_SECRET_ACCESS_KEY'),
        'region'     => env('AWS_DEFAULT_REGION', env('AWS_REGION', 'ap-southeast-1')),
        'collection' => env('AWS_REKOGNITION_COLLECTION', 'nu-lipa-yearbook'),
        'threshold'  => (float) env(
            'AWS_REKOGNITION_THRESHOLD',
            env('FACE_RECOGNITION_THRESHOLD', 90)
        ),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel'              => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'firebase' => [
        'credentials' => env('FIREBASE_CREDENTIALS', storage_path('app/firebase-service-account.json')),
    ],

    // Google OAuth (Socialite)
    'google' => [
        'client_id'     => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect'      => env('GOOGLE_REDIRECT_URI'),
    ],

    'google_mobile' => [
        'client_id'     => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect'      => env('GOOGLE_MOBILE_REDIRECT_URI'),
    ],
    'paymongo' => [
        'secret_key'     => env('PAYMONGO_SECRET_KEY'),
        'public_key'     => env('PAYMONGO_PUBLIC_KEY'),
        'webhook_secret' => env('PAYMONGO_WEBHOOK_SECRET'),
    ],

    'groq' => [
        'key'   => env('GROQ_API_KEY'),
        'model' => env('GROQ_WHISPER_MODEL', 'whisper-large-v3-turbo'),
    ],

];