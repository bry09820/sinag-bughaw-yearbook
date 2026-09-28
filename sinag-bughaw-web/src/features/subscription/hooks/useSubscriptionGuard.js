import { useAuth } from '@/features/auth/hooks/useAuth';
import { getSubscriptionTier, hasPaidAccess, isPremiumUser } from '@/utils/subscription';

/**
 * Checks if the current viewer has a paid subscription (Standard or Premium).
 */
export function useSubscriptionGuard() {
  const { user } = useAuth();
  const tier = getSubscriptionTier(user);

  return {
    isSubscribed: hasPaidAccess(user),
    isFree: !hasPaidAccess(user),
    isPremium: isPremiumUser(user),
    isStandard: tier === 'standard' || tier === 'premium',
    tier,
  };
}
