import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView, TextInput, ActivityIndicator, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../utils/supabase';
import { ROLE_PERMISSIONS } from '../../utils/constants';
import { cleanText } from '../../utils/textEncoding';
import { mpesaEnvironmentLabel, mpesaTillTypeLabel } from '../../utils/mpesa';

export default function ProfileScreen() {
  const { profile, signOut, fetchProfile, hasPermission, isSuperAdmin, isAdmin } = useAuth();
  const { colors, isDark, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(profile?.full_name || '');
  const [editBusinessName, setEditBusinessName] = useState(false);
  const [businessName, setBusinessName] = useState(profile?.businesses?.display_name || profile?.businesses?.name || '');
  const [saving, setSaving] = useState(false);
  const [savingBusinessName, setSavingBusinessName] = useState(false);
  const [changingPass, setChangingPass] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [paymentSettingsLoading, setPaymentSettingsLoading] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [paymentForm, setPaymentForm] = useState({
    is_enabled: false,
    environment: 'sandbox',
    till_type: 'paybill',
    shortcode: '',
    account_reference: '',
    consumer_key: '',
    consumer_secret: '',
    passkey: '',
  });

  useEffect(() => {
    setName(profile?.full_name || '');
  }, [profile?.full_name]);

  useEffect(() => {
    setBusinessName(profile?.businesses?.display_name || profile?.businesses?.name || '');
  }, [profile?.businesses?.display_name, profile?.businesses?.name]);

  useEffect(() => {
    if (!profile?.business_id || !hasPermission('manage_payments')) {
      setPaymentSummary(null);
      return;
    }

    const fetchPaymentSummary = async () => {
      setPaymentSettingsLoading(true);

      try {
        const { data, error } = await supabase.rpc('get_business_payment_settings_summary');

        if (error) {
          throw error;
        }

        setPaymentSummary(data || null);
        setPaymentForm((current) => ({
          ...current,
          is_enabled: data?.is_enabled || false,
          environment: data?.environment || 'sandbox',
          till_type: data?.till_type || 'paybill',
          shortcode: data?.shortcode || '',
          account_reference: data?.account_reference || '',
        }));
      } catch (error) {
        Alert.alert('Payment Settings Error', error.message);
      } finally {
        setPaymentSettingsLoading(false);
      }
    };

    fetchPaymentSummary();
  }, [hasPermission, profile?.business_id]);

  const saveProfile = async () => {
    if (!name.trim()) {
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: name.trim() })
        .eq('id', profile.id);

      if (error) {
        throw error;
      }

      await fetchProfile(profile.id);
      setEditName(false);
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (newPass.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }

    if (newPass !== confirmPass) {
      Alert.alert('Error', 'Passwords do not match.');
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) {
        throw error;
      }

      Alert.alert('Success', 'Password updated.');
      setChangingPass(false);
      setNewPass('');
      setConfirmPass('');
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const saveBusinessName = async () => {
    const nextBusinessName = businessName.trim();
    if (!profile?.business_id) {
      return;
    }

    if (!nextBusinessName) {
      Alert.alert('Error', 'Business name cannot be empty.');
      return;
    }

    setSavingBusinessName(true);

    try {
      const { error } = await supabase
        .from('businesses')
        .update({ display_name: nextBusinessName })
        .eq('id', profile.business_id);

      if (error) {
        throw error;
      }

      await fetchProfile(profile.id);
      setEditBusinessName(false);
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setSavingBusinessName(false);
    }
  };

  const savePaymentSettings = async () => {
    if (!hasPermission('manage_payments')) {
      return;
    }

    if (!paymentForm.shortcode.trim()) {
      Alert.alert('M-Pesa Required', 'Enter the business shortcode or till number.');
      return;
    }

    setPaymentSaving(true);

    try {
      const { data, error } = await supabase.rpc('upsert_business_payment_settings', {
        p_is_enabled: paymentForm.is_enabled,
        p_environment: paymentForm.environment,
        p_till_type: paymentForm.till_type,
        p_shortcode: cleanText(paymentForm.shortcode).trim(),
        p_consumer_key: cleanText(paymentForm.consumer_key).trim() || null,
        p_consumer_secret: cleanText(paymentForm.consumer_secret).trim() || null,
        p_passkey: cleanText(paymentForm.passkey).trim() || null,
        p_account_reference: cleanText(paymentForm.account_reference).trim() || null,
      });

      if (error) {
        throw error;
      }

      setPaymentSummary(data || null);
      setPaymentForm((current) => ({
        ...current,
        consumer_key: '',
        consumer_secret: '',
        passkey: '',
      }));
      Alert.alert('Saved', 'This business can now use its own M-Pesa settings.');
    } catch (error) {
      Alert.alert('M-Pesa Error', error.message);
    } finally {
      setPaymentSaving(false);
    }
  };

  const perms = ROLE_PERMISSIONS[profile?.roles?.name] || {};
  const allowedPerms = Object.entries(perms).filter(([, allowed]) => allowed).map(([permission]) => permission);
  const deniedPerms = Object.entries(perms).filter(([, allowed]) => !allowed).map(([permission]) => permission);
  const teamBusinessName = profile?.businesses?.display_name || profile?.businesses?.name || 'Your Business';
  const canEditBusinessName = isAdmin();
  const canManagePayments = hasPermission('manage_payments');

  const Section = ({ title, children }) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textLight, marginBottom: 8, paddingLeft: 4, letterSpacing: 0.5, textTransform: 'uppercase' }}>{title}</Text>
      <View style={{ backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
  );

  const Row = ({ icon, label, value, onPress, rightEl, danger }) => (
    <TouchableOpacity
      style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: (danger ? colors.danger : colors.secondary) + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
        <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.secondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: danger ? colors.danger : colors.text }}>{label}</Text>
        {value ? <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 1 }}>{value}</Text> : null}
      </View>
      {rightEl || (onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textLight} /> : null)}
    </TouchableOpacity>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}>
      <View style={{ backgroundColor: colors.card, borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 16 }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 36, fontWeight: '800', color: '#fff' }}>{profile?.full_name?.charAt(0)?.toUpperCase()}</Text>
        </View>

        {editName ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TextInput style={{ fontSize: 18, fontWeight: '700', borderBottomWidth: 2, borderBottomColor: colors.secondary, minWidth: 150, textAlign: 'center', color: colors.text }} value={name} onChangeText={setName} autoFocus />
            <TouchableOpacity onPress={saveProfile} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.secondary} /> : <Ionicons name="checkmark-circle" size={28} color={colors.success} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setEditName(false); setName(profile?.full_name || ''); }}>
              <Ionicons name="close-circle" size={28} color={colors.danger} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} onPress={() => setEditName(true)}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{profile?.full_name}</Text>
            <Ionicons name="pencil" size={14} color={colors.textLight} />
          </TouchableOpacity>
        )}

        <Text style={{ fontSize: 14, color: colors.textLight, marginTop: 4 }}>{profile?.email}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.secondary + '15', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginTop: 10 }}>
          <Ionicons name="shield-checkmark" size={13} color={colors.secondary} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.secondary }}>{profile?.roles?.name?.replace(/_/g, ' ').toUpperCase()}</Text>
        </View>
        {isSuperAdmin() && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.warning + '15', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 }}>
            <Ionicons name="key" size={13} color={colors.warning} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.warning }}>SUPER ADMIN</Text>
          </View>
        )}
      </View>

      <Section title="Appearance">
        <Row
          icon={isDark ? 'moon' : 'sunny'}
          label="Dark Mode"
          value={isDark ? 'Dark theme active' : 'Light theme active'}
          rightEl={<Switch value={isDark} onValueChange={toggleTheme} trackColor={{ false: colors.border, true: colors.secondary }} thumbColor="#fff" />}
        />
      </Section>

      <Section title="Security">
        {!changingPass ? (
          <Row icon="lock-closed-outline" label="Change Password" onPress={() => setChangingPass(true)} />
        ) : (
          <View style={{ padding: 16 }}>
            <TextInput style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, height: 48, fontSize: 14, color: colors.text, backgroundColor: colors.inputBg, marginBottom: 10 }} placeholder="New password" value={newPass} onChangeText={setNewPass} secureTextEntry placeholderTextColor={colors.textLight} />
            <TextInput style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, height: 48, fontSize: 14, color: colors.text, backgroundColor: colors.inputBg, marginBottom: 12 }} placeholder="Confirm new password" value={confirmPass} onChangeText={setConfirmPass} secureTextEntry placeholderTextColor={colors.textLight} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, height: 44, alignItems: 'center', justifyContent: 'center' }} onPress={() => { setChangingPass(false); setNewPass(''); setConfirmPass(''); }}>
                <Text style={{ color: colors.textLight, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2, backgroundColor: colors.secondary, borderRadius: 10, height: 44, alignItems: 'center', justifyContent: 'center' }} onPress={changePassword} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Update Password</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Section>

      <Section title="Business">
        {!editBusinessName ? (
          <>
            <Row
              icon="business-outline"
              label="Business Name"
              value={teamBusinessName}
              onPress={canEditBusinessName ? () => setEditBusinessName(true) : undefined}
            />
            {canEditBusinessName && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                <Text style={{ fontSize: 12, color: colors.textLight, lineHeight: 18 }}>
                  Your staff and invite emails will use this name. Platform control keeps your original business name unchanged.
                </Text>
              </View>
            )}
          </>
        ) : (
          <View style={{ padding: 16 }}>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, height: 48, fontSize: 14, color: colors.text, backgroundColor: colors.inputBg, marginBottom: 10 }}
              placeholder="Business name your team will see"
              value={businessName}
              onChangeText={setBusinessName}
              placeholderTextColor={colors.textLight}
              autoFocus
            />
            <Text style={{ fontSize: 12, color: colors.textLight, lineHeight: 18 }}>
              This updates the staff-facing business name only. The original business name in platform control stays the same.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, height: 44, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => {
                  setEditBusinessName(false);
                  setBusinessName(teamBusinessName);
                }}
              >
                <Text style={{ color: colors.textLight, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, backgroundColor: colors.secondary, borderRadius: 10, height: 44, alignItems: 'center', justifyContent: 'center' }}
                onPress={saveBusinessName}
                disabled={savingBusinessName}
              >
                {savingBusinessName ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save Business Name</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Section>

      {canManagePayments && (
        <Section title="Payments">
          <View style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>M-Pesa Integration</Text>
                <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 4, lineHeight: 18 }}>
                  This business controls its own Daraja credentials. No super-admin step is needed once you save them here.
                </Text>
              </View>
              <Switch
                value={paymentForm.is_enabled}
                onValueChange={(value) => setPaymentForm((current) => ({ ...current, is_enabled: value }))}
                trackColor={{ false: colors.border, true: colors.secondary }}
                thumbColor="#fff"
              />
            </View>

            {paymentSettingsLoading ? (
              <ActivityIndicator color={colors.secondary} style={{ marginVertical: 24 }} />
            ) : (
              <>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textLight, marginBottom: 8 }}>Environment</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  {['sandbox', 'live'].map((value) => (
                    <TouchableOpacity
                      key={value}
                      style={{
                        flex: 1,
                        height: 42,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1.5,
                        borderColor: paymentForm.environment === value ? colors.secondary : colors.border,
                        backgroundColor: paymentForm.environment === value ? colors.secondary : 'transparent',
                      }}
                      onPress={() => setPaymentForm((current) => ({ ...current, environment: value }))}
                    >
                      <Text style={{ color: paymentForm.environment === value ? '#fff' : colors.text, fontWeight: '700' }}>
                        {mpesaEnvironmentLabel(value)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textLight, marginBottom: 8 }}>Collection Type</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  {['paybill', 'till'].map((value) => (
                    <TouchableOpacity
                      key={value}
                      style={{
                        flex: 1,
                        height: 42,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: 1.5,
                        borderColor: paymentForm.till_type === value ? colors.secondary : colors.border,
                        backgroundColor: paymentForm.till_type === value ? colors.secondary : 'transparent',
                      }}
                      onPress={() => setPaymentForm((current) => ({ ...current, till_type: value }))}
                    >
                      <Text style={{ color: paymentForm.till_type === value ? '#fff' : colors.text, fontWeight: '700' }}>
                        {mpesaTillTypeLabel(value)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {[
                  { label: 'Shortcode or Till Number', key: 'shortcode', placeholder: 'e.g. 174379' },
                  { label: 'Account Reference', key: 'account_reference', placeholder: profile?.businesses?.display_name || profile?.businesses?.name || 'BFlow' },
                  { label: 'Consumer Key', key: 'consumer_key', placeholder: paymentSummary?.has_consumer_key ? 'Consumer key already stored. Leave blank to keep.' : 'Paste consumer key' },
                  { label: 'Consumer Secret', key: 'consumer_secret', placeholder: paymentSummary?.has_consumer_secret ? 'Secret already stored. Leave blank to keep.' : 'Paste consumer secret' },
                  { label: 'Passkey', key: 'passkey', placeholder: paymentSummary?.has_passkey ? 'Passkey already stored. Leave blank to keep.' : 'Paste M-Pesa passkey' },
                ].map((field) => (
                  <View key={field.key} style={{ marginBottom: 10 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textLight, marginBottom: 5 }}>{field.label}</Text>
                    <TextInput
                      style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 14, color: colors.text, backgroundColor: colors.inputBg }}
                      placeholder={field.placeholder}
                      value={paymentForm[field.key]}
                      onChangeText={(value) => setPaymentForm((current) => ({ ...current, [field.key]: value }))}
                      placeholderTextColor={colors.textLight}
                      autoCapitalize="none"
                      secureTextEntry={field.key === 'consumer_secret' || field.key === 'passkey'}
                    />
                  </View>
                ))}

                <View style={{ backgroundColor: colors.bg, borderRadius: 14, padding: 12, marginBottom: 12 }}>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>Current Status</Text>
                  <Text style={{ color: colors.textLight, fontSize: 12, lineHeight: 18 }}>
                    {paymentSummary?.configured
                      ? `Configured for ${mpesaEnvironmentLabel(paymentSummary.environment)} ${mpesaTillTypeLabel(paymentSummary.till_type)}.`
                      : 'Not configured yet.'}
                    {' '}
                    {paymentSummary?.configured && paymentSummary?.is_enabled ? 'M-Pesa is enabled for checkout.' : 'Enable the switch above when you are ready.'}
                  </Text>
                  {paymentSummary?.last_test_status ? (
                    <Text style={{ color: colors.textLight, fontSize: 11, marginTop: 6 }}>
                      Last connection result: {cleanText(paymentSummary.last_test_status)}
                    </Text>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={{ backgroundColor: colors.secondary, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' }}
                  onPress={savePaymentSettings}
                  disabled={paymentSaving}
                >
                  {paymentSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '800' }}>Save M-Pesa Settings</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </Section>
      )}

      <Section title="My Permissions">
        <View style={{ padding: 14 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.success, marginBottom: 6 }}>ALLOWED</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {allowedPerms.map((permission) => (
              <View key={permission} style={{ backgroundColor: colors.success + '15', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: colors.success, textTransform: 'capitalize' }}>{permission.replace(/_/g, ' ')}</Text>
              </View>
            ))}
          </View>
          {deniedPerms.length > 0 && (
            <>
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.danger, marginBottom: 6 }}>RESTRICTED</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {deniedPerms.map((permission) => (
                  <View key={permission} style={{ backgroundColor: colors.danger + '15', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: colors.danger, textTransform: 'capitalize' }}>{permission.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </Section>

      <Section title="Account">
        <Row icon="calendar-outline" label="Joined" value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A'} />
        <Row icon="checkmark-circle-outline" label="Status" value={profile?.status || 'active'} />
        {isSuperAdmin() && (
          <Row icon="shield-half-outline" label="Platform Access" value="Can generate client tokens and control business access" />
        )}
      </Section>

      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1.5, borderColor: colors.danger, borderRadius: 14, height: 52, marginTop: 8 }}
        onPress={() => Alert.alert('Sign Out', 'Are you sure?', [{ text: 'Cancel' }, { text: 'Sign Out', style: 'destructive', onPress: signOut }])}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.danger} />
        <Text style={{ color: colors.danger, fontSize: 16, fontWeight: '700' }}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={{ textAlign: 'center', color: colors.textLight, fontSize: 11, marginTop: 20 }}>BizFlow v1.0</Text>
    </ScrollView>
  );
}
