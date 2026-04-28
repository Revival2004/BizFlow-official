import React, { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Alert, Modal, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { fmt } from '../../utils/constants';
import { attachSellerNames } from '../../utils/data';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { cleanText } from '../../utils/textEncoding';
import { cacheReportSnapshot, getCachedReportSnapshot, getCachedStockSnapshot } from '../../utils/offline';

const UTF8_BOM = '\uFEFF';

const escapeCsvValue = (value) => {
  const normalized = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '""');

  return `"${normalized}"`;
};

const PERIOD_LABELS = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
};

const buildCsvContent = ({ sales, period, summary }) => {
  const rows = [
    ['Reference', 'Date', 'Customer', 'Staff', 'Items', 'Total (KES)', 'Cost (KES)', 'Profit (KES)', 'Payment', 'Status'],
    ...sales.map((sale) => [
      cleanText(sale.reference_number || ''),
      new Date(sale.created_at).toLocaleString(),
      cleanText(sale.customer_name || 'Walk-in'),
      cleanText(sale.sellerName || ''),
      sale.items_count ?? sale.sale_items?.length ?? 0,
      Number(sale.total_amount || 0).toFixed(2),
      Number(sale.cost_total || 0).toFixed(2),
      Number(sale.profit || 0).toFixed(2),
      cleanText(sale.payment_method || ''),
      cleanText(sale.status || ''),
    ]),
    [],
    ['SUMMARY'],
    ['Period', period],
    ['Total Sales', summary?.totalSales || 0],
    ['Total Revenue (KES)', Number(summary?.totalRevenue || 0).toFixed(2)],
    ['Total Profit (KES)', Number(summary?.totalProfit || 0).toFixed(2)],
    ['Margin', `${Number(summary?.margin || 0).toFixed(1)}%`],
  ];

  return UTF8_BOM + rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
};

export default function ReportsScreen() {
  const { profile, hasPermission } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reportRequestRef = useRef(0);
  const productRequestRef = useRef(0);
  const itemRequestRef = useRef(0);
  const [period, setPeriod] = useState('week');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [salesByDay, setSalesByDay] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemModal, setItemModal] = useState(false);
  const [itemResult, setItemResult] = useState(null);
  const [searchingItem, setSearchingItem] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [isOffline, setIsOffline] = useState(false);
  const [fastMovers, setFastMovers] = useState([]);
  const deferredItemSearch = useDeferredValue(itemSearch);

  useEffect(() => {
    fetchReport();
  }, [period, profile?.business_id]);

  useEffect(() => {
    fetchAllProducts();
  }, [profile?.business_id]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });

    NetInfo.fetch().then((state) => {
      setIsOffline(!state.isConnected);
    });

    return () => unsubscribe();
  }, []);

  const fetchAllProducts = async () => {
    if (!profile?.business_id) {
      setAllProducts([]);
      return;
    }

    const requestId = Date.now();
    productRequestRef.current = requestId;

    try {
      const { data: products, error } = await supabase
        .from('products')
        .select('id, name')
        .eq('business_id', profile.business_id)
        .eq('is_active', true);

      if (error) {
        throw error;
      }

      if (productRequestRef.current === requestId) {
        startTransition(() => {
          setAllProducts(products || []);
        });
      }
    } catch (error) {
      console.error(error);
      const cachedStock = await getCachedStockSnapshot(profile?.business_id);
      if (productRequestRef.current === requestId && cachedStock?.products) {
        startTransition(() => {
          setAllProducts((cachedStock.products || []).map((product) => ({ id: product.id, name: product.name })));
        });
      }
    }
  };

  const getDateRange = () => {
    const end = new Date();
    const start = new Date();

    if (period === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      start.setDate(start.getDate() - 7);
    } else if (period === 'month') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    } else if (period === 'year') {
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
    }

    return { start: start.toISOString(), end: end.toISOString() };
  };

  const normalizedItemQuery = cleanText(deferredItemSearch || '').toLowerCase().trim();
  const itemSuggestions = normalizedItemQuery.length > 1
    ? allProducts
      .filter((product) => cleanText(product.name || '').toLowerCase().includes(normalizedItemQuery))
      .slice(0, 5)
    : [];

  const fetchReport = async () => {
    if (!profile?.business_id) {
      setData(null);
      setTopProducts([]);
      setFastMovers([]);
      setSalesByDay([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestId = Date.now();
    reportRequestRef.current = requestId;

    try {
      const { start } = getDateRange();
      const [salesRes, itemsRes, productsRes] = await Promise.all([
        supabase
          .from('sales')
          .select('*')
          .eq('business_id', profile.business_id)
          .eq('status', 'completed')
          .gte('created_at', start),
        supabase
          .from('sale_items')
          .select('*, sales!inner(created_at,business_id,status)')
          .eq('sales.business_id', profile.business_id)
          .eq('sales.status', 'completed')
          .gte('sales.created_at', start),
        supabase
          .from('products')
          .select('id, name, quantity, reorder_level, unit')
          .eq('business_id', profile.business_id)
          .eq('is_active', true),
      ]);

      if (salesRes.error) {
        throw salesRes.error;
      }

      if (itemsRes.error) {
        throw itemsRes.error;
      }

      if (productsRes.error) {
        throw productsRes.error;
      }

      const sales = salesRes.data || [];
      const items = itemsRes.data || [];
      const products = productsRes.data || [];
      const totalRevenue = sales.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0);
      const totalCost = sales.reduce((sum, sale) => sum + Number(sale.cost_total || 0), 0);
      const totalProfit = sales.reduce((sum, sale) => sum + Number(sale.profit || 0), 0);
      const productLookup = new Map(
        products.map((product) => [product.id, {
          id: product.id,
          name: cleanText(product.name || ''),
          quantity: Number(product.quantity || 0),
          reorderLevel: Number(product.reorder_level || 0),
          unit: cleanText(product.unit || 'pcs'),
        }]),
      );

      const productMap = {};
      items.forEach((item) => {
        const productMeta = item.product_id ? productLookup.get(item.product_id) : null;
        const key = item.product_id || cleanText(item.product_name || '');

        if (!productMap[key]) {
          productMap[key] = {
            id: item.product_id || key,
            name: cleanText(item.product_name || productMeta?.name || 'Unnamed item'),
            qty: 0,
            revenue: 0,
            profit: 0,
            saleIds: new Set(),
            currentStock: Number(productMeta?.quantity || 0),
            reorderLevel: Number(productMeta?.reorderLevel || 0),
            unit: productMeta?.unit || 'pcs',
          };
        }

        productMap[key].qty += Number(item.quantity || 0);
        productMap[key].revenue += Number(item.total_price || 0);
        productMap[key].profit += Number(item.profit || 0);
        if (item.sale_id) {
          productMap[key].saleIds.add(item.sale_id);
        }
      });

      const productEntries = Object.values(productMap).map(({ saleIds, ...product }) => ({
        ...product,
        salesCount: saleIds.size,
      }));
      const daysInRange = Math.max(1, Math.ceil((Date.now() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)));
      const totalItemsSold = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const days = Array.from({ length: 7 }, (_, index) => {
        const day = new Date();
        day.setDate(day.getDate() - (6 - index));
        day.setHours(0, 0, 0, 0);

        return {
          key: day.toISOString().slice(0, 10),
          label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getDay()],
          revenue: 0,
          count: 0,
        };
      });
      const dayLookup = new Map(days.map((day) => [day.key, day]));

      sales.forEach((sale) => {
        const saleDay = new Date(sale.created_at);
        saleDay.setHours(0, 0, 0, 0);
        const bucket = dayLookup.get(saleDay.toISOString().slice(0, 10));

        if (!bucket) {
          return;
        }

        bucket.revenue += Number(sale.total_amount || 0);
        bucket.count += 1;
      });

      if (reportRequestRef.current !== requestId) {
        return;
      }

      const nextData = {
        totalRevenue,
        totalCost,
        totalProfit,
        avgOrder: sales.length > 0 ? totalRevenue / sales.length : 0,
        margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
        totalSales: sales.length,
        totalItems: totalItemsSold,
      };
      const nextTopProducts = [...productEntries].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
      const nextFastMovers = [...productEntries]
        .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
        .slice(0, 5)
        .map((product, index) => {
          const dailyVelocity = product.qty / daysInRange;
          const coverDays = dailyVelocity > 0 ? product.currentStock / dailyVelocity : null;
          const needsRestock = product.currentStock <= product.reorderLevel || (coverDays !== null && coverDays <= 7);
          const watchStock = !needsRestock && coverDays !== null && coverDays <= 14;

          return {
            ...product,
            rank: index + 1,
            dailyVelocity,
            coverDays,
            status: needsRestock ? 'Restock Soon' : watchStock ? 'Watch Stock' : 'Fast Moving',
          };
        });
      startTransition(() => {
        setData(nextData);
        setTopProducts(nextTopProducts);
        setFastMovers(nextFastMovers);
        setSalesByDay(days);
      });
      await cacheReportSnapshot(profile.business_id, period, {
        data: nextData,
        topProducts: nextTopProducts,
        fastMovers: nextFastMovers,
        salesByDay: days,
      });
    } catch (error) {
      if (reportRequestRef.current === requestId) {
        const cached = await getCachedReportSnapshot(profile?.business_id, period);
        if (cached) {
          startTransition(() => {
            setData(cached.data || null);
            setTopProducts(cached.topProducts || []);
            setFastMovers(cached.fastMovers || []);
            setSalesByDay(cached.salesByDay || []);
          });
        } else {
          Alert.alert('Error', error.message);
        }
      }
    } finally {
      if (reportRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  useRealtimeRefresh({
    enabled: Boolean(profile?.business_id) && !isOffline,
    channelName: `reports:${profile?.business_id}:${period}`,
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
        table: 'products',
        filter: `business_id=eq.${profile?.business_id}`,
      },
    ],
    onChange: () => {
      fetchReport();
      fetchAllProducts();
    },
  });

  const downloadCsvOnWeb = (csv, filename) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('Web download is not available in this environment.');
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const exportCSV = async () => {
    if (!hasPermission('export_reports')) {
      Alert.alert('Permission Denied', 'You cannot export reports.');
      return;
    }

    if (exporting) {
      return;
    }

    setExporting(true);

    try {
      const { start } = getDateRange();
      const { data: rawSales, error } = await supabase
        .from('sales')
        .select('*, sale_items(*)')
        .eq('business_id', profile.business_id)
        .eq('status', 'completed')
        .gte('created_at', start)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      const sales = await attachSellerNames(rawSales || []);
      const csv = buildCsvContent({
        sales,
        period,
        summary: data,
      });

      const filename = `BizFlow_Report_${period}_${Date.now()}.csv`;

      if (Platform.OS === 'web') {
        downloadCsvOnWeb(csv, filename);
        Alert.alert('Downloaded', `${filename} has been downloaded.`);
        return;
      }

      const directory = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      if (!directory) {
        throw new Error('This device does not expose a writable folder for CSV export.');
      }

      const path = directory + filename;
      await FileSystem.writeAsStringAsync(path, csv);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Save BizFlow Report' });
      } else {
        Alert.alert('Saved', `Report saved to: ${path}`);
      }
    } catch (error) {
      Alert.alert('Export Failed', error.message);
    } finally {
      setExporting(false);
    }
  };

  const searchItem = async (name) => {
    const searchName = cleanText(name || '').trim();
    if (!searchName || searchingItem) {
      return;
    }

    if (isOffline) {
      Alert.alert('Offline Mode', 'Item-level report lookup needs a connection. The summary cards below still use your last synced data.');
      return;
    }

    setSearchingItem(true);
    const requestId = Date.now();
    itemRequestRef.current = requestId;

    try {
      const { start } = getDateRange();
      const { data: items, error } = await supabase
        .from('sale_items')
        .select('*, sales!inner(created_at,business_id,status,payment_method)')
        .eq('sales.business_id', profile.business_id)
        .eq('sales.status', 'completed')
        .gte('sales.created_at', start)
        .ilike('product_name', `%${searchName}%`);

      if (error) {
        throw error;
      }

      if (itemRequestRef.current !== requestId) {
        return;
      }

      if (!items || items.length === 0) {
        setItemResult({ notFound: true, name: searchName });
      } else {
        setItemResult({
          name: cleanText(items[0].product_name || searchName),
          totalQty: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          totalRev: items.reduce((sum, item) => sum + Number(item.total_price || 0), 0),
          totalProfit: items.reduce((sum, item) => sum + Number(item.profit || 0), 0),
          salesCount: new Set(items.map((item) => item.sale_id)).size,
          items: items.slice(0, 10),
        });
      }
    } catch (error) {
      if (itemRequestRef.current === requestId) {
        Alert.alert('Error', error.message);
      }
    } finally {
      if (itemRequestRef.current === requestId) {
        setSearchingItem(false);
      }
    }
  };

  const maxRevenue = Math.max(...salesByDay.map((day) => day.revenue), 1);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {isOffline && (
        <View style={{ backgroundColor: '#F59F00', padding: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <Ionicons name="cloud-offline" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Offline mode: showing your last synced reports.</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom }}>
        <View style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 4, marginBottom: 16 }}>
          {['today', 'week', 'month', 'year'].map((value) => (
            <TouchableOpacity key={value} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: period === value ? colors.secondary : 'transparent' }} onPress={() => setPeriod(value)}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: period === value ? '#fff' : colors.textLight }}>{value.charAt(0).toUpperCase() + value.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.success, borderRadius: 12, height: 44 }} onPress={exportCSV} disabled={exporting}>
            {exporting ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="download" size={18} color="#fff" />}
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{exporting ? 'Exporting...' : 'Export CSV'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.card, borderRadius: 12, height: 44, borderWidth: 1.5, borderColor: colors.border }} onPress={() => setItemModal(true)}>
            <Ionicons name="search" size={18} color={colors.secondary} />
            <Text style={{ color: colors.secondary, fontWeight: '700', fontSize: 13 }}>Item Report</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.secondary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              {[
                { label: 'Revenue', value: fmt(data?.totalRevenue), icon: 'cash-outline', color: colors.secondary, sub: `${data?.totalSales || 0} sales` },
                hasPermission('view_profits') && { label: 'Profit', value: fmt(data?.totalProfit), icon: 'trending-up', color: colors.success, sub: `${data?.margin?.toFixed(1) || '0.0'}% margin` },
                { label: 'Avg Order', value: fmt(data?.avgOrder), icon: 'receipt-outline', color: colors.warning },
                { label: 'Items Sold', value: String(data?.totalItems || 0), icon: 'cube-outline', color: colors.accent },
              ].filter(Boolean).map((card, index) => (
                <View key={index} style={{ flex: 1, minWidth: '45%', backgroundColor: colors.card, borderRadius: 14, padding: 14, borderTopWidth: 3, borderTopColor: card.color }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Ionicons name={card.icon} size={16} color={card.color} />
                    <Text style={{ fontSize: 11, color: colors.textLight, fontWeight: '600' }}>{card.label}</Text>
                  </View>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: card.color }}>{card.value}</Text>
                  {card.sub ? <Text style={{ fontSize: 10, color: colors.textLight, marginTop: 2 }}>{card.sub}</Text> : null}
                </View>
              ))}
            </View>

            {hasPermission('view_profits') && (
              <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 14 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 10 }}>Profit Breakdown</Text>
                {[
                  { label: 'Revenue', value: fmt(data?.totalRevenue), color: colors.text },
                  { label: 'Cost of Goods', value: `-${fmt(data?.totalCost)}`, color: colors.danger },
                  { label: 'GROSS PROFIT', value: fmt(data?.totalProfit), color: colors.success, bold: true },
                ].map((row, index) => (
                  <View key={index} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: colors.border }}>
                    <Text style={{ fontSize: 13, color: colors.textLight, fontWeight: row.bold ? '700' : '400' }}>{row.label}</Text>
                    <Text style={{ fontSize: row.bold ? 17 : 14, fontWeight: '700', color: row.color }}>{row.value}</Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 }}>Last 7 Days</Text>
            <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', height: 110, alignItems: 'flex-end', gap: 4 }}>
                {salesByDay.map((day, index) => (
                  <View key={index} style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 9, color: colors.textLight, marginBottom: 2 }}>{day.count}</Text>
                    <View style={{ flex: 1, width: '85%', justifyContent: 'flex-end' }}>
                      <View style={{ width: '100%', borderRadius: 4, minHeight: 4, backgroundColor: colors.secondary, height: `${Math.max((day.revenue / maxRevenue) * 100, 4)}%` }} />
                    </View>
                    <Text style={{ fontSize: 9, color: colors.textLight, marginTop: 4 }}>{day.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 }}>Fast Movers</Text>
            {fastMovers.length === 0 ? (
              <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 28, alignItems: 'center', marginBottom: 14 }}>
                <Text style={{ color: colors.textLight }}>No fast-moving items identified for {PERIOD_LABELS[period] || period} yet</Text>
              </View>
            ) : fastMovers.map((product) => {
              const statusColor = product.status === 'Restock Soon'
                ? colors.danger
                : product.status === 'Watch Stock'
                  ? colors.warning
                  : colors.success;

              return (
                <View key={product.id} style={{ backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.secondary + '18', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: colors.secondary }}>#{product.rank}</Text>
                        </View>
                        <Text style={{ flex: 1, fontSize: 14, fontWeight: '800', color: colors.text }}>{cleanText(product.name || '')}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.textLight }}>
                        {product.qty} sold across {product.salesCount} sale{product.salesCount === 1 ? '' : 's'} in {PERIOD_LABELS[period] || period}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: statusColor + '18', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: statusColor }}>{product.status}</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                    {[
                      { label: 'Revenue', value: fmt(product.revenue), color: colors.secondary },
                      { label: 'Profit', value: hasPermission('view_profits') ? fmt(product.profit) : 'Hidden', color: hasPermission('view_profits') ? colors.success : colors.textLight },
                      { label: 'Daily Pace', value: `${product.dailyVelocity.toFixed(1)}/${product.unit}`, color: colors.warning },
                      {
                        label: 'Stock Cover',
                        value: product.coverDays !== null ? `${product.coverDays.toFixed(1)} days` : 'n/a',
                        color: statusColor,
                      },
                    ].filter((metric) => metric.label !== 'Profit' || hasPermission('view_profits')).map((metric) => (
                      <View key={metric.label} style={{ flex: 1, minWidth: '45%', backgroundColor: colors.bg, borderRadius: 12, padding: 12 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textLight, marginBottom: 4 }}>{metric.label}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: metric.color }}>{metric.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}

            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 }}>Top Products</Text>
            {topProducts.length === 0 ? (
              <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 28, alignItems: 'center' }}>
                <Text style={{ color: colors.textLight }}>No sales data yet</Text>
              </View>
            ) : topProducts.map((product, index) => (
              <View key={index} style={{ backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.secondary + '20', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.secondary }}>#{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{cleanText(product.name || '')}</Text>
                  <Text style={{ fontSize: 11, color: colors.textLight }}>{product.qty} sold</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{fmt(product.revenue)}</Text>
                  {hasPermission('view_profits') ? <Text style={{ fontSize: 11, color: colors.success }}>+{fmt(product.profit)}</Text> : null}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={itemModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '80%', paddingBottom: 24 + insets.bottom }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>Item Report</Text>
              <TouchableOpacity onPress={() => { setItemModal(false); setItemResult(null); setItemSearch(''); }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <TextInput
                style={{ flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 14, color: colors.text, backgroundColor: colors.inputBg }}
                placeholder="Search product name..."
                value={itemSearch}
                onChangeText={(text) => setItemSearch(text)}
                placeholderTextColor={colors.textLight}
              />
              <TouchableOpacity style={{ backgroundColor: colors.secondary, borderRadius: 12, width: 46, alignItems: 'center', justifyContent: 'center' }} onPress={() => searchItem(itemSearch)}>
                {searchingItem ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={20} color="#fff" />}
              </TouchableOpacity>
            </View>

            {itemSuggestions.length > 0 && (
              <View style={{ backgroundColor: colors.inputBg, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: colors.border }}>
                {itemSuggestions.map((suggestion) => (
                  <TouchableOpacity key={suggestion.id} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border }} onPress={() => { setItemSearch(suggestion.name); searchItem(suggestion.name); }}>
                    <Text style={{ color: colors.text, fontSize: 14 }}>{cleanText(suggestion.name || '')}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <ScrollView>
              {itemResult ? (
                itemResult.notFound ? (
                  <View style={{ alignItems: 'center', padding: 32 }}>
                    <Ionicons name="search-outline" size={48} color={colors.textLight} />
                    <Text style={{ color: colors.textLight, marginTop: 10, fontSize: 15 }}>No sales found for "{itemResult.name}"</Text>
                    <Text style={{ color: colors.textLight, fontSize: 12, marginTop: 4 }}>in the selected period ({period})</Text>
                  </View>
                ) : (
                  <>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 12 }}>{itemResult.name}</Text>
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                      {[
                        { label: 'Units Sold', value: itemResult.totalQty, color: colors.secondary },
                        { label: 'Revenue', value: fmt(itemResult.totalRev), color: colors.warning },
                        hasPermission('view_profits') && { label: 'Profit', value: fmt(itemResult.totalProfit), color: colors.success },
                      ].filter(Boolean).map((metric, index) => (
                        <View key={index} style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 12, padding: 12, alignItems: 'center' }}>
                          <Text style={{ fontSize: 16, fontWeight: '800', color: metric.color }}>{metric.value}</Text>
                          <Text style={{ fontSize: 10, color: colors.textLight, marginTop: 2 }}>{metric.label}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4 }}>{itemResult.salesCount} sale(s) matched</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 8 }}>Recent Transactions</Text>
                    {itemResult.items.map((item, index) => (
                      <View key={index} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <View>
                          <Text style={{ fontSize: 12, color: colors.text }}>x{item.quantity}</Text>
                          <Text style={{ fontSize: 10, color: colors.textLight }}>{new Date(item.sales?.created_at).toLocaleDateString()}</Text>
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>{fmt(item.total_price)}</Text>
                      </View>
                    ))}
                  </>
                )
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
