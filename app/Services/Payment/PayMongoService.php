<?php

namespace App\Services\Payment;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PayMongoService
{
    private string $baseUrl = 'https://api.paymongo.com/v1';
    private string $secretKey;
    private string $publicKey;
    private string $webhookSecret;

    /** Digital wallets + card shown on PayMongo Checkout. */
    public const PAYMENT_METHOD_TYPES = ['gcash', 'paymaya', 'card'];

    public function __construct()
    {
        $this->secretKey = config('services.paymongo.secret_key')
            ?? throw new \RuntimeException('PAYMONGO_SECRET_KEY is not set in .env');

        $this->publicKey = (string) (config('services.paymongo.public_key') ?? '');
        $this->webhookSecret = (string) (config('services.paymongo.webhook_secret') ?? '');
    }

    public function createCheckoutSession(
        int $amount,
        string $plan,
        int $userId,
        string $userEmail,
        string $currency = 'PHP',
        ?string $successUrl = null,
        ?string $cancelUrl = null
    ): array {
        $frontendUrl = rtrim((string) config('app.frontend_url'), '/');

        $payload = [
            'data' => [
                'attributes' => [
                    'billing' => [
                        'email' => $userEmail,
                    ],
                    'line_items' => [[
                        'currency' => $currency,
                        'amount'   => $amount,
                        'name'     => 'Sinag-Bughaw Premium – ' . ucfirst(str_replace('_', ' ', $plan)),
                        'quantity' => 1,
                    ]],
                    // Explicit wallet + card options for hosted checkout
                    'payment_method_types' => self::PAYMENT_METHOD_TYPES,
                    'metadata' => [
                        'user_id' => (string) $userId,
                        'plan'    => $plan,
                    ],
                    'success_url' => $successUrl ?: $frontendUrl . '/payment/success',
                    'cancel_url'  => $cancelUrl ?: $frontendUrl . '/payment/cancel',
                    'description' => 'Sinag-Bughaw Premium Access',
                ],
            ],
        ];

        $response = Http::withBasicAuth($this->secretKey, '')
            ->acceptJson()
            ->asJson()
            ->post("{$this->baseUrl}/checkout_sessions", $payload);

        $json = $response->json() ?? [];

        if (! $response->successful()) {
            Log::warning('PayMongo createCheckoutSession failed', [
                'status' => $response->status(),
                'body'   => $json,
            ]);
        }

        return $json;
    }

    public function retrieveCheckoutSession(string $sessionId): array
    {
        $response = Http::withBasicAuth($this->secretKey, '')
            ->acceptJson()
            ->get("{$this->baseUrl}/checkout_sessions/{$sessionId}");

        return $response->json() ?? [];
    }

    public function verifyWebhookSignature(?string $signatureHeader, string $rawBody): bool
    {
        if (! $signatureHeader || $this->webhookSecret === '') {
            return false;
        }

        $parts = [];
        foreach (explode(',', $signatureHeader) as $part) {
            if (! str_contains($part, '=')) {
                continue;
            }
            [$k, $v] = explode('=', $part, 2);
            $parts[trim($k)] = trim($v);
        }

        $timestamp = $parts['t'] ?? null;
        if (! $timestamp) {
            return false;
        }

        $payload = $timestamp . '.' . $rawBody;
        $expected = hash_hmac('sha256', $payload, $this->webhookSecret);

        foreach (['te', 'li'] as $key) {
            $provided = $parts[$key] ?? null;
            if ($provided && hash_equals($expected, $provided)) {
                return true;
            }
        }

        Log::warning('PayMongo webhook signature mismatch', [
            'has_te' => isset($parts['te']),
            'has_li' => isset($parts['li']),
        ]);

        return false;
    }

    public function hasWebhookSecret(): bool
    {
        return $this->webhookSecret !== '';
    }

    public function publicKey(): string
    {
        return $this->publicKey;
    }
}
