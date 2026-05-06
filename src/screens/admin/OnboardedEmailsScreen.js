import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../utils/supabase';
import { useTheme } from '../../context/ThemeContext';
import { formatBillingDate } from '../../utils/billing';

export default function OnboardedEmailsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ totalBusinesses: 0, activeBusinesses: 0, trialBusinesses: 0 });
  const [error, setError] = useState('');

  const loadRows = async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const { data, error: rpcError } = await supabase.rpc('get_platform_onboarding_summary');

      if (rpcError) {
        throw rpcError;
      }

      setRows(data?.onboarded || []);
      setSummary({
        totalBusinesses: Number(data?.total_businesses || 0),
        activeBusinesses: Number(data?.active_businesses || 0),
        trialBusinesses: Number(data?.trial_businesses || 0),
      });
      setError('');
    } catch (nextError) {
      setError(nextError.message || 'Could not load onboarded businesses.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return rows;
    }

    return rows.filter((row) => {
      const haystack = [
        row.business_name,
        row.owner_name,
        row.owner_email,
        row.plan_name,
        row.billing_status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [query, rows]);

  const StatCard = ({ label, value, icon, tone }) => (
    <View
      style={{
        flex: 1,
        minWidth: 96,
        backgroundColor: colors.card,
        borderRadius: 18,
        padding: 14,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          backgroundColor: tone + '16',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 10,
        }}
      >
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text }}>{value}</Text>
      <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 4 }}>{label}</Text>
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 28 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadRows({ silent: true })} />}
    >
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 24,
          padding: 20,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: 16,
        }}
      >
        <View
          style={{
            width: 62,
            height: 62,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.secondary + '16',
            marginBottom: 14,
          }}
        >
          <Ionicons name="mail-unread-outline" size={28} color={colors.secondary} />
        </View>
        <Text style={{ fontSize: 26, fontWeight: '900', color: colors.text }}>Onboarded Emails</Text>
        <Text style={{ fontSize: 13, color: colors.textLight, marginTop: 8, lineHeight: 21 }}>
          This is your read-only view of businesses that have already onboarded into BizFlow and the admin email each one used.
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
        <StatCard label="Businesses" value={summary.totalBusinesses} icon="business-outline" tone={colors.secondary} />
        <StatCard label="Active Paid" value={summary.activeBusinesses} icon="card-outline" tone={colors.success} />
        <StatCard label="In Trial" value={summary.trialBusinesses} icon="timer-outline" tone={colors.warning} />
      </View>

      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 18,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: 16,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Ionicons name="search-outline" size={18} color={colors.textLight} style={{ marginHorizontal: 8 }} />
        <TextInput
          style={{ flex: 1, height: 44, color: colors.text, fontSize: 14 }}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by email, business or plan"
          placeholderTextColor={colors.textLight}
          autoCapitalize="none"
        />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.secondary} style={{ marginTop: 32 }} />
      ) : error ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 20,
            padding: 18,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 15 }}>Could not load onboardings</Text>
          <Text style={{ color: colors.textLight, marginTop: 8, lineHeight: 20 }}>{error}</Text>
          <TouchableOpacity
            style={{
              marginTop: 14,
              backgroundColor: colors.secondary,
              borderRadius: 12,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onPress={() => loadRows()}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : filteredRows.length === 0 ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 20,
            padding: 20,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
          }}
        >
          <Ionicons name="mail-open-outline" size={28} color={colors.textLight} />
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginTop: 10 }}>No onboarded emails found</Text>
          <Text style={{ color: colors.textLight, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
            New client businesses will appear here after they finish creating their BizFlow business account.
          </Text>
        </View>
      ) : (
        filteredRows.map((row) => (
          <View
            key={row.business_id}
            style={{
              backgroundColor: colors.card,
              borderRadius: 18,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>
                  {row.business_name || 'Unnamed Business'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 4 }}>
                  {row.owner_name || 'Business admin'}
                </Text>
              </View>
              <View
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  backgroundColor: (row.billing_status === 'trialing' ? colors.warning : colors.success) + '14',
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '800',
                    color: row.billing_status === 'trialing' ? colors.warning : colors.success,
                  }}
                >
                  {String(row.billing_status || 'active').toUpperCase()}
                </Text>
              </View>
            </View>

            <View style={{ marginTop: 12 }}>
              <Text style={{ fontSize: 11, color: colors.textLight, fontWeight: '700' }}>ADMIN EMAIL</Text>
              <Text selectable style={{ fontSize: 14, color: colors.secondary, marginTop: 3 }}>{row.owner_email || 'Not set'}</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <View style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 14, padding: 12 }}>
                <Text style={{ fontSize: 11, color: colors.textLight, fontWeight: '700' }}>PLAN</Text>
                <Text style={{ fontSize: 13, color: colors.text, fontWeight: '800', marginTop: 4 }}>
                  {row.plan_name || 'Free Trial'}
                </Text>
              </View>
              <View style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 14, padding: 12 }}>
                <Text style={{ fontSize: 11, color: colors.textLight, fontWeight: '700' }}>ACCESS UNTIL</Text>
                <Text style={{ fontSize: 13, color: colors.text, fontWeight: '800', marginTop: 4 }}>
                  {formatBillingDate(row.subscription_expires_at)}
                </Text>
              </View>
            </View>

            <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 12 }}>
              Onboarded {formatBillingDate(row.created_at)}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}
