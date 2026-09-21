<?php

namespace App\Http\Controllers;

use App\Services\Payment\PayMongoService;
use App\Support\PlatformSettings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class BillingController extends Controller
{
    private array $plans = [
        'standard_monthly' => ['tier' => 'standard', 'amount' => 9900,  'duration' => 'month'],
        'standard_yearly'  => ['tier' => 'standard', 'amount' => 79900, 'duration' => 'year'],
        'premium_monthly'  => ['tier' => 'premium',  'amount' => 19900, 'duration' => 'month'],
        'premium_yearly'   => ['tier' => 'premium',  'amount' => 149900, 'duration' => 'year'],
    ];

    /**
     * Create a PayMongo Checkout Session and redirect (or return JSON) to checkout_url.
     *
     * GET/POST /billing
     * GET/POST /billing/checkout
     * GET/POST /api/billing/checkout
     */
    public function checkout(Request $request)
    {
        if (! PlatformSettings::bool('enable_premium_subscription')) {
            return $this->fail($request, 'Premium subscriptions are currently disabled.', 403);
        }

        $user = $request->user();
        if (! $user) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return response()->json(['message' => 'Unauthenticated.'], 401);
            }

            $frontend = rtrim((string) env('FRONTEND_URL', 'http://localhost:5173'), '/');
            return redirect()->away($frontend . '/login?redirect=/premium');
        }

        $validated = $request->validate([
            'plan'        => 'nullable|in:standard_monthly,standard_yearly,premium_monthly,premium_yearly',
            'success_url' => 'nullable|string|max:2048',
            'cancel_url'  => 'nullable|string|max:2048',
            'redirect'    => 'nullable|boolean',
        ]);

        $planKey = $validated['plan'] ?? 'premium_monthly';
        $plan    = $this->plans[$planKey];

        try {
            $result = app(PayMongoService::class)->createCheckoutSession(
                amount: $plan['amount'],
                plan: $planKey,
                userId: $user->id,
                userEmail: (string) $user->email,
                successUrl: $validated['success_url'] ?? null,
                cancelUrl: $validated['cancel_url'] ?? null,
            );
        } catch (\Throwable $e) {
            Log::error('Billing checkout failed', ['error' => $e->getMessage()]);
            return $this->fail($request, 'Could not start checkout. Please try again.', 502);
        }

        Log::info('PayMongo billing checkout response', $result);

        $checkoutUrl = data_get($result, 'data.attributes.checkout_url');
        $sessionId   = data_get($result, 'data.id');

        if (! $checkoutUrl) {
            $detail = data_get($result, 'errors.0.detail')
                ?? data_get($result, 'message')
                ?? 'PayMongo did not return a checkout URL.';

            return $this->fail($request, $detail, 422, [
                'paymongo_error' => data_get($result, 'errors') ?? $result,
            ]);
        }

        // Browser / billing page visit → send user to PayMongo hosted checkout.
        // API clients always receive JSON (never a blind redirect that looks like a 404).
        $wantsRedirect = $request->boolean('redirect', ! $request->is('api/*'))
            && ! $request->expectsJson()
            && ! $request->wantsJson()
            && ! $request->ajax()
            && ! $request->is('api/*');

        if ($wantsRedirect) {
            return redirect()->away($checkoutUrl);
        }

        return response()->json([
            'checkout_url'         => $checkoutUrl,
            'session_id'           => $sessionId,
            'plan'                 => $planKey,
            'payment_method_types' => \App\Services\Payment\PayMongoService::PAYMENT_METHOD_TYPES,
        ]);
    }

    private function fail(Request $request, string $message, int $status = 422, array $extra = [])
    {
        if ($request->expectsJson() || $request->is('api/*') || $request->boolean('json')) {
            return response()->json(array_merge(['message' => $message], $extra), $status);
        }

        $frontend = rtrim((string) env('FRONTEND_URL', 'http://localhost:5173'), '/');
        return redirect()->away($frontend . '/premium?checkout_error=' . urlencode($message));
    }
}
