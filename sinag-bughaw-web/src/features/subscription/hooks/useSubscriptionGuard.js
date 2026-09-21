import { useAuth } from '@/features/auth/hooks/useAuth';

/**
 * Checks if the current viewer has a paid subscription (Standard or Premium).
 * Source of truth is always the API response (student.is_subscribed_viewer).
 * This hook is a fallback for when you don't have the API value yet.
 */
export function useSubscriptionGuard() {
  const { user } = useAuth();
  const isSubscribed = Boolean(
    user?.is_subscribed
    || user?.tier === 'standard'
    || user?.tier === 'premium'
    || user?.subscription_status === 'standard'
    || user?.subscription_status === 'premium'
    || user?.is_premium
  );
  return {
    isSubscribed,
    isFree: !isSubscribed,
    isPremium: Boolean(user?.is_premium || user?.tier === 'premium' || user?.subscription_status === 'premium'),
    tier: user?.tier || user?.subscription_status || 'free',
  };
}
