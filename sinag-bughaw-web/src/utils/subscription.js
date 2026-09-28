/**
 * Shared subscription/tier helpers for the web SPA.
 * Prefer API fields (is_premium, tier, subscription_status) from /auth/me.
 */
export function getSubscriptionTier(user) {
  if (!user) return 'free';

  const role = String(user.role || '').toLowerCase();
  const tier = String(user.tier || user.subscription_status || '').toLowerCase();
  const plan = String(user.plan || '').toLowerCase();

  if (['admin', 'super_admin', 'premium'].includes(role)) return 'premium';
  if (role === 'standard') return 'standard';

  if (user.is_premium === true || tier === 'premium' || plan.includes('premium')) {
    return 'premium';
  }

  if (
    user.is_subscribed === true
    || user.is_standard === true
    || tier === 'standard'
    || plan.includes('standard')
  ) {
    return 'standard';
  }

  return 'free';
}

export function hasPaidAccess(user) {
  const tier = getSubscriptionTier(user);
  return tier === 'premium' || tier === 'standard';
}

export function isPremiumUser(user) {
  return getSubscriptionTier(user) === 'premium';
}
