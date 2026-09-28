<?php

namespace App\Support;

use App\Models\Subscription;
use App\Models\User;

/**
 * Single source of truth for paid-access checks.
 *
 * Priority:
 *  1. Admin / super_admin roles → full premium
 *  2. Manual role grants stored on users.role (premium|standard)
 *  3. Active row in subscriptions (status=active, not expired)
 */
class SubscriptionAccess
{
    public const TIER_FREE = 'free';
    public const TIER_STANDARD = 'standard';
    public const TIER_PREMIUM = 'premium';

    /** Roles that always unlock premium features. */
    public const PRIVILEGED_ROLES = ['admin', 'super_admin'];

    /** Manual grants sometimes stored directly on users.role. */
    public const GRANT_ROLES = ['premium', 'standard'];

    public static function tierFor(?User $user): string
    {
        if (! $user) {
            return self::TIER_FREE;
        }

        $role = strtolower(trim((string) ($user->role ?? '')));

        if (in_array($role, self::PRIVILEGED_ROLES, true) || $role === self::TIER_PREMIUM) {
            return self::TIER_PREMIUM;
        }

        if ($role === self::TIER_STANDARD) {
            return self::TIER_STANDARD;
        }

        $sub = self::activeSubscription($user);
        if ($sub?->tier === self::TIER_PREMIUM) {
            return self::TIER_PREMIUM;
        }
        if ($sub?->tier === self::TIER_STANDARD) {
            return self::TIER_STANDARD;
        }

        return self::TIER_FREE;
    }

    public static function isPremium(?User $user): bool
    {
        return self::tierFor($user) === self::TIER_PREMIUM;
    }

    public static function isStandard(?User $user): bool
    {
        return in_array(self::tierFor($user), [self::TIER_STANDARD, self::TIER_PREMIUM], true);
    }

    public static function isSubscribed(?User $user): bool
    {
        return self::isStandard($user);
    }

    public static function activeSubscription(?User $user): ?Subscription
    {
        if (! $user) {
            return null;
        }

        // Prefer the helper (active + not expired), then fall back to latest active row.
        $active = $user->activeSubscription();
        if ($active) {
            return $active;
        }

        $latest = Subscription::query()
            ->where('user_id', $user->id)
            ->where('status', 'active')
            ->latest('id')
            ->first();

        return $latest?->isActive() ? $latest : null;
    }

    /**
     * Fields merged into auth /me payloads so web + mobile UIs unlock correctly.
     *
     * @return array{
     *   is_subscribed: bool,
     *   is_standard: bool,
     *   is_premium: bool,
     *   subscription_status: string,
     *   tier: string,
     *   plan: string|null,
     *   expires_at: mixed
     * }
     */
    public static function payload(?User $user): array
    {
        $tier = self::tierFor($user);
        $sub = self::activeSubscription($user);

        return [
            'is_subscribed'       => self::isSubscribed($user),
            'is_standard'         => self::isStandard($user),
            'is_premium'          => self::isPremium($user),
            'subscription_status' => $tier,
            'tier'                => $tier,
            'plan'                => $sub?->plan
                ?? ($tier === self::TIER_PREMIUM ? 'premium_grant' : ($tier === self::TIER_STANDARD ? 'standard_grant' : 'free')),
            'expires_at'          => $sub?->expires_at,
        ];
    }
}
