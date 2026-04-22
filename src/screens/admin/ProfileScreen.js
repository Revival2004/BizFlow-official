import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView, TextInput, ActivityIndicator, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { supabase } from '../../utils/supabase';
import { ROLE_PERMISSIONS } from '../../utils/constants';

export default function ProfileScreen() {
  const { profile, signOut, fetchProfile, isSuperAdmin } = useAuth();
  const { colors, isDark, toggleTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(profile?.full_name || '');
  const [saving, setSaving] = useState(false);
  const [changingPass, setChangingPass] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');

  useEffect(() => {
    setName(profile?.full_name || '');
  }, [profile?.full_name]);

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

  const perms = ROLE_PERMISSIONS[profile?.roles?.name] || {};
  const allowedPerms = Object.entries(perms).filter(([, allowed]) => allowed).map(([permission]) => permission);
  const deniedPerms = Object.entries(perms).filter(([, allowed]) => !allowed).map(([permission]) => permission);

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
