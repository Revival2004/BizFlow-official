import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView
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
  const [loading, setLoading] = useState(false);
  const [inviteToken, setInviteToken] = useState(null);
  const [inviteData, setInviteData] = useState(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    // Token can come from deep link or route params
    const token = route?.params?.token;
    if (token) {
      setInviteToken(token);
      verifyInvite(token);
    }
  }, [route?.params?.token]);

  const verifyInvite = async (token) => {
    if (!isSupabaseConfigured) {
      Alert.alert('Setup Required', 'Add your Supabase URL and anon key before verifying invites.');
      navigation.replace('Login');
      return;
    }

    setVerifying(true);
    try {
      const { data, error } = await supabase
        .from('invitations')
        .select('*, roles(name)')
        .eq('token', token)
        .eq('status', 'pending')
        .single();

      if (error || !data) {
        Alert.alert('Invalid Invite', 'This invitation link is invalid or has already been used.');
        navigation.replace('Login');
        return;
      }

      // Check if expired (48 hours)
      const expiry = new Date(data.created_at);
      expiry.setHours(expiry.getHours() + 48);
      if (new Date() > expiry) {
        Alert.alert('Expired', 'This invitation has expired. Please ask your admin for a new one.');
        navigation.replace('Login');
        return;
      }

      setInviteData(data);
      setEmail(data.email);
    } catch (e) {
      Alert.alert('Error', 'Could not verify invitation.');
    }
    setVerifying(false);
  };

  const handleRegister = async () => {
    if (!isSupabaseConfigured) {
      Alert.alert('Setup Required', 'Add your Supabase URL and anon key before creating accounts.');
      return;
    }

    if (!inviteToken || !inviteData) {
      Alert.alert('No Invitation', 'You need a valid invitation to register. Please contact your admin.');
      return;
    }
    if (!name.trim()) { Alert.alert('Error', 'Please enter your full name'); return; }
    if (password.length < 6) { Alert.alert('Error', 'Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { Alert.alert('Error', 'Passwords do not match'); return; }

    setLoading(true);
    try {
      // Sign up user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { full_name: name.trim() }
        }
      });

      if (authError) throw authError;

      const userId = authData.user?.id;
      if (!userId) throw new Error('User creation failed');

      // Create profile
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          email: email.trim().toLowerCase(),
          full_name: name.trim(),
          role_id: inviteData.role_id,
          business_id: inviteData.business_id,
          invited_by: inviteData.invited_by,
          status: 'active',
        });

      if (profileError) throw profileError;

      // Mark invitation as accepted
      await supabase
        .from('invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString(), accepted_by: userId })
        .eq('token', inviteToken);

      Alert.alert('Welcome!', `You've joined successfully as ${humanizeLabel(inviteData.roles?.name || '')}. Please sign in.`,
        [{ text: 'Sign In', onPress: () => navigation.replace('Login') }]);

    } catch (e) {
      Alert.alert('Registration Failed', e.message);
    }
    setLoading(false);
  };

  if (verifying) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text style={{ color: COLORS.white, marginTop: 16 }}>Verifying your invitation...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoArea}>
          <View style={styles.logoCircle}>
            <Ionicons name="person-add" size={36} color={COLORS.white} />
          </View>
          <Text style={styles.appName}>BizFlow</Text>
        </View>

        {inviteData ? (
          <View style={styles.inviteBanner}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.accent} />
            <Text style={styles.inviteText}>
              Invited as <Text style={{ fontWeight: '700', color: COLORS.accent }}>{humanizeLabel(inviteData.roles?.name || '').toUpperCase()}</Text>
            </Text>
          </View>
        ) : (
          <View style={styles.warningBanner}>
            <Ionicons name="warning" size={20} color={COLORS.warning} />
            <Text style={styles.warningText}>You need an invitation link to register.</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.title}>Create Account</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <View style={styles.inputRow}>
              <Ionicons name="person-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Your full name" value={name} onChangeText={setName} placeholderTextColor={COLORS.textLight} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={[styles.inputRow, { backgroundColor: '#f0f0f0' }]}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
              <TextInput style={styles.input} value={email} editable={false} placeholderTextColor={COLORS.textLight} />
              <Ionicons name="lock-closed" size={14} color={COLORS.textLight} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Min. 6 characters" value={password} onChangeText={setPassword} secureTextEntry placeholderTextColor={COLORS.textLight} />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textLight} style={styles.inputIcon} />
              <TextInput style={styles.input} placeholder="Repeat password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry placeholderTextColor={COLORS.textLight} />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.btn, !inviteData && { backgroundColor: COLORS.textLight }]}
            onPress={handleRegister}
            disabled={loading || !inviteData}
          >
            {loading ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnText}>Create Account</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.loginLink}>
            <Text style={styles.loginLinkText}>Already have an account? <Text style={styles.loginLinkBold}>Sign In</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.primary },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoArea: { alignItems: 'center', marginBottom: 20 },
  logoCircle: {
    width: 70, height: 70, borderRadius: 35, backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  appName: { fontSize: 28, fontWeight: '800', color: COLORS.white },
  inviteBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,210,160,0.15)',
    borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: COLORS.accent,
  },
  inviteText: { color: COLORS.white, marginLeft: 8, fontSize: 13 },
  warningBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245,159,0,0.15)',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  warningText: { color: COLORS.warning, marginLeft: 8, fontSize: 13 },
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
  btn: {
    backgroundColor: COLORS.secondary, borderRadius: 12, height: 50,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  btnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  loginLink: { alignItems: 'center', marginTop: 14 },
  loginLinkText: { fontSize: 13, color: COLORS.textLight },
  loginLinkBold: { color: COLORS.secondary, fontWeight: '700' },
});
