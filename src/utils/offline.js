import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { cleanText } from './textEncoding';

const QUEUE_KEY = 'offline_queue';
const OFFLINE_SALES_KEY = 'offline_sales';

// Save a pending action to queue
export const queueAction = async (action) => {
  try {
    const existing = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = existing ? JSON.parse(existing) : [];
    queue.push({ ...action, timestamp: Date.now(), id: Math.random().toString(36).slice(2) });
    // Keep max 3 days of data (prune older than 3 days)
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const pruned = queue.filter(a => a.timestamp > threeDaysAgo);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(pruned));
  } catch (e) {
    console.error('Queue error:', e);
  }
};

// Save sale locally when offline
export const saveOfflineSale = async (saleData, items) => {
  try {
    const existing = await AsyncStorage.getItem(OFFLINE_SALES_KEY);
    const sales = existing ? JSON.parse(existing) : [];
    sales.push({
      sale: saleData,
      items,
      savedAt: Date.now(),
      synced: false,
    });
    await AsyncStorage.setItem(OFFLINE_SALES_KEY, JSON.stringify(sales));
    return true;
  } catch (e) {
    console.error('Offline save error:', e);
    return false;
  }
};

// Get all offline sales
export const getOfflineSales = async () => {
  try {
    const data = await AsyncStorage.getItem(OFFLINE_SALES_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

// Get pending queue count
export const getPendingCount = async () => {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = data ? JSON.parse(data) : [];
    return queue.filter(a => !a.synced).length;
  } catch {
    return 0;
  }
};

// Sync all offline sales to Supabase
export const syncOfflineData = async (businessId, userId) => {
  try {
    const data = await AsyncStorage.getItem(OFFLINE_SALES_KEY);
    if (!data) return { synced: 0, failed: 0 };

    const sales = JSON.parse(data);
    const unsynced = sales.filter(s => !s.synced);
    let synced = 0;
    let failed = 0;

    for (const entry of unsynced) {
      try {
        const sale = entry.sale || {};
        const items = Array.isArray(entry.items) ? entry.items : [];

        if (!sale.reference_number || items.length === 0) {
          failed++;
          continue;
        }

        const { data: result, error } = await supabase.rpc('process_sale', {
          p_business_id: businessId,
          p_reference_number: sale.reference_number,
          p_sold_by: userId,
          p_customer_name: cleanText(sale.customer_name || '') || null,
          p_customer_phone: sale.customer_phone || null,
          p_total_amount: Number(sale.total_amount || 0),
          p_cost_total: Number(sale.cost_total || 0),
          p_profit: Number(sale.profit || 0),
          p_payment_method: sale.payment_method || 'cash',
          p_amount_tendered: Number(sale.amount_tendered ?? sale.total_amount ?? 0),
          p_change_given: Number(sale.change_given || 0),
          p_notes: sale.notes || null,
          p_items: items.map((item) => ({
            product_id: item.product_id,
            product_name: cleanText(item.product_name || item.name || ''),
            quantity: Number(item.quantity || item.qty || 0),
            unit_price: Number(item.unit_price || item.selling_price || 0),
            cost_price: Number(item.cost_price || 0),
            total_price: Number(item.total_price || 0),
            profit: Number(item.profit || 0),
            discount: Number(item.discount || 0),
          })),
        });

        if (error || !result?.success) {
          failed++;
          continue;
        }

        entry.synced = true;
        synced++;
      } catch {
        failed++;
      }
    }

    // Save updated sales list (keep 3 days)
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const pruned = sales.filter(s => s.savedAt > threeDaysAgo);
    await AsyncStorage.setItem(OFFLINE_SALES_KEY, JSON.stringify(pruned));

    return { synced, failed };
  } catch (e) {
    console.error('Sync error:', e);
    return { synced: 0, failed: 0 };
  }
};

// Cache products for offline use
export const cacheProducts = async (products) => {
  await AsyncStorage.setItem('cached_products', JSON.stringify({ data: products, cachedAt: Date.now() }));
};

// Get cached products
export const getCachedProducts = async () => {
  try {
    const data = await AsyncStorage.getItem('cached_products');
    if (!data) return null;
    const parsed = JSON.parse(data);
    // Valid for 3 days
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    if (Date.now() - parsed.cachedAt > threeDays) return null;
    return parsed.data;
  } catch {
    return null;
  }
};
