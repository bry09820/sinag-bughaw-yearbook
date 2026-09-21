<?php

namespace App\Http\Controllers\API\Payment;

use App\Http\Controllers\Controller;
use App\Jobs\Notification\SendSubscriptionConfirmedEmail;
use App\Jobs\SendPushNotification;
use App\Models\Subscription;
use App\Models\User;
use App\Services\Payment\PayMongoService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Carbon;

class PaymentController extends Controller
{
    private array $plans = [
        'standard_monthly' => ['tier' => 'standard', 'amount' => 9900,   'duration' => 'month'],
        'standard_yearly'  => ['tier' => 'standard', 'amount' => 79900,  'duration' => 'year' ],
        'premium_monthly'  => ['tier' => 'premium',  'amount' => 19900,  'duration' => 'month'],
        'premium_yearly'   => ['tier' => 'premium',  'amount' => 149900, 'duration' => 'year' ],
    ];

    /** PayMongo event types that mean a checkout/payment succeeded. */
    private array $paidEvents = [
        'checkout_session.payment.paid',
        'payment.paid',
        'checkout.session.completed',
    ];

    public function createIntent(Request $request)
    {
        $request->validate([
            'plan'        => 'required|in:standard_monthly,standard_yearly,premium_monthly,premium_yearly',
            'success_url' => 'nullable|string|max:2048',
            'cancel_url'  => 'nullable|string|max:2048',
        ]);

        $planKey = $request->plan;
        $plan    = $this->plans[$planKey];

        $result = app(PayMongoService::class)->createCheckoutSession(
            amount:    $plan['amount'],
            plan:      $planKey,
            userId:    $request->user()->id,
            userEmail: $request->user()->email,
            successUrl: $request->input('success_url'),
            cancelUrl:  $request->input('cancel_url'),
        );

        Log::info('PayMongo response', $result);

        $checkoutUrl = data_get($result, 'data.attributes.checkout_url');

        if (! $checkoutUrl) {
            return response()->json([
                'message'        => 'Could not create checkout session.',
                'paymongo_error' => data_get($result, 'errors.0.detail') ?? $result,
            ], 422);
        }

        // Optional browser redirect (e.g. POST form or ?redirect=1)
        if ($request->boolean('redirect') && ! $request->expectsJson()) {
            return redirect()->away($checkoutUrl);
        }

        return response()->json([
            'checkout_url'         => $checkoutUrl,
            'session_id'           => data_get($result, 'data.id'),
            'payment_method_types' => PayMongoService::PAYMENT_METHOD_TYPES,
        ]);
    }

    public function webhook(Request $request)
    {
        $paymongo = app(PayMongoService::class);
        $signature = $request->header('Paymongo-Signature')
            ?? $request->header('PayMongo-Signature');
        $rawBody = $request->getContent();

        if ($paymongo->hasWebhookSecret()) {
            if (! $paymongo->verifyWebhookSignature($signature, $rawBody)) {
                Log::warning('PayMongo webhook rejected: invalid signature');
                return response()->json(['message' => 'Invalid signature.'], 401);
            }
        } elseif (app()->environment('production')) {
            Log::error('PayMongo webhook rejected: PAYMONGO_WEBHOOK_SECRET is not configured');
            return response()->json(['message' => 'Webhook not configured.'], 503);
        } else {
            Log::warning('PayMongo webhook accepted without signature verification (non-production)');
        }

        Log::info('Webhook RAW payload', $request->all());

        $type = $request->json('data.attributes.type')
            ?? $request->json('type');

        if (! in_array($type, $this->paidEvents, true)) {
            return response()->json(['received' => true, 'ignored' => $type]);
        }

        $eventData = $request->json('data.attributes.data')
            ?? $request->json('data')
            ?? [];

        $sessionAttributes = $eventData['attributes'] ?? [];
        $meta = $sessionAttributes['metadata'] ?? [];

        // payment.paid embeds metadata on the payment; checkout session puts it on the session
        if (empty($meta['user_id'])) {
            $meta = data_get($sessionAttributes, 'metadata', $meta);
        }

        $userId = $meta['user_id'] ?? null;
        $planKey = $meta['plan'] ?? 'standard_monthly';
        $plan = $this->plans[$planKey] ?? $this->plans['standard_monthly'];
        $sessionId = $eventData['id'] ?? null;
        $intentId = $sessionAttributes['payment_intent_id']
            ?? data_get($sessionAttributes, 'payment_intent.id')
            ?? data_get($sessionAttributes, 'payments.0.id')
            ?? $sessionId;
        $amountPaid = $sessionAttributes['amount_paid']
            ?? $sessionAttributes['amount_due']
            ?? $sessionAttributes['amount_total']
            ?? data_get($sessionAttributes, 'payments.0.attributes.amount')
            ?? data_get($sessionAttributes, 'line_items.0.amount')
            ?? $sessionAttributes['amount']
            ?? $plan['amount'];

        Log::info('Parsed webhook data', [
            'type'      => $type,
            'user_id'   => $userId,
            'plan'      => $planKey,
            'intent_id' => $intentId,
            'amount'    => $amountPaid,
        ]);

        if (! $userId) {
            Log::warning('PayMongo webhook: missing user_id in metadata');
            return response()->json(['received' => true]);
        }

        $this->activateSubscription(
            userId: (int) $userId,
            planKey: $planKey,
            intentId: (string) $intentId,
            amountPaid: (int) $amountPaid,
            notify: true,
        );

        return response()->json(['received' => true]);
    }

    public function confirm(Request $request)
    {
        $validated = $request->validate([
            'session_id' => 'required|string|max:255',
        ]);

        $result = app(PayMongoService::class)
            ->retrieveCheckoutSession($validated['session_id']);

        if (data_get($result, 'errors')) {
            Log::warning('PayMongo confirm failed', [
                'session_id' => $validated['session_id'],
                'errors'     => data_get($result, 'errors'),
            ]);

            return response()->json([
                'message' => data_get($result, 'errors.0.detail', 'Could not verify payment.'),
            ], 422);
        }

        $attributes = data_get($result, 'data.attributes', []);
        $metadata   = $attributes['metadata'] ?? [];
        $userId     = (int) ($metadata['user_id'] ?? 0);
        $planKey    = $metadata['plan'] ?? 'standard_monthly';

        if ($userId !== (int) $request->user()->id) {
            return response()->json([
                'message' => 'This payment session does not belong to the logged-in user.',
            ], 403);
        }

        $payments = $attributes['payments'] ?? [];
        $hasPayment = is_array($payments) && count($payments) > 0;
        $paymentStatus = strtolower((string) ($attributes['payment_status'] ?? ''));

        if (! $hasPayment && $paymentStatus !== 'paid') {
            return response()->json([
                'message' => 'Payment is not completed yet. Please wait a moment and try again.',
                'status'  => $paymentStatus ?: 'pending',
            ], 422);
        }

        $plan       = $this->plans[$planKey] ?? $this->plans['standard_monthly'];
        $intentId   = $attributes['payment_intent_id']
            ?? data_get($attributes, 'payment_intent.id')
            ?? data_get($attributes, 'payments.0.id')
            ?? $validated['session_id'];
        $amountPaid = $attributes['amount_paid']
            ?? $attributes['amount_due']
            ?? $attributes['amount_total']
            ?? data_get($attributes, 'payments.0.attributes.amount')
            ?? $plan['amount'];

        $subscription = $this->activateSubscription(
            userId: $userId,
            planKey: $planKey,
            intentId: (string) $intentId,
            amountPaid: (int) $amountPaid,
            notify: false,
        );

        return response()->json([
            'message'      => 'Subscription confirmed.',
            'subscription' => $subscription,
            'subscription_status' => $subscription->tier,
            'tier' => $subscription->tier,
            'is_subscribed' => true,
            'is_premium' => $subscription->isPremium(),
        ]);
    }

    public function history(Request $request)
    {
        return response()->json(
            Subscription::where('user_id', $request->user()->id)->latest()->get()
        );
    }

    public function subscriptionStatus(Request $request)
    {
        $sub = Subscription::where('user_id', $request->user()->id)->latest()->first();
        $active = $sub?->isActive() ? $sub : null;

        return response()->json([
            'is_active'            => (bool) $active,
            'is_standard'          => $active?->isStandard() ?? false,
            'is_premium'           => $active?->isPremium() ?? false,
            'is_subscribed'        => (bool) $active,
            'subscription_status'  => $active?->tier ?? 'free',
            'tier'                 => $active?->tier ?? 'free',
            'plan'                 => $active?->plan ?? null,
            'expires_at'           => $active?->expires_at,
        ]);
    }

    /**
     * Upsert the user's subscription to an active paid tier (standard|premium).
     */
    private function activateSubscription(
        int $userId,
        string $planKey,
        string $intentId,
        int $amountPaid,
        bool $notify = true,
    ): Subscription {
        $plan = $this->plans[$planKey] ?? $this->plans['standard_monthly'];
        $expiresAt = $plan['duration'] === 'year'
            ? Carbon::now()->addYear()
            : Carbon::now()->addMonth();

        $subscription = Subscription::updateOrCreate(
            ['user_id' => $userId],
            [
                'plan'                       => $planKey,
                'tier'                       => $plan['tier'],
                'status'                     => 'active',
                'paymongo_payment_intent_id' => $intentId,
                'amount_paid'                => $amountPaid,
                'expires_at'                 => $expiresAt,
            ]
        );

        if (! $notify) {
            return $subscription;
        }

        $user      = User::find($userId);
        $planLabel = ucwords(str_replace('_', ' ', $planKey));
        $expiry    = $expiresAt->format('F d, Y');

        if (! $user) {
            return $subscription;
        }

        try {
            SendPushNotification::dispatch(
                userId: $user->id,
                title:  '🎉 Subscription Activated!',
                body:   "Your {$planLabel} plan is now active until {$expiry}.",
                data:   [
                    'type'       => 'subscription_confirmed',
                    'plan'       => $planKey,
                    'tier'       => $plan['tier'],
                    'expires_at' => $expiresAt->toDateString(),
                ],
                type: 'subscription_confirmed',
            );
        } catch (\Throwable $e) {
            Log::warning('Subscription push notification failed: ' . $e->getMessage());
        }

        try {
            if ($user->email) {
                SendSubscriptionConfirmedEmail::dispatch(
                    email:      $user->email,
                    name:       $user->name ?? $user->email,
                    planName:   $planLabel,
                    expiryDate: $expiry,
                );
            }
        } catch (\Throwable $e) {
            Log::warning('Subscription email notification failed: ' . $e->getMessage());
        }

        return $subscription;
    }
}
