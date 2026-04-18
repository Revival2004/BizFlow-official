import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Modal, Alert, ActivityIndicator, ScrollView, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoLinking from 'expo-linking';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../context/AuthContext';
import { COLORS, ROLE_PERMISSIONS } from '../../utils/constants';
import { humanizeLabel } from '../../utils/data';

const AVAILABLE_ROLES = [
  { key: 'sales_manager', label: 'Sales Manager', desc: 'Can sell, view reports and profits', color: COLORS.secondary, icon: 'trending-up' },
  { key: 'cashier', label: 'Cashier', desc: 'Can process sales only', color: COLORS.accent, icon: 'cash' },
  { key: 'stock_manager', label: 'Stock Manager', desc: 'Manages inventory and categories', color: COLORS.warning, icon: 'cube' },
  { key: 'accountant', label: 'Accountant', desc: 'View-only: sales, reports and profits', color: COLORS.success, icon: 'calculator' },
];

export default function StaffScreen() {
  const { profile, hasPermission } = useAuth();
  const [staff, setStaff] = useState([]);
  const [invites, setInvites] = useState([]);
  const [businessName, setBusinessName] = useState('Your Business');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('staff');
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState('cashier');
  const [roles, setRoles] = useState([]);
  const [sending, setSending] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editStaff, setEditStaff] = useState(null);
  const [inviteResult, setInviteResult] = useState(null);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      const [staffRes, rolesRes, invitesRes, businessRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*, roles(*)')
          .eq('business_id', profile.business_id)
          .neq('id', profile.id)
          .order('created_at', { ascending: false }),
        supabase.from('roles').select('*').eq('business_id', profile.business_id),
        supabase
          .from('invitations')
          .select('*, roles(name)')
          .eq('business_id', profile.business_id)
          .order('created_at', { ascending: false }),
        supabase.from('businesses').select('name').eq('id', profile.business_id).single(),
      ]);

      if (staffRes.error) throw staffRes.error;
      if (rolesRes.error) throw rolesRes.error;
      if (invitesRes.error) throw invitesRes.error;
      if (businessRes.error) throw businessRes.error;

      setStaff(staffRes.data || []);
      setRoles(rolesRes.data || []);
      setInvites(invitesRes.data || []);
      setBusinessName(businessRes.data?.name || 'Your Business');
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const buildInviteLinks = (token, providedWebLink) => {
    const encodedToken = encodeURIComponent(token);
    const appLink = `bizflow://register?token=${encodedToken}`;
    const webLink = providedWebLink && providedWebLink !== appLink ? providedWebLink : null;
    return { appLink, webLink };
  };

  const showInviteResult = ({ email, token, roleName, delivery, message, webLink }) => {
    const links = buildInviteLinks(token, webLink);
    setInviteResult({
      email,
      roleLabel: roleName ? humanizeLabel(roleName) : '',
      delivery,
      message,
      ...links,
    });
  };

  const shareInviteResult = async () => {
    if (!inviteResult) {
      return;
    }

    const lines = [
      `BizFlow invite for ${inviteResult.email}${inviteResult.roleLabel ? ` as ${inviteResult.roleLabel}` : ''}.`,
      inviteResult.webLink ? `Web registration link:\n${inviteResult.webLink}` : null,
      `App invite link:\n${inviteResult.appLink}`,
    ].filter(Boolean);

    try {
      await Share.share({
        message: lines.join('\n\n'),
        url: inviteResult.webLink || inviteResult.appLink,
      });
    } catch (_error) {
      Alert.alert('Share Unavailable', 'Copy the invite link manually from the screen.');
    }
  };

  const openInviteLink = async (url) => {
    if (!url) {
      return;
    }

    try {
      await ExpoLinking.openURL(url);
    } catch (_error) {
      Alert.alert('Unable to Open Link', 'Copy the link manually from the screen.');
    }
  };

  const sendInvite = async () => {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      Alert.alert('Error', 'Enter a valid email address');
      return;
    }

    const already = staff.find((member) => member.email === normalizedEmail);
    if (already) {
      Alert.alert('Already Staff', 'This person is already in your team.');
      return;
    }

    const pending = invites.find((invite) => invite.email === normalizedEmail && invite.status === 'pending');
    if (pending) {
      Alert.alert('Already Invited', 'A pending invitation already exists for this email.');
      return;
    }

    setSending(true);

    try {
      const role = roles.find((entry) => entry.name === selectedRole);
      if (!role) {
        throw new Error('Role not found. Setup may be incomplete.');
      }

      const token = Math.random().toString(36).substring(2) + Date.now().toString(36);

      const { error: inviteError } = await supabase.from('invitations').insert({
        email: normalizedEmail,
        role_id: role.id,
        business_id: profile.business_id,
        invited_by: profile.id,
        token,
        status: 'pending',
      });

      if (inviteError) {
        throw inviteError;
      }

      const { data: emailData, error: emailError } = await supabase.functions.invoke('send-invite-email', {
        body: {
          to: normalizedEmail,
          token,
          roleName: selectedRole,
          inviterName: profile.full_name,
          businessName,
        },
      });

      setInviteModal(false);
      setInviteEmail('');
      setSelectedRole('cashier');
      await fetchAll();

      if (emailError) {
        showInviteResult({
          email: normalizedEmail,
          token,
          roleName: selectedRole,
          delivery: 'failed',
          message: 'The invite was saved, but BizFlow could not send the email. Share the link below manually.',
        });
        return;
      }

      if (emailData?.delivery === 'sent') {
        Alert.alert(
          'Invitation Sent',
          `The invitation email was sent to ${normalizedEmail}.`
        );
        return;
      }

      showInviteResult({
        email: normalizedEmail,
        token,
        roleName: selectedRole,
        delivery: emailData?.delivery || 'manual',
        message: emailData?.message || 'The invite was saved. Share the link below manually.',
        webLink: emailData?.webLink || null,
      });
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setSending(false);
    }
  };

  const revokeInvite = async (inviteId) => {
    Alert.alert('Revoke', 'Cancel this invitation?', [
      { text: 'No' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('invitations')
              .update({ status: 'revoked' })
              .eq('id', inviteId);

            if (error) {
              throw error;
            }

            await fetchAll();
          } catch (err) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  };

  const updateStaffRole = async () => {
    if (!editStaff) {
      return;
    }

    const role = roles.find((entry) => entry.name === editStaff.newRole);
    if (!role) {
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role_id: role.id })
        .eq('id', editStaff.id);

      if (error) {
        throw error;
      }

      setEditModal(false);
      await fetchAll();
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const deactivateStaff = (staffMember) => {
    Alert.alert('Deactivate', `Remove ${staffMember.full_name} from your team?`, [
      { text: 'Cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase
              .from('profiles')
              .update({ status: 'inactive' })
              .eq('id', staffMember.id);

            if (error) {
              throw error;
            }

            await fetchAll();
          } catch (err) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  };

  const roleColor = (roleName) => AVAILABLE_ROLES.find((role) => role.key === roleName)?.color || COLORS.textLight;
  const roleIcon = (roleName) => AVAILABLE_ROLES.find((role) => role.key === roleName)?.icon || 'person';

  const getInviteStatus = (invite) => {
    if (invite.status === 'pending') {
      const expiry = new Date(invite.created_at);
      expiry.setHours(expiry.getHours() + 48);
      if (new Date() > expiry) return { label: 'Expired', color: COLORS.danger };
      return { label: 'Pending', color: COLORS.warning };
    }
    if (invite.status === 'accepted') return { label: 'Accepted', color: COLORS.success };
    return { label: invite.status, color: COLORS.textLight };
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.secondary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'staff' && styles.tabActive]} onPress={() => setTab('staff')}>
          <Ionicons name="people" size={16} color={tab === 'staff' ? COLORS.secondary : COLORS.textLight} />
          <Text style={[styles.tabText, tab === 'staff' && styles.tabTextActive]}>Staff ({staff.filter((member) => member.status === 'active').length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'invites' && styles.tabActive]} onPress={() => setTab('invites')}>
          <Ionicons name="mail" size={16} color={tab === 'invites' ? COLORS.secondary : COLORS.textLight} />
          <Text style={[styles.tabText, tab === 'invites' && styles.tabTextActive]}>Invites ({invites.filter((invite) => invite.status === 'pending').length})</Text>
        </TouchableOpacity>
        {hasPermission('invite_staff') && (
          <TouchableOpacity style={styles.inviteBtn} onPress={() => setInviteModal(true)}>
            <Ionicons name="person-add" size={16} color={COLORS.white} />
            <Text style={styles.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
        )}
      </View>

      {tab === 'staff' ? (
        <FlatList
          data={staff}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.staffCard, item.status === 'inactive' && { opacity: 0.5 }]}>
              <View style={[styles.avatar, { backgroundColor: roleColor(item.roles?.name) + '20' }]}>
                <Ionicons name={roleIcon(item.roles?.name)} size={22} color={roleColor(item.roles?.name)} />
              </View>
              <View style={styles.staffInfo}>
                <Text style={styles.staffName}>{item.full_name}</Text>
                <Text style={styles.staffEmail}>{item.email}</Text>
                <View style={[styles.rolePill, { backgroundColor: roleColor(item.roles?.name) + '20' }]}>
                  <Text style={[styles.rolePillText, { color: roleColor(item.roles?.name) }]}>
                    {item.roles?.name ? humanizeLabel(item.roles.name).toUpperCase() : 'NO ROLE'}
                  </Text>
                </View>
              </View>
              <View style={[styles.statusDot, { backgroundColor: item.status === 'active' ? COLORS.success : COLORS.danger }]} />
              {hasPermission('manage_staff') && item.status === 'active' && (
                <View style={styles.staffActions}>
                  <TouchableOpacity style={styles.staffActionBtn} onPress={() => { setEditStaff({ ...item, newRole: item.roles?.name }); setEditModal(true); }}>
                    <Ionicons name="pencil" size={16} color={COLORS.secondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.staffActionBtn} onPress={() => deactivateStaff(item)}>
                    <Ionicons name="person-remove" size={16} color={COLORS.danger} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color={COLORS.textLight} />
              <Text style={styles.emptyText}>No staff yet. Invite someone.</Text>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={invites}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const status = getInviteStatus(item);
            return (
              <View style={styles.inviteCard}>
                <View style={styles.inviteIcon}>
                  <Ionicons name="mail-outline" size={20} color={COLORS.secondary} />
                </View>
                <View style={styles.inviteInfo}>
                  <Text style={styles.inviteEmail}>{item.email}</Text>
                  <Text style={styles.inviteRole}>{humanizeLabel(item.roles?.name || '')}</Text>
                  <Text style={styles.inviteDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                </View>
                <View style={styles.inviteRight}>
                  <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.label}</Text>
                  </View>
                  {item.status === 'pending' && hasPermission('invite_staff') && (
                    <>
                      <TouchableOpacity
                        onPress={() => showInviteResult({
                          email: item.email,
                          token: item.token,
                          roleName: item.roles?.name || '',
                          delivery: 'manual',
                          message: 'Share this pending invite link manually if needed.',
                        })}
                        style={styles.secondaryActionBtn}
                      >
                        <Text style={styles.secondaryActionText}>Share</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => revokeInvite(item.id)} style={styles.revokeBtn}>
                        <Text style={styles.revokeBtnText}>Revoke</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons name="mail-outline" size={48} color={COLORS.textLight} />
              <Text style={styles.emptyText}>No invitations sent</Text>
            </View>
          )}
        />
      )}

      <Modal visible={inviteModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Team Member</Text>
              <TouchableOpacity onPress={() => setInviteModal(false)}><Ionicons name="close" size={24} color={COLORS.text} /></TouchableOpacity>
            </View>

            <Text style={styles.formLabel}>Email Address</Text>
            <View style={styles.emailInput}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textLight} />
              <TextInput style={styles.emailInputText} placeholder="colleague@email.com" value={inviteEmail} onChangeText={setInviteEmail} keyboardType="email-address" autoCapitalize="none" placeholderTextColor={COLORS.textLight} autoFocus />
            </View>

            <Text style={[styles.formLabel, { marginTop: 16 }]}>Assign Role</Text>
            <ScrollView>
              {AVAILABLE_ROLES.map((role) => (
                <TouchableOpacity
                  key={role.key}
                  style={[styles.roleOption, selectedRole === role.key && { borderColor: role.color, backgroundColor: role.color + '08' }]}
                  onPress={() => setSelectedRole(role.key)}
                >
                  <View style={[styles.roleIcon, { backgroundColor: role.color + '20' }]}>
                    <Ionicons name={role.icon} size={20} color={role.color} />
                  </View>
                  <View style={styles.roleOptionInfo}>
                    <Text style={styles.roleOptionName}>{role.label}</Text>
                    <Text style={styles.roleOptionDesc}>{role.desc}</Text>
                  </View>
                  {selectedRole === role.key && <Ionicons name="checkmark-circle" size={22} color={role.color} />}
                </TouchableOpacity>
              ))}

              {selectedRole && (
                <View style={styles.permPreview}>
                  <Text style={styles.permPreviewTitle}>Permissions for {humanizeLabel(selectedRole)}</Text>
                  <View style={styles.permGrid}>
                    {Object.entries(ROLE_PERMISSIONS[selectedRole] || {}).map(([permission, allowed]) => (
                      <View key={permission} style={styles.permItem}>
                        <Ionicons name={allowed ? 'checkmark-circle' : 'close-circle'} size={14} color={allowed ? COLORS.success : COLORS.danger} />
                        <Text style={[styles.permText, { color: allowed ? COLORS.text : COLORS.textLight }]}>{permission.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <TouchableOpacity style={styles.sendBtn} onPress={sendInvite} disabled={sending}>
                {sending ? <ActivityIndicator color={COLORS.white} /> : (
                  <>
                    <Ionicons name="send" size={18} color={COLORS.white} />
                    <Text style={styles.sendBtnText}>Send Invitation</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={editModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '60%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Role</Text>
              <TouchableOpacity onPress={() => setEditModal(false)}><Ionicons name="close" size={24} color={COLORS.text} /></TouchableOpacity>
            </View>
            <Text style={styles.formLabel}>{editStaff?.full_name}</Text>
            <ScrollView>
              {AVAILABLE_ROLES.map((role) => (
                <TouchableOpacity key={role.key} style={[styles.roleOption, editStaff?.newRole === role.key && { borderColor: role.color }]} onPress={() => setEditStaff({ ...editStaff, newRole: role.key })}>
                  <View style={[styles.roleIcon, { backgroundColor: role.color + '20' }]}><Ionicons name={role.icon} size={20} color={role.color} /></View>
                  <Text style={styles.roleOptionName}>{role.label}</Text>
                  {editStaff?.newRole === role.key && <Ionicons name="checkmark-circle" size={22} color={role.color} />}
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.sendBtn} onPress={updateStaffRole}>
                <Text style={styles.sendBtnText}>Update Role</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(inviteResult)} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '75%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {inviteResult?.delivery === 'failed' ? 'Invite Saved' : 'Share Invitation'}
              </Text>
              <TouchableOpacity onPress={() => setInviteResult(null)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.inviteSummaryCard}>
              <Text style={styles.inviteSummaryEmail}>{inviteResult?.email}</Text>
              {inviteResult?.roleLabel ? (
                <Text style={styles.inviteSummaryRole}>Role: {inviteResult.roleLabel}</Text>
              ) : null}
              <Text style={styles.inviteSummaryMessage}>
                {inviteResult?.message || 'Share the link below manually.'}
              </Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {inviteResult?.webLink ? (
                <View style={styles.linkCard}>
                  <Text style={styles.linkLabel}>Web registration link</Text>
                  <Text selectable style={styles.linkValue}>{inviteResult.webLink}</Text>
                  <TouchableOpacity
                    style={styles.linkActionBtn}
                    onPress={() => openInviteLink(inviteResult.webLink)}
                  >
                    <Text style={styles.linkActionText}>Open Web Link</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={styles.linkCard}>
                <Text style={styles.linkLabel}>App invite link</Text>
                <Text selectable style={styles.linkValue}>{inviteResult?.appLink}</Text>
              </View>

              <TouchableOpacity style={styles.sendBtn} onPress={shareInviteResult}>
                <Ionicons name="share-social" size={18} color={COLORS.white} />
                <Text style={styles.sendBtnText}>Share Invite Link</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabRow: { flexDirection: 'row', padding: 12, gap: 8, alignItems: 'center' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.border },
  tabActive: { borderColor: COLORS.secondary, backgroundColor: COLORS.secondary + '10' },
  tabText: { fontSize: 12, fontWeight: '600', color: COLORS.textLight },
  tabTextActive: { color: COLORS.secondary },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.secondary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  inviteBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 13 },
  list: { padding: 12, paddingTop: 0 },
  staffCard: { backgroundColor: COLORS.white, borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  staffInfo: { flex: 1 },
  staffName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  staffEmail: { fontSize: 12, color: COLORS.textLight, marginTop: 1 },
  rolePill: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  rolePillText: { fontSize: 10, fontWeight: '700' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  staffActions: { flexDirection: 'row', gap: 6, marginLeft: 6 },
  staffActionBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
  inviteCard: { backgroundColor: COLORS.white, borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  inviteIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.secondary + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  inviteInfo: { flex: 1 },
  inviteEmail: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  inviteRole: { fontSize: 12, color: COLORS.secondary, fontWeight: '600', textTransform: 'capitalize', marginTop: 1 },
  inviteDate: { fontSize: 11, color: COLORS.textLight },
  inviteRight: { alignItems: 'flex-end', gap: 4 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { fontSize: 10, fontWeight: '700' },
  revokeBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  revokeBtnText: { color: COLORS.danger, fontSize: 11, fontWeight: '600' },
  secondaryActionBtn: { paddingHorizontal: 8, paddingVertical: 2 },
  secondaryActionText: { color: COLORS.secondary, fontSize: 11, fontWeight: '600' },
  empty: { alignItems: 'center', padding: 48 },
  emptyText: { color: COLORS.textLight, marginTop: 10, fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  formLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  emailInput: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 14, height: 50, backgroundColor: COLORS.bg },
  emailInputText: { flex: 1, fontSize: 15, color: COLORS.text },
  roleOption: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  roleIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  roleOptionInfo: { flex: 1 },
  roleOptionName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  roleOptionDesc: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  permPreview: { backgroundColor: COLORS.bg, borderRadius: 12, padding: 12, marginBottom: 12 },
  permPreviewTitle: { fontSize: 12, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  permGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  permItem: { flexDirection: 'row', alignItems: 'center', gap: 4, width: '48%' },
  permText: { fontSize: 10, textTransform: 'capitalize' },
  inviteSummaryCard: { backgroundColor: COLORS.bg, borderRadius: 14, padding: 14, marginBottom: 14 },
  inviteSummaryEmail: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  inviteSummaryRole: { fontSize: 12, color: COLORS.secondary, fontWeight: '600', marginTop: 4 },
  inviteSummaryMessage: { fontSize: 12, color: COLORS.textLight, marginTop: 8, lineHeight: 18 },
  linkCard: { backgroundColor: COLORS.bg, borderRadius: 12, padding: 12, marginBottom: 10 },
  linkLabel: { fontSize: 12, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  linkValue: { fontSize: 12, color: COLORS.secondary, lineHeight: 18 },
  linkActionBtn: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border },
  linkActionText: { fontSize: 12, fontWeight: '700', color: COLORS.secondary },
  sendBtn: { backgroundColor: COLORS.secondary, borderRadius: 12, height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8, marginBottom: 16 },
  sendBtnText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
