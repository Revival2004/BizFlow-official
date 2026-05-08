import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView, useWindowDimensions,
} from 'react-native';
import { isSupabaseConfigured, supabase } from '../../utils/supabase';
import { COLORS } from '../../utils/constants';
import { Ionicons } from '@expo/vector-icons';
import { humanizeLabel } from '../../utils/data';
import { formatBillingAmount } from '../../utils/billing';

export default function RegisterScreen({ navigation, route }) {
  const { width } = useWindowDimensions();
  const [mode, setMode] = useState(route?.params?.token ? 'staff' : 'business');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [inviteData, setInviteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [verifyingInvite, setVerifyingInvite] = useState(false);
  const isDesktopWeb = Platform.OS === 'web' && width >= 1040;

  useEffect(() => {
    const token = route?.params?.token;
    if (token) {
      setMode('staff');
      setInviteToken(token);
      verifyInvite(token);
    }
  }, [route?.params?.token]);

  const resetInviteVerification = () => {
    setInviteData(null);
    setEmail('');
  };

  const verifyInvite = async (inputToken = inviteToken) => {
    if (!isSupabaseConfigured) {
      Alert.alert('Setup Required', 'Add your Supabase URL and anon key before verifying invites.');
      navigation.replace('Login');
      return;
    }

    const normalizedToken = inputToken.trim();
    if (!normalizedToken) {
      Alert.alert('Invite Required', 'Enter a valid invitation token.');
      return;
    }

    setVerifyingInvite(true);

    try {
      const { data: pendingInvite, error: inviteError } = await supabase
        .from('invitations')
        .select('*, roles(name)')
        .eq('token', normalizedToken)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();

      if (inviteError || !pendingInvite) {
        throw inviteError || new Error('Invite not found');
      }

      const expiry = new Date(pendingInvite.created_at);
      expiry.setHours(expiry.getHours() + 48);

      if (new Date() > expiry) {
        Alert.alert('Expired Invite', 'This staff invitation has expired. Ask the business admin for a new one.');
        resetInviteVerification();
        return;
      }

      setInviteData(pendingInvite);
      setEmail(pendingInvite.email || '');
    } catch (_error) {
      Alert.alert('Invite Invalid', 'We could not verify this invite token. Check it and try again.');
      resetInviteVerification();
    } finally {
      setVerifyingInvite(false);
    }
  };

  const validateCommonFields = ({ requireBusinessName = false } = {}) => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter your full name.');
      return false;
    }

    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address.');
      return false;
    }

    if (requireBusinessName && !businessName.trim()) {
      Alert.alert('Error', 'Please enter the business name.');
      return false;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return false;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match.');
      return false;
    }

    return true;
  };

  const handleRegister = async () => {
    if (!isSupabaseConfigured) {
      Alert.alert('Setup Required', 'Add your Supabase URL and anon key before creating accounts.');
      return;
    }

    if (mode === 'staff') {
      if (!inviteData) {
        Alert.alert('Invite Required', 'Verify a staff invitation token first.');
        return;
      }

      if (!validateCommonFields()) {
        return;
      }
    } else if (!validateCommonFields({ requireBusinessName: true })) {
      return;
    }

    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: { full_name: name.trim() },
        },
      });

      if (authError) {
        throw authError;
      }

      const userId = authData.user?.id;
      if (!userId) {
        throw new Error('User creation failed.');
      }

      if (mode === 'staff') {
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            email: normalizedEmail,
            full_name: name.trim(),
            role_id: inviteData.role_id,
            business_id: inviteData.business_id,
            invited_by: inviteData.invited_by,
            status: 'active',
          });

        if (profileError) {
          throw profileError;
        }

        const { error: inviteUpdateError } = await supabase
          .from('invitations')
          .update({
            status: 'accepted',
            accepted_at: new Date().toISOString(),
            accepted_by: userId,
          })
          .eq('token', inviteToken.trim());

        if (inviteUpdateError) {
          throw inviteUpdateError;
        }

        await supabase.auth.signOut();
        Alert.alert(
          'Welcome!',
          `You've joined successfully as ${humanizeLabel(inviteData.roles?.name || '')}. Please sign in.`,
          [{ text: 'Sign In', onPress: () => navigation.replace('Login') }],
        );
        return;
      }

      const { data: registerData, error: registerError } = await supabase.rpc('register_business_on_trial', {
        p_user_id: userId,
        p_email: normalizedEmail,
        p_full_name: name.trim(),
        p_business_name: businessName.trim(),
      });

      if (registerError) {
        throw registerError;
      }

      if (!registerData?.success) {
        throw new Error(registerData?.error || 'BizFlow could not finish the business signup.');
      }

      await supabase.auth.signOut();
      const expiryText = registerData?.trial_expires_at
        ? new Date(registerData.trial_expires_at).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : 'in 7 days';

      Alert.alert(
        'Free Trial Started',
        authData.session
          ? `Your business account is ready with a 7-day free trial ending ${expiryText}. Sign in to start using BizFlow.`
          : `Your business account is ready with a 7-day free trial ending ${expiryText}. If email confirmation is enabled on Supabase, confirm your email first, then sign in.`,
        [{ text: 'Sign In', onPress: () => navigation.replace('Login') }],
      );
    } catch (error) {
      Alert.alert('Registration Failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const renderStaffMode = () => (
    <>
      <View style={styles.banner}>
        <Ionicons name="people-outline" size={20} color={COLORS.accent} />
        <Text style={styles.bannerText}>
          Verify your invite, then create your account.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Verify Staff Invite</Text>
        <View style={styles.inputRow}>
          <Ionicons name="mail-open-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Enter invite token"
            value={inviteToken}
            onChangeText={(value) => {
              setInviteToken(value);
              if (inviteData) {
                resetInviteVerification();
              }
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholderTextColor={COLORS.textLight}
          />
        </View>
        <TouchableOpacity style={styles.actionBtn} onPress={() => verifyInvite()} disabled={verifyingInvite}>
          {verifyingInvite ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.actionBtnText}>{inviteData ? 'Invite Verified' : 'Verify Invite'}</Text>}
        </TouchableOpacity>
      </View>
    </>
  );

  const renderBusinessMode = () => (
    <>
      <View style={styles.banner}>
        <Ionicons name="rocket-outline" size={20} color={COLORS.secondary} />
        <Text style={styles.bannerText}>
          Start a business account. The 7-day trial starts automatically.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Plans</Text>

        {[
          {
            icon: 'timer-outline',
            title: 'Free Trial',
            price: '7 days free',
            text: '7 staff slots, no CSV export.',
            color: COLORS.warning,
          },
          {
            icon: 'flash-outline',
            title: 'Beta Plan',
            price: `${formatBillingAmount(90000, 'KES')} per 30 days`,
            text: '7 staff slots, no CSV export.',
            color: COLORS.secondary,
          },
          {
            icon: 'diamond-outline',
            title: 'Lifetime Plan',
            price: formatBillingAmount(1290000, 'KES'),
            text: 'Unlimited staff, CSV export and barcode scanner.',
            color: COLORS.accent,
          },
        ].map((card) => (
          <View key={card.title} style={styles.planCard}>
            <View style={[styles.planIcon, { backgroundColor: card.color + '18' }]}>
              <Ionicons name={card.icon} size={18} color={card.color} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.planHeader}>
                <Text style={styles.planTitle}>{card.title}</Text>
                <Text style={[styles.planPrice, { color: card.color }]}>{card.price}</Text>
              </View>
              <Text style={styles.planText}>{card.text}</Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );

  const emailLocked = mode === 'staff' && Boolean(inviteData?.email);
  const canSubmit = mode === 'business' ? true : Boolean(inviteData);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[styles.scroll, isDesktopWeb && styles.scrollDesktop]} keyboardShouldPersistTaps="handled">
        <View style={[styles.shell, isDesktopWeb && styles.shellDesktop]}>
          <View style={[styles.contextPanel, isDesktopWeb && styles.contextPanelDesktop]}>
            <View style={styles.logoArea}>
              <View style={styles.logoCircle}>
                <Ionicons name={mode === 'business' ? 'business' : 'people'} size={34} color={COLORS.white} />
              </View>
              <Text style={styles.appName}>BizFlow</Text>
              <Text style={styles.subtitleTop}>Business signup and team invites</Text>
            </View>

            <View style={styles.modeRow}>
              <TouchableOpacity style={[styles.modePill, mode === 'business' && styles.modePillActive]} onPress={() => setMode('business')}>
                <Text style={[styles.modePillText, mode === 'business' && styles.modePillTextActive]}>Start a Business</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modePill, mode === 'staff' && styles.modePillActive]} onPress={() => setMode('staff')}>
                <Text style={[styles.modePillText, mode === 'staff' && styles.modePillTextActive]}>Join a Team</Text>
              </TouchableOpacity>
            </View>

            {mode === 'staff' ? renderStaffMode() : renderBusinessMode()}
          </View>

        <View style={[styles.card, isDesktopWeb && styles.cardDesktop]}>
          <Text style={styles.title}>
            {mode === 'business' ? 'Create Account' : 'Create Staff Account'}
          </Text>
          {isDesktopWeb ? (
            <Text style={styles.desktopFormHint}>
              {mode === 'business'
                ? 'Create the account first. Billing stays inside the app.'
                : 'Use a verified invite token, then complete the staff account.'}
            </Text>
          ) : null}

          {mode === 'business' && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Business Name</Text>
              <View style={styles.inputRow}>
                <Ionicons name="business-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Your business name"
                  value={businessName}
                  onChangeText={setBusinessName}
                  placeholderTextColor={COLORS.textLight}
                />
              </View>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <View style={styles.inputRow}>
              <Ionicons name="person-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Your full name"
                value={name}
                onChangeText={setName}
                placeholderTextColor={COLORS.textLight}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={[styles.inputRow, emailLocked && { backgroundColor: '#f0f0f0' }]}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="you@company.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!emailLocked}
                placeholderTextColor={COLORS.textLight}
              />
              {emailLocked ? <Ionicons name="lock-closed" size={14} color={COLORS.textLight} /> : null}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Min. 6 characters"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholderTextColor={COLORS.textLight}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Repeat password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                placeholderTextColor={COLORS.textLight}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.btn, !canSubmit && { backgroundColor: COLORS.textLight }]}
            onPress={handleRegister}
            disabled={loading || !canSubmit}
          >
            {loading ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnText}>Create Account</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.loginLink}>
            <Text style={styles.loginLinkText}>
              Already have an account? <Text style={styles.loginLinkBold}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.primary },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  scrollDesktop: { paddingVertical: 34 },
  shell: { width: '100%', alignSelf: 'center' },
  shellDesktop: { maxWidth: 1220, flexDirection: 'row', gap: 26, alignItems: 'flex-start' },
  contextPanel: { marginBottom: 16 },
  contextPanelDesktop: {
    flex: 1.1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 28,
    padding: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 0,
  },
  logoArea: { alignItems: 'center', marginBottom: 18 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  appName: { fontSize: 28, fontWeight: '800', color: COLORS.white },
  subtitleTop: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 4 },
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  modePill: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  modePillActive: {
    backgroundColor: COLORS.white,
    borderColor: COLORS.white,
  },
  modePillText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  modePillTextActive: { color: COLORS.secondary },
  banner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10, padding: 12, marginBottom: 14,
  },
  bannerText: { color: COLORS.white, marginLeft: 8, fontSize: 13, flex: 1, lineHeight: 18 },
  panel: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 18, marginBottom: 16 },
  panelTitle: { fontSize: 15, fontWeight: '800', color: COLORS.white, marginBottom: 6 },
  panelText: { color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  planCard: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  planIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  planHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  planTitle: { fontSize: 15, fontWeight: '800', color: COLORS.white, flex: 1, paddingRight: 10 },
  planPrice: { fontSize: 13, fontWeight: '800' },
  planText: { fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 6, lineHeight: 18 },
  card: { backgroundColor: COLORS.white, borderRadius: 20, padding: 28 },
  cardDesktop: { flex: 0.92, maxWidth: 470, borderRadius: 28, padding: 34, alignSelf: 'stretch' },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 20 },
  desktopFormHint: { fontSize: 13, color: COLORS.textLight, marginBottom: 18, lineHeight: 20 },
  inputGroup: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.5,
    borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: COLORS.bg,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, height: 48, fontSize: 15, color: COLORS.text },
  actionBtn: {
    backgroundColor: COLORS.secondary, borderRadius: 12, height: 46,
    alignItems: 'center', justifyContent: 'center', marginTop: 6,
  },
  actionBtnText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  btn: {
    backgroundColor: COLORS.secondary, borderRadius: 12, height: 50,
    alignItems: 'center', justifyContent: 'center', marginTop: 10,
  },
  btnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  loginLink: { alignItems: 'center', marginTop: 14 },
  loginLinkText: { fontSize: 13, color: COLORS.textLight },
  loginLinkBold: { color: COLORS.secondary, fontWeight: '700' },
});
