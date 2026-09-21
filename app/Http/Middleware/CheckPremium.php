<?php

namespace App\Http\Middleware;

use App\Models\Subscription;
use App\Support\PlatformSettings;
use Closure;
use Illuminate\Http\Request;

class CheckPremium
{
    public function handle(Request $request, Closure $next)
    {
        if (! PlatformSettings::bool('enable_premium_subscription')) {
            return $next($request);
        }

        $user = $request->user();

        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $sub = Subscription::where('user_id', $user->id)->latest()->first();

        if (! $sub || ! $sub->isPremium()) {
            return response()->json([
                'message'     => 'A premium subscription is required to access this feature.',
                'upgrade_url' => '/premium',
                'subscription_status' => 'free',
                'required_tier' => 'premium',
            ], 402);
        }

        return $next($request);
    }
}