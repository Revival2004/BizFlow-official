import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../context/AuthContext';
import { COLORS, fmt } from '../../utils/constants';
import { attachSellerNames } from '../../utils/data';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { cleanObject, cleanText } from '../../utils/textEncoding';

export default function SalesHistoryScreen() {
  const { profile, hasPermission } = useAuth();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedSale, setSelectedSale] = useState(null);
  const [saleItems, setSaleItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    if (!profile?.business_id) {
      setSales([]);
      setLoading(false);
      return;
    }

    fetchSales();
  }, [filter, profile?.business_id]);

  const fetchSales = async () => {
    if (!profile?.business_id) {
      return;
    }

    setLoading(true);

    try {
      let query = supabase
        .from('sales')
        .select('*')
        .eq('business_id', profile.business_id)
        .order('created_at', { ascending: false })
        .limit(100);

      const now = new Date();
      if (filter === 'today') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        query = query.gte('created_at', start.toISOString());
      } else if (filter === 'week') {
        const start = new Date(now);
        start.setDate(start.getDate() - 7);
        query = query.gte('created_at', start.toISOString());
      } else if (filter === 'month') {
        const start = new Date(now);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        query = query.gte('created_at', start.toISOString());
      }

      const { data, error } = await query;
      if (error) {
        throw error;
      }

      const nextSales = cleanObject(await attachSellerNames(data || []));
      setSales(nextSales);

      if (selectedSale?.id) {
        const refreshedSale = nextSales.find((entry) => entry.id === selectedSale.id);
        setSelectedSale(refreshedSale || null);

        if (refreshedSale) {
          await fetchSaleItems(refreshedSale.id);
        } else {
          setSaleItems([]);
        }
      }
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSaleItems = async (saleId, showLoader = false) => {
    if (showLoader) {
      setLoadingItems(true);
    }

    try {
      const { data, error } = await supabase
        .from('sale_items')
        .select('*')
        .eq('sale_id', saleId)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      const nextItems = cleanObject(data || []);
      setSaleItems(nextItems);
      return nextItems;
    } catch (error) {
      Alert.alert('Error', error.message);
      return [];
    } finally {
      if (showLoader) {
        setLoadingItems(false);
      }
    }
  };

  const viewSale = async (sale) => {
    setSelectedSale(sale);
    setSaleItems([]);
    await fetchSaleItems(sale.id, true);
  };

  useRealtimeRefresh({
    enabled: Boolean(profile?.business_id),
    channelName: `sales-history:${profile?.business_id}:${filter}`,
    bindings: [
      {
        event: '*',
        schema: 'public',
        table: 'sales',
        filter: `business_id=eq.${profile?.business_id}`,
      },
      {
        event: '*',
        schema: 'public',
        table: 'sale_items',
      },
      {
        event: '*',
        schema: 'public',
        table: 'profiles',
        filter: `business_id=eq.${profile?.business_id}`,
      },
    ],
    onChange: fetchSales,
  });

  const voidSale = async (saleId) => {
    if (!hasPermission('void_sale')) {
      Alert.alert('Permission Denied', 'You cannot void sales.');
      return;
    }

    Alert.alert('Void Sale', 'Are you sure? This will restore stock levels.', [
      { text: 'Cancel' },
      {
        text: 'Void',
        style: 'destructive',
        onPress: async () => {
          try {
            const { data, error } = await supabase.rpc('void_sale_atomic', {
              p_sale_id: saleId,
              p_voided_by: profile.id,
              p_void_reason: 'Customer request',
            });

            if (error) {
              throw error;
            }

            if (!data?.success) {
              throw new Error(data?.error || 'Sale could not be voided.');
            }

            setSelectedSale(null);
            setSaleItems([]);
            await fetchSales();
            Alert.alert('Voided', 'Sale has been voided and stock restored.');
          } catch (error) {
            Alert.alert('Error', error.message);
          }
        },
      },
    ]);
  };

  const searchTerm = cleanText(search || '').toLowerCase();
  const filtered = sales.filter((sale) =>
    cleanText(sale.reference_number || '').toLowerCase().includes(searchTerm) ||
    cleanText(sale.customer_name || '').toLowerCase().includes(searchTerm) ||
    cleanText(sale.sellerName || '').toLowerCase().includes(searchTerm)
  );

  const totalRevenue = filtered.reduce(
    (sum, sale) => sum + (sale.status === 'completed' ? Number(sale.total_amount || 0) : 0),
    0
  );
  const paymentIcon = (method) => {
    if (method === 'cash') return 'cash';
    if (method === 'card') return 'card';
    if (method === 'mpesa') return 'phone-portrait';
    return 'swap-horizontal';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={COLORS.textLight} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by ref, customer..."
            value={search}
            onChangeText={setSearch}
            placeholderTextColor={COLORS.textLight}
          />
        </View>
        <View style={styles.totalBadge}>
          <Text style={styles.totalBadgeText}>{fmt(totalRevenue)}</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {['all', 'today', 'week', 'month'].map((value) => (
          <TouchableOpacity key={value} style={[styles.filterBtn, filter === value && styles.filterBtnActive]} onPress={() => setFilter(value)}>
            <Text style={[styles.filterBtnText, filter === value && styles.filterBtnTextActive]}>{value.charAt(0).toUpperCase() + value.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.secondary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.saleCard} onPress={() => viewSale(item)}>
              <View style={styles.saleCardLeft}>
                <Text style={styles.saleRef}>{cleanText(item.reference_number || '')}</Text>
                <Text style={styles.saleCustomer}>{cleanText(item.customer_name || 'Walk-in Customer')}</Text>
                <Text style={styles.saleCashier}>By: {cleanText(item.sellerName || 'Staff')}</Text>
                <Text style={styles.saleDate}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
              <View style={styles.saleCardRight}>
                <Text style={styles.saleAmount}>{fmt(item.total_amount)}</Text>
                <View style={styles.methodBadge}>
                  <Ionicons name={paymentIcon(item.payment_method)} size={12} color={COLORS.textLight} />
                  <Text style={styles.methodText}>{item.payment_method}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: item.status === 'completed' ? COLORS.success + '20' : COLORS.danger + '20' }]}>
                  <Text style={[styles.statusText, { color: item.status === 'completed' ? COLORS.success : COLORS.danger }]}>{item.status}</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons name="receipt-outline" size={48} color={COLORS.textLight} />
              <Text style={styles.emptyText}>No sales found</Text>
            </View>
          )}
        />
      )}

      <Modal visible={!!selectedSale} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{cleanText(selectedSale?.reference_number || '')}</Text>
              <TouchableOpacity onPress={() => setSelectedSale(null)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView>
              <View style={styles.saleDetailRow}>
                <Text style={styles.detailLabel}>Customer</Text>
                <Text style={styles.detailValue}>{cleanText(selectedSale?.customer_name || 'Walk-in')}</Text>
              </View>
              <View style={styles.saleDetailRow}>
                <Text style={styles.detailLabel}>Date</Text>
                <Text style={styles.detailValue}>{selectedSale?.created_at ? new Date(selectedSale.created_at).toLocaleString() : ''}</Text>
              </View>
              <View style={styles.saleDetailRow}>
                <Text style={styles.detailLabel}>Payment</Text>
                <Text style={styles.detailValue}>{selectedSale?.payment_method}</Text>
              </View>

              <Text style={[styles.detailLabel, { marginTop: 16, marginBottom: 8 }]}>Items</Text>
              {loadingItems ? (
                <ActivityIndicator color={COLORS.secondary} />
              ) : (
                saleItems.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <Text style={styles.itemName} numberOfLines={1}>{cleanText(item.product_name || '')}</Text>
                    <Text style={styles.itemQty}>x{item.quantity}</Text>
                    <Text style={styles.itemTotal}>{fmt(item.total_price)}</Text>
                  </View>
                ))
              )}

              <View style={styles.modalTotalRow}>
                <Text style={styles.modalTotalLabel}>TOTAL</Text>
                <Text style={styles.modalTotalValue}>{fmt(selectedSale?.total_amount)}</Text>
              </View>
              {hasPermission('view_profits') && (
                <View style={styles.modalTotalRow}>
                  <Text style={[styles.modalTotalLabel, { color: COLORS.success }]}>PROFIT</Text>
                  <Text style={[styles.modalTotalValue, { color: COLORS.success }]}>{fmt(selectedSale?.profit)}</Text>
                </View>
              )}
            </ScrollView>

            {hasPermission('void_sale') && selectedSale?.status === 'completed' && (
              <TouchableOpacity style={styles.voidBtn} onPress={() => voidSale(selectedSale.id)}>
                <Ionicons name="close-circle" size={18} color={COLORS.danger} />
                <Text style={styles.voidBtnText}>Void Sale</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', padding: 12, gap: 10, alignItems: 'center' },
  searchRow: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.white, borderRadius: 10, paddingHorizontal: 12, height: 42, borderWidth: 1, borderColor: COLORS.border },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: COLORS.text },
  totalBadge: { backgroundColor: COLORS.secondary, borderRadius: 10, paddingHorizontal: 12, height: 42, justifyContent: 'center' },
  totalBadgeText: { color: COLORS.white, fontWeight: '800', fontSize: 12 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 8, marginBottom: 8 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.border },
  filterBtnActive: { backgroundColor: COLORS.secondary, borderColor: COLORS.secondary },
  filterBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.textLight },
  filterBtnTextActive: { color: COLORS.white },
  list: { padding: 12, paddingTop: 0 },
  saleCard: { backgroundColor: COLORS.white, borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  saleCardLeft: { flex: 1 },
  saleRef: { fontSize: 14, fontWeight: '700', color: COLORS.secondary },
  saleCustomer: { fontSize: 13, color: COLORS.text, marginTop: 2 },
  saleCashier: { fontSize: 11, color: COLORS.textLight },
  saleDate: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  saleCardRight: { alignItems: 'flex-end' },
  saleAmount: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  methodBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  methodText: { fontSize: 10, color: COLORS.textLight, textTransform: 'uppercase' },
  statusBadge: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  statusText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  empty: { alignItems: 'center', padding: 48 },
  emptyText: { color: COLORS.textLight, marginTop: 10, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  saleDetailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  detailLabel: { fontSize: 13, color: COLORS.textLight },
  detailValue: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  itemRow: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border, alignItems: 'center' },
  itemName: { flex: 1, fontSize: 13, color: COLORS.text },
  itemQty: { fontSize: 13, color: COLORS.textLight, marginHorizontal: 12 },
  itemTotal: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  modalTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12 },
  modalTotalLabel: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  modalTotalValue: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  voidBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: COLORS.danger, borderRadius: 12, height: 44, marginTop: 16 },
  voidBtnText: { color: COLORS.danger, fontWeight: '700' },
});
