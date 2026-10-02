<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Mailer
    |--------------------------------------------------------------------------
    |
    | Use "log" for local/mobile OTP testing (codes appear in storage/logs).
    | Use "smtp" for Brevo / Mailtrap / Gmail.
    | Use "failover" to try SMTP first, then fall back to log.
    |
    */

    'default' => env('MAIL_MAILER') ?: 'smtp',

    'mailers' => [

        /*
        | Laravel 12 uses MAIL_SCHEME (smtps / null) instead of MAIL_ENCRYPTION.
        | Port 587 (STARTTLS): MAIL_SCHEME=null (or leave empty)
        | Port 465 (SSL):       MAIL_SCHEME=smtps
        */
        'smtp' => [
            'transport' => 'smtp',
            'scheme' => env('MAIL_SCHEME'),
            'url' => env('MAIL_URL'),
            'host' => env('MAIL_HOST', env('BREVO_HOST', '127.0.0.1')),
            'port' => (int) env('MAIL_PORT', env('BREVO_PORT', 587)),
            'username' => env('MAIL_USERNAME', env('BREVO_USERNAME')),
            'password' => env('MAIL_PASSWORD', env('BREVO_PASSWORD')),
            'timeout' => (int) env('MAIL_TIMEOUT', 15),
            'local_domain' => env('MAIL_EHLO_DOMAIN', parse_url((string) env('APP_URL', 'http://localhost'), PHP_URL_HOST)),
        ],

        'brevo' => [
            'transport' => 'smtp',
            'scheme' => env('BREVO_SCHEME', env('MAIL_SCHEME')),
            'host' => env('BREVO_HOST', 'smtp-relay.brevo.com'),
            'port' => (int) env('BREVO_PORT', 587),
            'username' => env('BREVO_USERNAME', env('MAIL_USERNAME')),
            'password' => env('BREVO_PASSWORD', env('MAIL_PASSWORD')),
            'timeout' => (int) env('MAIL_TIMEOUT', 15),
        ],

        'ses' => [
            'transport' => 'ses',
        ],

        'postmark' => [
            'transport' => 'postmark',
        ],

        'resend' => [
            'transport' => 'resend',
        ],

        'sendmail' => [
            'transport' => 'sendmail',
            'path' => env('MAIL_SENDMAIL_PATH', '/usr/sbin/sendmail -bs -i'),
        ],

        'log' => [
            'transport' => 'log',
            'channel' => env('MAIL_LOG_CHANNEL'),
        ],

        'array' => [
            'transport' => 'array',
        ],

        /*
        | Try real SMTP first; if it fails (timeout / auth), write to the log
        | so registration OTP still completes for mobile testing.
        */
        'failover' => [
            'transport' => 'failover',
            'mailers' => [
                'smtp',
                'log',
            ],
            'retry_after' => 60,
        ],

        'roundrobin' => [
            'transport' => 'roundrobin',
            'mailers' => [
                'ses',
                'postmark',
            ],
            'retry_after' => 60,
        ],

    ],

    'from' => [
        'address' => env('MAIL_FROM_ADDRESS', env('BREVO_FROM_ADDRESS', 'noreply@sinag-bughaw.local')),
        'name' => env('MAIL_FROM_NAME', env('BREVO_FROM_NAME', env('APP_NAME', 'Sinag-Bughaw'))),
    ],

];
