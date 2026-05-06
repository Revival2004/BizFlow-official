import React from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import BillingAdminCard from '../../components/BillingAdminCard';
import { PLATFORM_BILLING_SUPPORT_PHONE } from '../../utils/billing';

export default function BillingGateScreen() {
  const { profile, signOut, hasPermission, fetchProfile, billingState } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const canManageBilling = hasPermission('manage_billing');
  const teamBusinessName = profile?.businesses?.display_name || profile?.businesses?.name || 'Your Business';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 18, paddingBottom: 36 + insets.bottom }}
    >
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 24,
          padding: 22,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <View
          style={{
            width: 68,
            height: 68,
            borderRadius: 34,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.secondary + '14',
            marginBottom: 16,
          }}
        >
          <Ionicons name="card-outline" size={30} color={colors.secondary} />
        </View>

        <Text style={{ fontSize: 26, fontWeight: '900', color: colors.text }}>Billing Required</Text>
        <Text style={{ fontSize: 14, color: colors.textLight, marginTop: 8, lineHeight: 22 }}>
          {teamBusinessName} is signed in, but BizFlow access is paused until billing is renewed.
        </Text>

        <View
          style={{
            marginTop: 16,
            borderRadius: 16,
            backgroundColor: colors.bg,
            padding: 14,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textLight, marginBottom: 4 }}>Current status</Text>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>
            {billingState?.reason || 'Billing renewal is required to continue.'}
          </Text>
          <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 8, lineHeight: 18 }}>
            Billing support: {PLATFORM_BILLING_SUPPORT_PHONE}
          </Text>
        </View>
      </View>

      {canManageBilling ? (
        <BillingAdminCard
          profile={profile}
          colors={colors}
          mode="gate"
          onRefresh={() => fetchProfile(profile.id)}
        />
      ) : (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 20,
            padding: 18,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>Contact Your Business Admin</Text>
          <Text style={{ fontSize: 13, color: colors.textLight, marginTop: 8, lineHeight: 21 }}>
            Only the business admin can renew billing through Paystack. Once they restore access, you can sign back in and keep working.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          borderWidth: 1.5,
          borderColor: colors.danger,
          borderRadius: 14,
          height: 52,
          marginTop: 18,
        }}
        onPress={() =>
          Alert.alert('Sign Out', 'Are you sure?', [
            { text: 'Cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: signOut },
          ])
        }
      >
        <Ionicons name="log-out-outline" size={20} color={colors.danger} />
        <Text style={{ color: colors.danger, fontSize: 16, fontWeight: '700' }}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
