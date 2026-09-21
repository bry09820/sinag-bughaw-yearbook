<?php

return [
    'api_key'      => env('BREVO_API_KEY'),
    'from_address' => env('BREVO_FROM_ADDRESS', env('MAIL_FROM_ADDRESS', 'noreply@sinag-bughaw.local')),
    'from_name'    => env('BREVO_FROM_NAME', env('MAIL_FROM_NAME', 'Sinag-Bughaw')),

    // SMTP relay fallback (used when the REST API rejects the request, e.g. IP allowlist).
    'smtp' => [
        'host'       => env('BREVO_HOST', env('MAIL_HOST', 'smtp-relay.brevo.com')),
        'port'       => (int) env('BREVO_PORT', env('MAIL_PORT', 587)),
        'username'   => env('BREVO_USERNAME', env('MAIL_USERNAME')),
        'password'   => env('BREVO_PASSWORD', env('MAIL_PASSWORD')),
        'encryption' => env('BREVO_ENCRYPTION', 'tls'),
        'scheme'     => env('BREVO_SCHEME', env('MAIL_SCHEME')),
    ],
];
