import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { FontAwesome } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { confirmPayment, createPaymentIntent, getAppConfig, getErrorMessage, getPaymentHistory, getSubscriptionStatus, unwrap } from '../../lib/api';
import { colors, shadows } from '../../components/webTheme';

const PLANS: any = {
  standard: {
    label: 'Standard',
    icon: 'bolt',
    monthly: { key: 'standard_monthly', price: 'PHP 99', period: 'month' },
    yearly: { key: 'standard_yearly', price: 'PHP 799', period: 'year', savings: 'Save 33%' },
    summary: 'Core access for browsing and connecting.',
    features: ['Browse all student profiles', 'Access digital gallery', 'Basic yearbook viewing', 'Yearbook PDF download', 'Section and faculty directory'],
    accent: colors.indigo,
    soft: colors.softIndigo,
  },
  premium: {
    label: 'Premium',
    icon: 'star',
    monthly: { key: 'premium_monthly', price: 'PHP 199', period: 'month' },
    yearly: { key: 'premium_yearly', price: 'PHP 1,499', period: 'year', savings: 'Save 37%' },
    summary: 'Full yearbook tools and priority features.',
    features: ['Everything in Standard', 'Priority yearbook PDF downloads', 'Priority AI face search', 'Extended cloud storage', 'Exclusive premium badge', 'Early access to new features'],
    accent: colors.gold,
    soft: colors.softGold,
  },
};

export default function PaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ plan?: string }>();
  const [tierKey, setTierKey] = useState<'standard' | 'premium'>('standard');
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [appConfig, setAppConfig] = useState<any>(null);

  const selectedTier = PLANS[tierKey];
  const selectedPlan = selectedTier[billing];
  const subscriptionEnabled = appConfig?.features?.enable_premium_subscription !== false;
  const activeTierKey = status?.is_premium ? 'premium' : status?.is_standard ? 'standard' : '';
  const alreadyOnTier = tierKey === 'premium'
    ? status?.is_premium
    : Boolean(status?.is_standard && !status?.is_premium);

  const loadStatus = useCallback(async () => {
    try {
      setError('');
      const [configPayload, statusPayload, historyPayload] = await Promise.all([
        getAppConfig().catch(() => null),
        getSubscriptionStatus(),
        getPaymentHistory(),
      ]);
      if (configPayload) setAppConfig(unwrap(configPayload));
      setStatus(statusPayload);
      setHistory(Array.isArray(historyPayload) ? historyPayload : historyPayload?.data || []);
      return statusPayload;
    } catch (requestError: any) {
      setError(getErrorMessage(requestError, 'Unable to load subscription status.'));
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (params.plan || !activeTierKey) return;
    setTierKey(activeTierKey as 'standard' | 'premium');
  }, [activeTierKey, params.plan]);

  useEffect(() => {
    const plan = String(params.plan || '').toLowerCase();
    if (!plan) return;

    if (plan.includes('premium')) setTierKey('premium');
    if (plan.includes('standard')) setTierKey('standard');
    if (plan.includes('year')) setBilling('yearly');
    if (plan.includes('month')) setBilling('monthly');
  }, [params.plan]);

  const activeLabel = useMemo(() => {
    if (loading) return 'Checking access...';
    if (!status?.is_active) return 'Free access';
    return `${status?.is_premium ? 'Premium' : 'Standard'} active`;
  }, [loading, status]);

  const chooseTier = (key: 'standard' | 'premium') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTierKey(key);
  };

  const subscribe = async () => {
    if (!subscriptionEnabled) {
      Alert.alert('Subscriptions disabled', 'Premium subscriptions are currently disabled by platform settings.');
      return;
    }

    try {
      setPaying(true);
      setError('');
      const successUrl = Linking.createURL('/payment/success', { queryParams: { tier: tierKey } });
      const cancelUrl = Linking.createURL('/payment/cancel', { queryParams: { plan: selectedPlan.key } });
      const payload = await createPaymentIntent(selectedPlan.key, {
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      const checkoutUrl = payload?.checkout_url;
      const sessionId = payload?.session_id;

      if (!checkoutUrl) throw new Error('No checkout URL returned by the server.');

      const result = await WebBrowser.openAuthSessionAsync(checkoutUrl, Linking.createURL('/payment'));
      if (sessionId && result.type === 'success' && result.url?.includes('/payment/success')) {
        await confirmPayment(sessionId).catch(() => null);
      }
      const nextStatus = await loadStatus();

      if (result.type === 'success' && result.url?.includes('/payment/success')) {
        router.push({ pathname: '/payment/success', params: { tier: nextStatus?.tier || tierKey, session_id: sessionId } } as any);
      } else if (result.type === 'success' && result.url?.includes('/payment/cancel')) {
        router.push({ pathname: '/payment/cancel', params: { plan: selectedPlan.key } } as any);
      } else if (nextStatus?.is_active) {
        router.push({ pathname: '/payment/success', params: { tier: nextStatus?.tier || tierKey } } as any);
      } else if (result.type === 'cancel') {
        router.push({ pathname: '/payment/cancel', params: { plan: selectedPlan.key } } as any);
      } else {
        setError('Checkout was closed before the subscription was confirmed. Pull down to refresh after payment.');
      }
    } catch (requestError: any) {
      const message = getErrorMessage(requestError, 'Payment failed. Please try again.');
      setError(message);
      Alert.alert('Payment failed', message);
    } finally {
      setPaying(false);
    }
  };

  if (!subscriptionEnabled && !loading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <StatusBar style="dark" />
        <View style={styles.disabledWrap}>
          <View style={styles.disabledIcon}>
            <FontAwesome name="credit-card" size={24} color={colors.gold} />
          </View>
          <Text style={styles.disabledTitle}>Subscriptions Unavailable</Text>
          <Text style={styles.disabledText}>
            Premium and Standard subscriptions are currently disabled by platform settings.
          </Text>
          <TouchableOpacity style={styles.disabledButtonHome} onPress={() => router.replace('/(tabs)/home' as any)}>
            <FontAwesome name="home" size={14} color={colors.navy} />
            <Text style={styles.disabledButtonHomeText}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadStatus(); }} />}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <FontAwesome name="chevron-left" size={15} color={colors.navy} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Top Up Access</Text>
            <Text style={styles.title}>Choose your plan</Text>
          </View>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusIcon}>
            <FontAwesome name={status?.is_premium ? 'star' : status?.is_standard ? 'bolt' : 'user'} size={15} color={colors.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>{activeLabel}</Text>
            <Text style={styles.statusMeta}>
              {status?.expires_at ? `Expires ${new Date(status.expires_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Buy Standard or Premium anytime when you need more features.'}
            </Text>
          </View>
        </View>

        {params.plan ? (
          <View style={styles.deepLinkPlanCard}>
            <FontAwesome name="bell" size={13} color={colors.gold} />
            <Text style={styles.deepLinkPlanText}>
              Opened from notification. Showing {selectedTier.label} {billing} checkout.
            </Text>
          </View>
        ) : null}

        <View style={styles.billingSwitch}>
          {(['monthly', 'yearly'] as const).map((item) => (
            <TouchableOpacity key={item} style={[styles.billingButton, billing === item && styles.billingActive]} onPress={() => setBilling(item)}>
              <Text style={[styles.billingText, billing === item && styles.billingTextActive]}>{item === 'monthly' ? 'Monthly' : 'Yearly'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.planList}>
          {Object.entries(PLANS).map(([key, plan]: any) => {
            const active = tierKey === key;
            const current = activeTierKey === key;
            const price = plan[billing];
            return (
              <TouchableOpacity
                key={key}
                activeOpacity={0.9}
                style={[styles.planCard, active && { borderColor: plan.accent, backgroundColor: plan.soft }]}
                onPress={() => chooseTier(key)}
              >
                <View style={styles.planTop}>
                  <View style={[styles.planIcon, { backgroundColor: active ? colors.navy : '#f1f5f9' }]}>
                    <FontAwesome name={plan.icon} size={15} color={active ? colors.gold : colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.planNameRow}>
                      <Text style={styles.planName}>{plan.label}</Text>
                      {current ? <Text style={styles.currentPlanBadge}>Current plan</Text> : null}
                    </View>
                    <Text style={styles.planSummary}>{plan.summary}</Text>
                  </View>
                  <View style={[styles.radio, active && { borderColor: plan.accent, backgroundColor: plan.accent }]}>
                    {active ? <FontAwesome name="check" size={10} color={key === 'premium' ? colors.navy : '#ffffff'} /> : null}
                  </View>
                </View>

                <View style={styles.priceRow}>
                  <Text style={[styles.price, active && { color: plan.accent }]}>{price.price}</Text>
                  <Text style={styles.period}>/{price.period}</Text>
                  {!!price.savings && <Text style={styles.savings}>{price.savings}</Text>}
                </View>

                <View style={styles.featureLine}>
                  {plan.features.map((feature: string) => (
                    <View key={feature} style={styles.featurePill}>
                      <FontAwesome name="check" size={9} color={colors.success} />
                      <Text style={styles.featureText}>{feature}</Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <FontAwesome name="exclamation-circle" size={13} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.paymentNote}>
          <FontAwesome name="shield" size={13} color={colors.indigo} />
          <Text style={styles.paymentNoteText}>Checkout opens securely with PayMongo. Supports GCash, Maya, and cards.</Text>
        </View>

        {history.length ? (
          <View style={styles.historyCard}>
            <Text style={styles.historyTitle}>Recent Payments</Text>
            {history.slice(0, 3).map((item: any) => (
              <View key={item.id || `${item.plan}-${item.expires_at}`} style={styles.historyRow}>
                <View style={styles.historyIcon}>
                  <FontAwesome name={item.tier === 'premium' ? 'star' : 'bolt'} size={11} color={colors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyPlan}>{String(item.plan || item.tier || 'Subscription').replace(/_/g, ' ')}</Text>
                  <Text style={styles.historyMeta}>
                    {item.status || 'active'}{item.expires_at ? ` · until ${new Date(item.expires_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                  </Text>
                </View>
                <Text style={styles.historyAmount}>{item.amount_paid ? `PHP ${(Number(item.amount_paid) / 100).toLocaleString()}` : '-'}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <View>
          <Text style={styles.footerLabel}>{selectedTier.label}</Text>
          <Text style={styles.footerPrice}>{selectedPlan.price}/{selectedPlan.period}</Text>
        </View>
        <TouchableOpacity style={[styles.payButton, (alreadyOnTier || !subscriptionEnabled) && styles.disabledButton]} onPress={subscribe} disabled={paying || alreadyOnTier || !subscriptionEnabled}>
          {paying ? <ActivityIndicator color="#ffffff" /> : (
            <>
              <FontAwesome name={selectedTier.icon} size={13} color={colors.gold} />
              <Text style={styles.payButtonText}>{alreadyOnTier ? 'Active' : 'Continue'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 18, paddingBottom: 124 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10, marginBottom: 18 },
  backButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { color: colors.navy, fontSize: 28, fontWeight: '900', marginTop: 2 },
  statusCard: { minHeight: 74, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.border, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, ...shadows.card },
  statusIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { color: colors.navy, fontSize: 15, fontWeight: '900' },
  statusMeta: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  deepLinkPlanCard: { marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(253,184,19,0.42)', backgroundColor: '#fffdf5', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  deepLinkPlanText: { flex: 1, color: colors.navy, fontSize: 12, fontWeight: '800', lineHeight: 18 },
  billingSwitch: { marginTop: 18, backgroundColor: '#e2e8f0', padding: 5, borderRadius: 16, flexDirection: 'row' },
  billingButton: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  billingActive: { backgroundColor: '#ffffff', ...shadows.card },
  billingText: { color: colors.muted, fontSize: 13, fontWeight: '900' },
  billingTextActive: { color: colors.navy },
  planList: { marginTop: 16, gap: 12 },
  planCard: { borderRadius: 20, borderWidth: 2, borderColor: colors.border, backgroundColor: '#ffffff', padding: 16 },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  planNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  planName: { color: colors.navy, fontSize: 18, fontWeight: '900' },
  currentPlanBadge: { borderRadius: 999, backgroundColor: '#fff7e6', borderWidth: 1, borderColor: 'rgba(253,184,19,0.65)', color: colors.navy, fontSize: 10, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 4 },
  planSummary: { color: colors.muted, fontSize: 12, marginTop: 3 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, marginTop: 16 },
  price: { color: colors.navy, fontSize: 24, fontWeight: '900' },
  period: { color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  savings: { color: colors.success, backgroundColor: '#dcfce7', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, fontSize: 10, fontWeight: '900', marginLeft: 6, marginBottom: 2 },
  featureLine: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  featurePill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: '#e8edf5', paddingHorizontal: 9, paddingVertical: 6 },
  featureText: { color: colors.navy, fontSize: 10, fontWeight: '800' },
  errorBox: { borderRadius: 14, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', padding: 12, flexDirection: 'row', gap: 8, marginTop: 14 },
  errorText: { color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1 },
  paymentNote: { flexDirection: 'row', gap: 9, alignItems: 'center', marginTop: 16, paddingHorizontal: 4 },
  paymentNoteText: { flex: 1, color: '#7b8ba6', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  historyCard: { marginTop: 18, borderRadius: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: colors.border, padding: 14, ...shadows.card },
  historyTitle: { color: colors.navy, fontSize: 14, fontWeight: '900', marginBottom: 10 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  historyIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  historyPlan: { color: colors.navy, fontSize: 12, fontWeight: '900', textTransform: 'capitalize' },
  historyMeta: { color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: 2, textTransform: 'capitalize' },
  historyAmount: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  footerLabel: { color: colors.muted, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  footerPrice: { color: colors.navy, fontSize: 16, fontWeight: '900', marginTop: 2 },
  payButton: { minWidth: 142, height: 50, borderRadius: 15, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  disabledButton: { backgroundColor: '#94a3b8' },
  payButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  disabledWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  disabledIcon: { width: 68, height: 68, borderRadius: 22, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  disabledTitle: { color: colors.navy, fontSize: 23, fontWeight: '900', textAlign: 'center' },
  disabledText: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  disabledButtonHome: { minHeight: 46, borderRadius: 14, backgroundColor: colors.gold, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  disabledButtonHomeText: { color: colors.navy, fontSize: 13, fontWeight: '900' },
});
