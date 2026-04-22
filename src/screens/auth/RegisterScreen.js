import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { isSupabaseConfigured, supabase } from '../../utils/supabase';
import { COLORS } from '../../utils/constants';
import { Ionicons } from '@expo/vector-icons';
import { humanizeLabel } from '../../utils/data';

export default function RegisterScreen({ navigation, route }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [credentialType, setCredentialType] = useState(null);
  const [inviteData, setInviteData] = useState(null);
  const [clientTokenData, setClientTokenData] = useState(null);

  useEffect(() => {
    const token = route?.params?.token;
    if (token) {
      setTokenInput(token);
      verifyCredential(token);
    }
  }, [route?.params?.token]);

  const resetVerification = () => {
    setCredentialType(null);
    setInviteData(null);
    setClientTokenData(null);
    setEmail('');
    setBusinessName('');
  };

  const verifyCredential = async (inputToken = tokenInput) => {
    if (!isSupabaseConfigured) {
      Alert.alert('Setup Required', 'Add your Supabase URL and anon key before verifying access.');
      navigation.replace('Login');
      return;
    }

    const normalizedToken = inputToken.trim();
    if (!normalizedToken) {
      Alert.alert('Token Required', 'Enter a valid access token or invitation token.');
      return;
    }

    setVerifying(true);

    try {
      const { data: pendingInvite, error: inviteError } = await supabase
        .from('invitations')
        .select('*, roles(name)')
        .eq('token', normalizedToken)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();

      if (!inviteError && pendingInvite) {
        const expiry = new Date(pendingInvite.created_at);
        expiry.setHours(expiry.getHours() + 48);

        if (new Date() > expiry) {
          Alert.alert('Expired Invite', 'This staff invitation has expired. Ask the business admin for a new one.');
          resetVerification();
          return;
        }

        setCredentialType('invite');
        setInviteData(pendingInvite);
        setClientTokenData(null);
        setEmail(pendingInvite.email || '');
        setBusinessName('');
        return;
      }

      const { data: tokenData, error: tokenError } = await supabase.rpc('verify_client_access_token', {
        p_token: normalizedToken,
      });

      if (tokenError) {
        throw tokenError;
      }

      if (!tokenData?.success) {
        Alert.alert('Invalid Token', tokenData?.error || 'This token is invalid or no longer active.');
        resetVerification();
        return;
      }

      setCredentialType('access');
      setClientTokenData(tokenData);
      setInviteData(null);
      setEmail(tokenData.admin_email || '');
      setBusinessName(tokenData.business_name || '');
    } catch (_error) {
      Alert.alert('Access Denied', 'We could not verify this token. Check it and try again.');
      resetVerification();
    } finally {
      setVerifying(false);
    }
  };

  const handleRegister = async () => {
    if (!isSupabaseConfigured) {
      Alert.alert('Setup Required', 'Add your Supabase URL and anon key before creating accounts.');
      return;
    }

    if (!credentialType) {
      Alert.alert('Approval Required', 'Verify a valid access token or staff invitation first.');
      return;
    }

    if (!name.trim()) {
      Alert.alert('Error', 'Please enter your full name');
      return;
    }

    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    if (credentialType === 'access' && !businessName.trim()) {
      Alert.alert('Error', 'Please enter the business name for this client account.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
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

      if (credentialType === 'invite') {
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
          .eq('token', tokenInput.trim());

        if (inviteUpdateError) {
          throw inviteUpdateError;
        }

        await supabase.auth.signOut();
        Alert.alert(
          'Welcome!',
          `You've joined successfully as ${humanizeLabel(inviteData.roles?.name || '')}. Please sign in.`,
          [{ text: 'Sign In', onPress: () => navigation.replace('Login') }]
        );
        return;
      }

      const { data: registerData, error: registerError } = await supabase.rpc('register_admin_with_access_token', {
        p_token: tokenInput.trim(),
        p_user_id: userId,
        p_email: normalizedEmail,
        p_full_name: name.trim(),
        p_business_name: businessName.trim(),
      });

      if (registerError) {
        throw registerError;
      }

      if (!registerData?.success) {
        throw new Error(registerData?.error || 'This access token could not create the business account.');
      }

      await supabase.auth.signOut();
      Alert.alert(
        'Business Created',
        'Your client admin account is ready. Sign in to start using BizFlow.',
        [{ text: 'Sign In', onPress: () => navigation.replace('Login') }]
      );
    } catch (e) {
      Alert.alert('Registration Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const tokenLockedEmail = credentialType === 'invite' || Boolean(clientTokenData?.admin_email);

  const renderVerificationBanner = () => {
    if (credentialType === 'invite') {
      return (
        <View style={styles.inviteBanner}>
          <Ionicons name="checkmark-circle" size={20} color={COLORS.accent} />
          <Text style={styles.inviteText}>
            Staff invite verified for <Text style={styles.highlight}>{humanizeLabel(inviteData?.roles?.name || '')}</Text>
          </Text>
        </View>
      );
    }

    if (credentialType === 'access') {
      return (
        <View style={styles.inviteBanner}>
          <Ionicons name="shield-checkmark" size={20} color={COLORS.accent} />
          <Text style={styles.inviteText}>
            Super-admin approval verified. This token can create one business admin account.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.warningBanner}>
        <Ionicons name="warning" size={20} color={COLORS.warning} />
        <Text style={styles.warningText}>
          No one can register without a valid client token or staff invitation.
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoArea}>
          <View style={styles.logoCircle}>
            <Ionicons name="shield-checkmark" size={34} color={COLORS.white} />
          </View>
          <Text style={styles.appName}>BizFlow</Text>
          <Text style={styles.subtitleTop}>Token-protected access</Text>
        </View>

        {renderVerificationBanner()}

        <View style={styles.tokenCard}>
          <Text style={styles.tokenCardTitle}>Step 1: Verify Access</Text>
          <Text style={styles.tokenCardText}>
            Enter the client token from the super admin or the invitation token from a business admin.
          </Text>
          <View style={styles.inputRow}>
            <Ionicons name="key-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter token"
              value={tokenInput}
              onChangeText={(value) => {
                setTokenInput(value);
                if (credentialType) {
                  resetVerification();
                }
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholderTextColor={COLORS.textLight}
            />
          </View>
          <TouchableOpacity style={styles.verifyBtn} onPress={() => verifyCredential()} disabled={verifying}>
            {verifying ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <Text style={styles.verifyBtnText}>{credentialType ? 'Verified' : 'Verify Token'}</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>
            {credentialType === 'access' ? 'Create Client Admin Account' : 'Create Account'}
          </Text>

          {credentialType === 'access' && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Business Name</Text>
              <View style={styles.inputRow}>
                <Ionicons name="business-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Client business name"
                  value={businessName}
                  onChangeText={setBusinessName}
                  editable={!clientTokenData?.business_name}
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
            <View style={[styles.inputRow, tokenLockedEmail && { backgroundColor: '#f0f0f0' }]}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="you@company.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!tokenLockedEmail}
                placeholderTextColor={COLORS.textLight}
              />
              {tokenLockedEmail ? <Ionicons name="lock-closed" size={14} color={COLORS.textLight} /> : null}
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
            style={[styles.btn, !credentialType && { backgroundColor: COLORS.textLight }]}
            onPress={handleRegister}
            disabled={loading || !credentialType}
          >
            {loading ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnText}>Create Account</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.loginLink}>
            <Text style={styles.loginLinkText}>
              Already approved? <Text style={styles.loginLinkBold}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.primary },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoArea: { alignItems: 'center', marginBottom: 18 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  appName: { fontSize: 28, fontWeight: '800', color: COLORS.white },
  subtitleTop: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 4 },
  inviteBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,210,160,0.15)',
    borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: COLORS.accent,
  },
  inviteText: { color: COLORS.white, marginLeft: 8, fontSize: 13, flex: 1 },
  highlight: { fontWeight: '700', color: COLORS.accent },
  warningBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245,159,0,0.15)',
    borderRadius: 10, padding: 12, marginBottom: 14,
  },
  warningText: { color: COLORS.warning, marginLeft: 8, fontSize: 13, flex: 1 },
  tokenCard: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 18, marginBottom: 16 },
  tokenCardTitle: { fontSize: 15, fontWeight: '800', color: COLORS.white, marginBottom: 6 },
  tokenCardText: { color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  card: { backgroundColor: COLORS.white, borderRadius: 20, padding: 28 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 20 },
  inputGroup: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1.5,
    borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: COLORS.bg,
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, height: 48, fontSize: 15, color: COLORS.text },
  verifyBtn: {
    backgroundColor: COLORS.secondary, borderRadius: 12, height: 46,
    alignItems: 'center', justifyContent: 'center', marginTop: 6,
  },
  verifyBtnText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  btn: {
    backgroundColor: COLORS.secondary, borderRadius: 12, height: 50,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  btnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  loginLink: { alignItems: 'center', marginTop: 14 },
  loginLinkText: { fontSize: 13, color: COLORS.textLight },
  loginLinkBold: { color: COLORS.secondary, fontWeight: '700' },
});
