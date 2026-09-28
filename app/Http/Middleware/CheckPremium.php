<?php

namespace App\Http\Middleware;

use App\Support\PlatformSettings;
use App\Support\SubscriptionAccess;
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

        if (! SubscriptionAccess::isPremium($user)) {
            return response()->json([
                'message'             => 'A premium subscription is required to access this feature.',
                'upgrade_url'         => '/premium',
                'subscription_status' => SubscriptionAccess::tierFor($user),
                'required_tier'       => 'premium',
            ], 402);
        }

        return $next($request);
    }
}
