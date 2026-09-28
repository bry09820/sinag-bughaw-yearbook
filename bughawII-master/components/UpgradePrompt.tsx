import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

type UpgradePromptProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  featureLabel?: string;
};

/**
 * Modal shown when a free user tries to open a Standard/Premium feature.
 */
export default function UpgradePrompt({
  visible,
  onClose,
  title = 'Premium Feature',
  message,
  featureLabel = 'this feature',
}: UpgradePromptProps) {
  const router = useRouter();
  const body =
    message ||
    `Upgrade to Standard or Premium to unlock ${featureLabel}. Free accounts can browse limited previews only.`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <FontAwesome name="lock" size={22} color="#fdb813" />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{body}</Text>

          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.9}
            onPress={() => {
              onClose();
              router.push('/payment' as any);
            }}
          >
            <FontAwesome name="star" size={13} color="#1d2b4b" />
            <Text style={styles.primaryText}>Upgrade Now</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.secondaryText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export function hasPaidAccess(user: any) {
  const role = String(user?.role || '').toLowerCase();
  const tier = String(user?.tier || user?.subscription_status || '').toLowerCase();

  return Boolean(
    ['admin', 'super_admin', 'premium'].includes(role) ||
      role === 'standard' ||
      user?.is_premium ||
      user?.is_subscribed ||
      user?.is_standard ||
      user?.premium ||
      tier === 'premium' ||
      tier === 'standard' ||
      user?.subscription?.active ||
      user?.subscription_status === 'active'
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(13, 27, 62, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    paddingHorizontal: 22,
    paddingVertical: 24,
    alignItems: 'center',
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(253, 184, 19, 0.14)',
    borderWidth: 1.5,
    borderColor: 'rgba(253, 184, 19, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    color: '#1d2b4b',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 18,
  },
  primaryBtn: {
    width: '100%',
    height: 46,
    borderRadius: 12,
    backgroundColor: '#fdb813',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  primaryText: {
    color: '#1d2b4b',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  secondaryText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
});
