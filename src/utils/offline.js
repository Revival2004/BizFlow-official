import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

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
        // Insert sale
        const { data: saleData, error } = await supabase
          .from('sales')
          .insert({ ...entry.sale, business_id: businessId, sold_by: userId })
          .select()
          .single();

        if (error) { failed++; continue; }

        // Insert items
        const itemsWithSaleId = entry.items.map(i => ({ ...i, sale_id: saleData.id }));
        await supabase.from('sale_items').insert(itemsWithSaleId);

        // Update stock
        for (const item of entry.items) {
          const { data: prod } = await supabase
            .from('products')
            .select('quantity')
            .eq('id', item.product_id)
            .single();
          if (prod) {
            await supabase.from('products')
              .update({ quantity: Math.max(0, prod.quantity - item.quantity) })
              .eq('id', item.product_id);
          }
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
