import React, { useDeferredValue, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, TextInput, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fmt } from '../../utils/constants';
import { attachSellerNames } from '../../utils/data';
import { cacheDashboardSnapshot, getCachedDashboardSnapshot, syncOfflineData } from '../../utils/offline';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { cleanText } from '../../utils/textEncoding';

export default function DashboardScreen({ navigation }) {
  const { profile, hasPermission } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState(null);
  const [recentSales, setRecentSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [fastMovers, setFastMovers] = useState([]);
  const [stockLookup, setStockLookup] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [targetModal, setTargetModal] = useState(false);
  const [monthlyTarget, setMonthlyTarget] = useState('');
  const [savedTarget, setSavedTarget] = useState(0);
  const [endDayModal, setEndDayModal] = useState(false);
  const [syncBanner, setSyncBanner] = useState(false);
  const [dayEnded, setDayEnded] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const deferredStockLookup = useDeferredValue(stockLookup);
  const openSecondaryScreen = (routeName) => {
    const parentNavigation = navigation.getParent?.();
    if (parentNavigation?.navigate) {
      parentNavigation.navigate(routeName);
      return;
    }

    navigation.navigate(routeName);
  };

  useEffect(() => {
    if (!profile?.business_id || !profile?.id) {
      return undefined;
    }

    loadTarget();
    checkDayEnded();
    fetchStats();
    attemptSync();

    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });

    NetInfo.fetch().then((state) => {
      setIsOffline(!state.isConnected);
    });

    return () => unsubscribe();
  }, [profile?.business_id, profile?.id]);

  const loadTarget = async () => {
    const target = await AsyncStorage.getItem(`monthly_target_${profile?.business_id}`);
    if (target) {
      setSavedTarget(parseFloat(target));
    }
  };

  const checkDayEnded = async () => {
    const key = `day_ended_${profile?.business_id}_${new Date().toDateString()}`;
    const ended = await AsyncStorage.getItem(key);
    setDayEnded(ended === 'true');
  };

  const saveTarget = async () => {
    const value = parseFloat(monthlyTarget);
    if (!value || value <= 0) {
      Alert.alert('Error', 'Enter a valid amount');
      return;
    }

    await AsyncStorage.setItem(`monthly_target_${profile?.business_id}`, String(value));
    setSavedTarget(value);
    setTargetModal(false);
    setMonthlyTarget('');
  };

  const attemptSync = async () => {
    try {
      const result = await syncOfflineData(profile?.business_id, profile?.id);
      if (result.synced > 0) {
        setSyncBanner(true);
        setTimeout(() => setSyncBanner(false), 4000);
      }
    } catch {
      // Keep dashboard usable even if offline sync fails.
    }
  };

  const fetchStats = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const monthStart = new Date(today);
      monthStart.setDate(1);
      const moversStart = new Date(today);
      moversStart.setDate(moversStart.getDate() - 29);

      const [todayRes, monthRes, recentRes, productsRes, moverItemsRes] = await Promise.all([
        supabase
          .from('sales')
          .select('total_amount, profit, status')
          .eq('business_id', profile.business_id)
          .gte('created_at', today.toISOString()),
        supabase
          .from('sales')
          .select('total_amount')
          .eq('business_id', profile.business_id)
          .eq('status', 'completed')
          .gte('created_at', monthStart.toISOString()),
        supabase
          .from('sales')
          .select('*')
          .eq('business_id', profile.business_id)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('products')
          .select('id, name, sku, barcode, quantity, reorder_level, unit, selling_price')
          .eq('business_id', profile.business_id)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('sale_items')
          .select('product_id, product_name, quantity, total_price, profit, sale_id, sales!inner(created_at, status, business_id)')
          .eq('sales.business_id', profile.business_id)
          .eq('sales.status', 'completed')
          .gte('sales.created_at', moversStart.toISOString()),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (moverItemsRes.error) throw moverItemsRes.error;

      const completed = (todayRes.data || []).filter((sale) => sale.status === 'completed');
      const recentSalesWithNames = await attachSellerNames(recentRes.data || []);
      const inventory = productsRes.data || [];
      const moverInsights = buildFastMoverInsights(moverItemsRes.data || [], inventory);

      setStats({
        todayRevenue: completed.reduce((sum, sale) => sum + (sale.total_amount || 0), 0),
        todayProfit: completed.reduce((sum, sale) => sum + (sale.profit || 0), 0),
        todayOrders: completed.length,
        monthRevenue: (monthRes.data || []).reduce((sum, sale) => sum + (sale.total_amount || 0), 0),
      });
      setRecentSales(recentSalesWithNames);
      setProducts(inventory);
      setFastMovers(moverInsights);
      await cacheDashboardSnapshot(profile.business_id, {
        stats: {
          todayRevenue: completed.reduce((sum, sale) => sum + (sale.total_amount || 0), 0),
          todayProfit: completed.reduce((sum, sale) => sum + (sale.profit || 0), 0),
          todayOrders: completed.length,
          monthRevenue: (monthRes.data || []).reduce((sum, sale) => sum + (sale.total_amount || 0), 0),
        },
        recentSales: recentSalesWithNames,
        products: inventory,
        fastMovers: moverInsights,
      });
    } catch (error) {
      console.error(error);
      const cached = await getCachedDashboardSnapshot(profile?.business_id);
      if (cached) {
        setStats(cached.stats || null);
        setRecentSales(cached.recentSales || []);
        setProducts(cached.products || []);
        setFastMovers(cached.fastMovers || []);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useRealtimeRefresh({
    enabled: Boolean(profile?.business_id) && !isOffline,
    channelName: `dashboard:${profile?.business_id}`,
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
        table: 'profiles',
        filter: `business_id=eq.${profile?.business_id}`,
      },
      {
        event: '*',
        schema: 'public',
        table: 'products',
        filter: `business_id=eq.${profile?.business_id}`,
      },
    ],
    onChange: fetchStats,
  });

  const endDay = () => {
    Alert.alert(
      "End Today's Session?",
      'This resets your live dashboard view. All sales are still safely stored in Reports.',
      [
        { text: 'Cancel' },
        {
          text: 'End Day',
          style: 'destructive',
          onPress: async () => {
            const key = `day_ended_${profile?.business_id}_${new Date().toDateString()}`;
            await AsyncStorage.setItem(key, 'true');
            setDayEnded(true);
            setEndDayModal(false);
            Alert.alert('Session Ended', 'Dashboard reset. View your full history in Reports.');
          },
        },
      ]
    );
  };

  const targetProgress = savedTarget > 0
    ? Math.min(((stats?.monthRevenue || 0) / savedTarget) * 100, 100)
    : 0;

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  const displayRevenue = dayEnded ? 0 : (stats?.todayRevenue || 0);
  const displayProfit = dayEnded ? 0 : (stats?.todayProfit || 0);
  const displayOrders = dayEnded ? 0 : (stats?.todayOrders || 0);
  const normalizedLookup = normalizeInventorySearch(deferredStockLookup);
  const lookupResults = normalizedLookup.length < 2
    ? []
    : products
      .filter((product) => (
        normalizeInventorySearch(product.name).includes(normalizedLookup) ||
        normalizeInventorySearch(product.sku).includes(normalizedLookup) ||
        normalizeInventorySearch(product.barcode).includes(normalizedLookup)
      ))
      .slice(0, 6);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {syncBanner && (
        <View style={{ backgroundColor: colors.success, padding: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <Ionicons name="cloud-upload" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Offline sales synced to cloud.</Text>
        </View>
      )}
      {isOffline && (
        <View style={{ backgroundColor: '#F59F00', padding: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <Ionicons name="cloud-offline" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Offline mode: showing your last synced dashboard.</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom }}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchStats();
            }}
            colors={[colors.secondary]}
          />
        )}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <View>
            <Text style={{ fontSize: 13, color: colors.textLight }}>Good {getGreeting()}</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{profile?.full_name?.split(' ')[0]}</Text>
          </View>
          <View style={{ backgroundColor: colors.secondary + '20', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ color: colors.secondary, fontSize: 11, fontWeight: '700' }}>{profile?.roles?.name?.replace('_', ' ').toUpperCase()}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
          <View
            style={{
              flex: 1,
              borderRadius: 22,
              padding: 18,
              backgroundColor: colors.secondary,
              shadowColor: colors.secondary,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.3,
              shadowRadius: 16,
              elevation: 8,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="cash" size={20} color="#fff" />
              </View>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, fontWeight: '700' }}>{displayOrders} SALES</Text>
              </View>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 }}>TODAY'S REVENUE</Text>
            <Text style={{ color: '#fff', fontSize: 19, fontWeight: '900', marginTop: 4, letterSpacing: -0.5 }}>{fmt(displayRevenue)}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, marginTop: 3 }}>Kenyan Shillings</Text>
          </View>

          {hasPermission('view_profits') && (
            <View
              style={{
                flex: 1,
                borderRadius: 22,
                padding: 18,
                backgroundColor: '#0F172A',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.25,
                shadowRadius: 16,
                elevation: 8,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="trending-up" size={20} color="#4ADE80" />
                </View>
                <View style={{ backgroundColor: displayRevenue > 0 ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.1)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: displayRevenue > 0 ? '#4ADE80' : 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '700' }}>
                    {displayRevenue > 0 ? `${((displayProfit / displayRevenue) * 100).toFixed(1)}%` : '0%'}
                  </Text>
                </View>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 }}>TODAY'S PROFIT</Text>
              <Text style={{ color: '#fff', fontSize: 19, fontWeight: '900', marginTop: 4, letterSpacing: -0.5 }}>{fmt(displayProfit)}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 3 }}>Gross margin</Text>
            </View>
          )}
        </View>

        <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>Monthly Target</Text>
            <TouchableOpacity onPress={() => { setMonthlyTarget(savedTarget ? String(savedTarget) : ''); setTargetModal(true); }}>
              <Text style={{ color: colors.secondary, fontSize: 12, fontWeight: '700' }}>{savedTarget > 0 ? 'Edit' : '+ Set Target'}</Text>
            </TouchableOpacity>
          </View>
          {savedTarget > 0 ? (
            <>
              <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' }}>
                <View style={{ height: 8, borderRadius: 4, width: `${targetProgress}%`, backgroundColor: targetProgress >= 100 ? colors.success : colors.secondary }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ fontSize: 11, color: colors.textLight }}>{fmt(stats?.monthRevenue || 0)} this month</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: targetProgress >= 100 ? colors.success : colors.secondary }}>{targetProgress.toFixed(0)}% of {fmt(savedTarget)}</Text>
              </View>
            </>
          ) : (
            <Text style={{ fontSize: 13, color: colors.textLight }}>Tap "Set Target" to track your monthly goal.</Text>
          )}
        </View>

        {hasPermission('view_stock') && (
          <>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 }}>Inventory Check</Text>
            <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 14, paddingHorizontal: 14, height: 46, borderWidth: 1, borderColor: colors.border }}>
                <Ionicons name="search" size={17} color={colors.textLight} />
                <TextInput
                  style={{ flex: 1, marginLeft: 10, fontSize: 14, color: colors.text }}
                  placeholder="Search item, SKU or barcode"
                  value={stockLookup}
                  onChangeText={setStockLookup}
                  placeholderTextColor={colors.textLight}
                />
                <TouchableOpacity onPress={() => navigation.navigate('Stock')}>
                  <Text style={{ color: colors.secondary, fontWeight: '700', fontSize: 12 }}>Open Stock</Text>
                </TouchableOpacity>
              </View>

              {normalizedLookup.length < 2 ? (
                <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 12 }}>Type at least 2 characters to confirm whether an item already exists in stock.</Text>
              ) : lookupResults.length === 0 ? (
                <View style={{ marginTop: 12, backgroundColor: colors.bg, borderRadius: 14, padding: 14 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>No stock match found</Text>
                  <Text style={{ fontSize: 12, color: colors.textLight, marginTop: 4 }}>Try another name, SKU or barcode.</Text>
                </View>
              ) : (
                <View style={{ marginTop: 12, gap: 8 }}>
                  {lookupResults.map((item) => {
                    const stockStatus = getDashboardStockStatus(item);
                    const statusColor = stockStatus === 'Out of Stock'
                      ? colors.danger
                      : stockStatus === 'Low Stock'
                        ? colors.warning
                        : colors.success;

                    return (
                      <TouchableOpacity
                        key={item.id}
                        activeOpacity={0.8}
                        onPress={() => navigation.navigate('Stock')}
                        style={{ backgroundColor: colors.bg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text }}>{cleanText(item.name || '')}</Text>
                            <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 4 }}>
                              {[item.sku ? `SKU ${cleanText(item.sku || '')}` : null, item.barcode ? `Code ${cleanText(item.barcode || '')}` : null].filter(Boolean).join(' • ') || 'No code saved'}
                            </Text>
                          </View>
                          <View style={{ backgroundColor: statusColor + '18', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: statusColor }}>{stockStatus}</Text>
                          </View>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                          <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 10 }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textLight, marginBottom: 4 }}>Stock Left</Text>
                            <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>{Number(item.quantity || 0)} {cleanText(item.unit || 'pcs')}</Text>
                          </View>
                          <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 10 }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textLight, marginBottom: 4 }}>Selling Price</Text>
                            <Text style={{ fontSize: 15, fontWeight: '800', color: colors.secondary }}>{fmt(item.selling_price || 0)}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}

        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 }}>Quick Actions</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          {hasPermission('create_sale') && (
            <TouchableOpacity style={{ flex: 1, backgroundColor: colors.secondary, borderRadius: 16, padding: 14, alignItems: 'center', gap: 6, elevation: 3 }} onPress={() => navigation.navigate('Sales', { screen: 'NewSale' })}>
              <Ionicons name="add-circle" size={26} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>New Sale</Text>
            </TouchableOpacity>
          )}
          {hasPermission('view_stock') && (
            <TouchableOpacity style={{ flex: 1, backgroundColor: colors.accent, borderRadius: 16, padding: 14, alignItems: 'center', gap: 6, elevation: 3 }} onPress={() => navigation.navigate('Stock')}>
              <Ionicons name="cube" size={26} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Stock</Text>
            </TouchableOpacity>
          )}
          {hasPermission('view_reports') && (
            <TouchableOpacity style={{ flex: 1, backgroundColor: colors.warning, borderRadius: 16, padding: 14, alignItems: 'center', gap: 6, elevation: 3 }} onPress={() => navigation.navigate('Reports')}>
              <Ionicons name="bar-chart" size={26} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Reports</Text>
            </TouchableOpacity>
          )}
          {hasPermission('manage_staff') && (
            <TouchableOpacity style={{ flex: 1, backgroundColor: '#334155', borderRadius: 16, padding: 14, alignItems: 'center', gap: 6, elevation: 3 }} onPress={() => openSecondaryScreen('Staff')}>
              <Ionicons name="people" size={26} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Staff</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity onPress={() => setEndDayModal(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1.5, borderColor: colors.danger + '40' }}>
          <Ionicons name="moon" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 14 }}>End Today's Sales Session</Text>
        </TouchableOpacity>

        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 }}>Fast Movers</Text>
        {fastMovers.length === 0 ? (
          <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 24, alignItems: 'center', marginBottom: 16 }}>
            <Ionicons name="flash-outline" size={32} color={colors.textLight} />
            <Text style={{ color: colors.textLight, marginTop: 8, textAlign: 'center' }}>Fast-moving items will appear here after BizFlow sees enough sales activity.</Text>
          </View>
        ) : (
          <View style={{ marginBottom: 16 }}>
            {fastMovers.map((item) => {
              const statusColor = item.status === 'Restock Soon'
                ? colors.warning
                : item.status === 'Low Stock' || item.status === 'Out of Stock'
                  ? colors.danger
                  : colors.success;

              return (
                <View key={item.id} style={{ backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.secondary + '18', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: colors.secondary }}>#{item.rank}</Text>
                        </View>
                        <Text style={{ flex: 1, fontSize: 14, fontWeight: '800', color: colors.text }}>{cleanText(item.name || '')}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.textLight }}>{item.qty} sold in the last 30 days across {item.salesCount} sale{item.salesCount === 1 ? '' : 's'}</Text>
                    </View>
                    <View style={{ backgroundColor: statusColor + '18', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: statusColor }}>{item.status}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <View style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 10 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textLight, marginBottom: 4 }}>Revenue</Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: colors.secondary }}>{fmt(item.revenue)}</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 10 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textLight, marginBottom: 4 }}>Stock Left</Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: statusColor }}>{item.currentStock} {item.unit}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 }}>Recent Sales</Text>
        {recentSales.length === 0 ? (
          <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 28, alignItems: 'center' }}>
            <Ionicons name="receipt-outline" size={40} color={colors.textLight} />
            <Text style={{ color: colors.textLight, marginTop: 8 }}>No sales recorded yet</Text>
          </View>
        ) : recentSales.map((sale) => (
          <View key={sale.id} style={{ backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.secondary }}>#{sale.reference_number?.slice(-8)}</Text>
              <Text style={{ fontSize: 11, color: colors.textLight, marginTop: 1 }}>{sale.sellerName}</Text>
              <Text style={{ fontSize: 10, color: colors.textLight }}>{new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>{fmt(sale.total_amount)}</Text>
              <View style={{ backgroundColor: sale.status === 'completed' ? colors.success + '20' : colors.danger + '20', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: sale.status === 'completed' ? colors.success : colors.danger }}>{sale.status}</Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={targetModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 32 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 20, padding: 24 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 }}>Monthly Revenue Target</Text>
            <Text style={{ fontSize: 13, color: colors.textLight, marginBottom: 16 }}>Set your sales goal for this month (KES)</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, height: 52, fontSize: 20, fontWeight: '700', color: colors.text, backgroundColor: colors.inputBg, marginBottom: 16 }}
              placeholder="e.g. 500000"
              value={monthlyTarget}
              onChangeText={setMonthlyTarget}
              keyboardType="numeric"
              autoFocus
              placeholderTextColor={colors.textLight}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setTargetModal(false)} style={{ flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.textLight, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveTarget} style={{ flex: 2, backgroundColor: colors.secondary, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Save Target</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={endDayModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 32 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 20, padding: 24 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8 }}>End Today's Session?</Text>
            <Text style={{ fontSize: 13, color: colors.textLight, marginBottom: 20 }}>This resets your dashboard counters. All sales data is safely saved and viewable in Reports.</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setEndDayModal(false)} style={{ flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.textLight, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={endDay} style={{ flex: 2, backgroundColor: colors.danger, borderRadius: 12, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>End Day</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function normalizeInventorySearch(value) {
  return cleanText(value || '').toLowerCase().trim();
}

function getDashboardStockStatus(product) {
  const quantity = Number(product?.quantity || 0);
  const reorderLevel = Number(product?.reorder_level || 0);

  if (quantity <= 0) return 'Out of Stock';
  if (quantity <= reorderLevel) return 'Low Stock';
  return 'In Stock';
}

function buildFastMoverInsights(items = [], products = []) {
  const productLookup = new Map(
    products.map((product) => [product.id, {
      id: product.id,
      name: cleanText(product.name || ''),
      currentStock: Number(product.quantity || 0),
      reorderLevel: Number(product.reorder_level || 0),
      unit: cleanText(product.unit || 'pcs'),
    }]),
  );
  const grouped = {};

  items.forEach((item) => {
    const key = item.product_id || cleanText(item.product_name || '');
    const productMeta = item.product_id ? productLookup.get(item.product_id) : null;

    if (!grouped[key]) {
      grouped[key] = {
        id: item.product_id || key,
        name: cleanText(item.product_name || productMeta?.name || 'Unnamed item'),
        qty: 0,
        revenue: 0,
        salesCountSet: new Set(),
        currentStock: Number(productMeta?.currentStock || 0),
        reorderLevel: Number(productMeta?.reorderLevel || 0),
        unit: productMeta?.unit || 'pcs',
      };
    }

    grouped[key].qty += Number(item.quantity || 0);
    grouped[key].revenue += Number(item.total_price || 0);
    if (item.sale_id) {
      grouped[key].salesCountSet.add(item.sale_id);
    }
  });

  return Object.values(grouped)
    .map(({ salesCountSet, ...entry }) => ({
      ...entry,
      salesCount: salesCountSet.size,
    }))
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, 5)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
      status: entry.currentStock <= 0
        ? 'Out of Stock'
        : entry.currentStock <= Math.max(entry.reorderLevel, Math.ceil(entry.qty / 4))
          ? 'Restock Soon'
          : 'Fast Moving',
    }));
}
