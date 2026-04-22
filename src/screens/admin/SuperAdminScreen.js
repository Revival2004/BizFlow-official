import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Modal, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';

const formatDate = (value) => {
  if (!value) {
    return 'N/A';
  }

  return new Date(value).toLocaleString();
};

const buildRegistrationLink = (token) => `bizflow://register?token=${encodeURIComponent(token)}`;

export default function SuperAdminScreen() {
  const { profile, isSuperAdmin } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const superAdminEnabled = isSuperAdmin();
  const [loading, setLoading] = useState(true);
  const [businesses, setBusinesses] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [tokenModal, setTokenModal] = useState(false);
  const [resultModal, setResultModal] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [tokenNotes, setTokenNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdToken, setCreatedToken] = useState(null);

  useEffect(() => {
    if (!superAdminEnabled) {
      setLoading(false);
      return;
    }

    fetchAll();
  }, [superAdminEnabled, profile?.id]);

  const fetchAll = async () => {
    try {
      const [businessRes, tokenRes] = await Promise.all([
        supabase
          .from('businesses')
          .select('id, name, owner_name, owner_email, status, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('client_access_tokens')
          .select('id, token, admin_email, business_name, notes, status, expires_at, used_at, created_at')
          .order('created_at', { ascending: false }),
      ]);

      if (businessRes.error) {
        throw businessRes.error;
      }

      if (tokenRes.error) {
        throw tokenRes.error;
      }

      setBusinesses(businessRes.data || []);
      setTokens(tokenRes.data || []);
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  useRealtimeRefresh({
    enabled: Boolean(profile?.id) && superAdminEnabled,
    channelName: `super-admin:${profile?.id}`,
    bindings: [
      {
        event: '*',
        schema: 'public',
        table: 'businesses',
      },
      {
        event: '*',
        schema: 'public',
        table: 'client_access_tokens',
      },
    ],
    onChange: fetchAll,
  });

  const tokenStats = useMemo(() => {
    const now = Date.now();
    const normalized = tokens.map((token) => {
      if (token.status === 'active' && new Date(token.expires_at).getTime() <= now) {
        return { ...token, status: 'expired' };
      }
      return token;
    });

    return {
      normalized,
      active: normalized.filter((token) => token.status === 'active').length,
      used: normalized.filter((token) => token.status === 'used').length,
      expired: normalized.filter((token) => token.status === 'expired').length,
    };
  }, [tokens]);

  const businessStats = useMemo(() => ({
    active: businesses.filter((business) => business.status === 'active').length,
    suspended: businesses.filter((business) => business.status === 'suspended').length,
  }), [businesses]);

  const generateToken = async () => {
    setSaving(true);

    try {
      const { data, error } = await supabase.rpc('generate_client_access_token', {
        p_admin_email: adminEmail.trim() || null,
        p_business_name: businessName.trim() || null,
        p_notes: tokenNotes.trim() || null,
      });

      if (error) {
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Could not generate token.');
      }

      setCreatedToken(data);
      setTokenModal(false);
      setResultModal(true);
      setAdminEmail('');
      setBusinessName('');
      setTokenNotes('');
      await fetchAll();
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const shareToken = async () => {
    if (!createdToken?.token) {
      return;
    }

    const appLink = buildRegistrationLink(createdToken.token);
    const message = [
      'BizFlow access approved.',
      createdToken.business_name ? `Business: ${createdToken.business_name}` : null,
      `Token: ${createdToken.token}`,
      `App link: ${appLink}`,
      'Open the app, tap Register, then use this token to create the client admin account.',
    ].filter(Boolean).join('\n\n');

    try {
      await Share.share({ message, url: appLink });
    } catch (_error) {
      Alert.alert('Share Unavailable', 'Copy the token or app link manually from the screen.');
    }
  };

  const setBusinessStatus = (business, nextStatus) => {
    const actionLabel = nextStatus === 'active' ? 'reactivate' : 'suspend';
    Alert.alert(
      nextStatus === 'active' ? 'Reactivate Business' : 'Suspend Business',
      `Do you want to ${actionLabel} ${business.name}?`,
      [
        { text: 'Cancel' },
        {
          text: nextStatus === 'active' ? 'Reactivate' : 'Suspend',
          style: nextStatus === 'active' ? 'default' : 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('businesses')
                .update({ status: nextStatus })
                .eq('id', business.id);

              if (error) {
                throw error;
              }

              await fetchAll();
            } catch (err) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  const revokeToken = (token) => {
    Alert.alert(
      'Revoke Token',
      `Revoke ${token.token}? Anyone holding it will be blocked from registering.`,
      [
        { text: 'Cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('client_access_tokens')
                .update({ status: 'revoked' })
                .eq('id', token.id);

              if (error) {
                throw error;
              }

              await fetchAll();
            } catch (err) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  if (!superAdminEnabled) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Ionicons name="shield-outline" size={44} color={colors.textLight} />
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 14 }}>Super Admin Only</Text>
        <Text style={{ color: colors.textLight, textAlign: 'center', marginTop: 8 }}>
          This area is reserved for the platform owner account.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom }}>
        <View style={{ backgroundColor: colors.card, borderRadius: 22, padding: 18, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text }}>Platform Control</Text>
              <Text style={{ fontSize: 13, color: colors.textLight, marginTop: 4 }}>
                Approve client admins, issue 30-day access tokens, and suspend or reactivate businesses.
              </Text>
            </View>
            <TouchableOpacity
              style={{ backgroundColor: colors.secondary, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }}
              onPress={() => setTokenModal(true)}
            >
              <Ionicons name="key" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { label: 'Active Businesses', value: businessStats.active, color: colors.success },
              { label: 'Suspended', value: businessStats.suspended, color: colors.danger },
              { label: 'Live Tokens', value: tokenStats.active, color: colors.secondary },
            ].map((item) => (
              <View key={item.label} style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 16, padding: 12 }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: item.color }}>{item.value}</Text>
                <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 4 }}>{item.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textLight, marginBottom: 8, paddingLeft: 4, textTransform: 'uppercase' }}>
            Client Businesses
          </Text>
          {businesses.length === 0 ? (
            <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 22, alignItems: 'center' }}>
              <Ionicons name="business-outline" size={42} color={colors.textLight} />
              <Text style={{ color: colors.textLight, marginTop: 10 }}>No businesses yet</Text>
            </View>
          ) : businesses.map((business) => {
            const isOwnBusiness = business.id === profile?.business_id;
            const statusColor = business.status === 'active' ? colors.success : colors.danger;

            return (
              <View key={business.id} style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>{business.name}</Text>
                    <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 4 }}>
                      Owner: {business.owner_name || 'Unassigned'}{business.owner_email ? ` - ${business.owner_email}` : ''}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 4 }}>
                      Created: {formatDate(business.created_at)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={{ backgroundColor: statusColor + '18', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: statusColor, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>
                        {business.status}
                      </Text>
                    </View>
                    {isOwnBusiness ? (
                      <Text style={{ fontSize: 10, color: colors.textLight, marginTop: 8 }}>Your business</Text>
                    ) : (
                      <TouchableOpacity
                        style={{
                          marginTop: 8,
                          backgroundColor: business.status === 'active' ? colors.danger : colors.success,
                          borderRadius: 10,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                        }}
                        onPress={() => setBusinessStatus(business, business.status === 'active' ? 'suspended' : 'active')}
                      >
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                          {business.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        <View>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textLight, marginBottom: 8, paddingLeft: 4, textTransform: 'uppercase' }}>
            Access Tokens
          </Text>
          {tokenStats.normalized.length === 0 ? (
            <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 22, alignItems: 'center' }}>
              <Ionicons name="key-outline" size={42} color={colors.textLight} />
              <Text style={{ color: colors.textLight, marginTop: 10 }}>No access tokens generated yet</Text>
            </View>
          ) : tokenStats.normalized.map((token) => {
            const statusColor = token.status === 'active'
              ? colors.success
              : token.status === 'used'
                ? colors.secondary
                : colors.danger;

            return (
              <View key={token.id} style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text selectable style={{ fontSize: 15, fontWeight: '900', color: colors.text }}>{token.token}</Text>
                    <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 6 }}>
                      {token.business_name || 'Business not preset'}{token.admin_email ? ` • ${token.admin_email}` : ''}
                    </Text>
                    {token.notes ? (
                      <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 4 }}>{token.notes}</Text>
                    ) : null}
                    <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 4 }}>
                      Expires: {formatDate(token.expires_at)}
                    </Text>
                    {token.used_at ? (
                      <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 2 }}>
                        Used: {formatDate(token.used_at)}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={{ backgroundColor: statusColor + '18', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: statusColor, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>
                        {token.status}
                      </Text>
                    </View>
                    {token.status === 'active' ? (
                      <TouchableOpacity
                        style={{ marginTop: 8, borderWidth: 1, borderColor: colors.danger, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
                        onPress={() => revokeToken(token)}
                      >
                        <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>Revoke</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <Modal visible={tokenModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 24 + insets.bottom }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>Generate Client Token</Text>
              <TouchableOpacity onPress={() => setTokenModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 6 }}>Admin Email (optional)</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 14, color: colors.text, backgroundColor: colors.bg, marginBottom: 12 }}
              placeholder="owner@client.com"
              value={adminEmail}
              onChangeText={setAdminEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor={colors.textLight}
            />

            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 6 }}>Business Name (optional)</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 14, color: colors.text, backgroundColor: colors.bg, marginBottom: 12 }}
              placeholder="Client Business Name"
              value={businessName}
              onChangeText={setBusinessName}
              placeholderTextColor={colors.textLight}
            />

            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 6 }}>Notes (optional)</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, minHeight: 88, fontSize: 14, color: colors.text, backgroundColor: colors.bg, marginBottom: 14, textAlignVertical: 'top' }}
              placeholder="Private note for this token"
              value={tokenNotes}
              onChangeText={setTokenNotes}
              placeholderTextColor={colors.textLight}
              multiline
            />

            <TouchableOpacity
              style={{ backgroundColor: colors.secondary, borderRadius: 14, height: 50, alignItems: 'center', justifyContent: 'center' }}
              onPress={generateToken}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Generate 30-Day Token</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={resultModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 24 + insets.bottom }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>Token Ready</Text>
              <TouchableOpacity onPress={() => setResultModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={{ backgroundColor: colors.bg, borderRadius: 16, padding: 14, marginBottom: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textLight, marginBottom: 6 }}>Client Token</Text>
              <Text selectable style={{ fontSize: 20, fontWeight: '900', color: colors.text }}>
                {createdToken?.token}
              </Text>
              <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 8 }}>
                Expires: {formatDate(createdToken?.expires_at)}
              </Text>
            </View>

            <View style={{ backgroundColor: colors.bg, borderRadius: 16, padding: 14, marginBottom: 14 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textLight, marginBottom: 6 }}>App Link</Text>
              <Text selectable style={{ fontSize: 12, color: colors.secondary }}>
                {createdToken?.token ? buildRegistrationLink(createdToken.token) : ''}
              </Text>
            </View>

            <TouchableOpacity
              style={{ backgroundColor: colors.secondary, borderRadius: 14, height: 50, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}
              onPress={shareToken}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Share Token</Text>
            </TouchableOpacity>

            <Text style={{ fontSize: 12, color: colors.textLight, textAlign: 'center' }}>
              The client can open the app, tap Register, and use this token to create their admin account.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
