<?php

namespace App\Http\Middleware;

use App\Support\PlatformSettings;
use App\Support\SubscriptionAccess;
use Closure;
use Illuminate\Http\Request;

class CheckSubscriptionAccess
{
    public function handle(Request $request, Closure $next)
    {
        if (! PlatformSettings::bool('enable_premium_subscription')) {
            $request->attributes->set('viewer_is_subscribed', true);
            $request->attributes->set('viewer_is_premium', true);
            $request->attributes->set('viewer_tier', 'premium');

            return $next($request);
        }

        $user = $request->user();
        $tier = SubscriptionAccess::tierFor($user);

        $request->attributes->set('viewer_is_subscribed', SubscriptionAccess::isSubscribed($user));
        $request->attributes->set('viewer_is_premium', SubscriptionAccess::isPremium($user));
        $request->attributes->set('viewer_tier', $tier);

        return $next($request);
    }
}
