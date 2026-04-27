import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { cleanText } from './textEncoding';

const QUEUE_KEY = 'offline_queue';
const OFFLINE_SALES_KEY = 'offline_sales';
const CACHE_PREFIX = 'offline_cache';
const PROFILE_CACHE_PREFIX = `${CACHE_PREFIX}:profile`;
const DASHBOARD_CACHE_PREFIX = `${CACHE_PREFIX}:dashboard`;
const STOCK_CACHE_PREFIX = `${CACHE_PREFIX}:stock`;
const REPORT_CACHE_PREFIX = `${CACHE_PREFIX}:report`;

const cacheKey = (prefix, suffix) => `${prefix}:${suffix}`;

const saveCachedValue = async (key, value) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({
      cachedAt: Date.now(),
      value,
    }));
    return true;
  } catch (error) {
    console.error('Cache save error:', error);
    return false;
  }
};

const readCachedValue = async (key, { maxAgeMs } = {}) => {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (maxAgeMs && parsed.cachedAt && Date.now() - parsed.cachedAt > maxAgeMs) {
      return null;
    }

    return parsed.value ?? null;
  } catch (error) {
    console.error('Cache read error:', error);
    return null;
  }
};

const removeCachedValue = async (key) => {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.error('Cache remove error:', error);
  }
};

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
          entry.lastError = cleanText(error?.message || result?.error || 'Sync failed');
          failed++;
          continue;
        }

        entry.synced = true;
        entry.syncedAt = Date.now();
        entry.lastError = null;
        synced++;
      } catch {
        entry.lastError = 'Sync failed';
        failed++;
      }
    }

    // Keep only unsynced items plus fresh synced history for support/debugging.
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const pruned = sales.filter((entry) => {
      if (!entry.savedAt || entry.savedAt <= threeDaysAgo) {
        return false;
      }

      if (!entry.synced) {
        return true;
      }

      return Date.now() - (entry.syncedAt || entry.savedAt) < 12 * 60 * 60 * 1000;
    });
    await AsyncStorage.setItem(OFFLINE_SALES_KEY, JSON.stringify(pruned));

    return { synced, failed };
  } catch (e) {
    console.error('Sync error:', e);
    return { synced: 0, failed: 0 };
  }
};

// Cache products for offline use
export const cacheProducts = async (products) => {
  await saveCachedValue('cached_products', products);
};

// Get cached products
export const getCachedProducts = async () => {
  return readCachedValue('cached_products', { maxAgeMs: 3 * 24 * 60 * 60 * 1000 });
};

export const cacheProfile = async (userId, profile) => {
  if (!userId || !profile) {
    return false;
  }

  return saveCachedValue(cacheKey(PROFILE_CACHE_PREFIX, userId), profile);
};

export const getCachedProfile = async (userId) => {
  if (!userId) {
    return null;
  }

  return readCachedValue(cacheKey(PROFILE_CACHE_PREFIX, userId), { maxAgeMs: 14 * 24 * 60 * 60 * 1000 });
};

export const clearCachedProfile = async (userId) => {
  if (!userId) {
    return;
  }

  await removeCachedValue(cacheKey(PROFILE_CACHE_PREFIX, userId));
};

export const cacheDashboardSnapshot = async (businessId, snapshot) => {
  if (!businessId || !snapshot) {
    return false;
  }

  return saveCachedValue(cacheKey(DASHBOARD_CACHE_PREFIX, businessId), snapshot);
};

export const getCachedDashboardSnapshot = async (businessId) => {
  if (!businessId) {
    return null;
  }

  return readCachedValue(cacheKey(DASHBOARD_CACHE_PREFIX, businessId), { maxAgeMs: 14 * 24 * 60 * 60 * 1000 });
};

export const cacheStockSnapshot = async (businessId, snapshot) => {
  if (!businessId || !snapshot) {
    return false;
  }

  return saveCachedValue(cacheKey(STOCK_CACHE_PREFIX, businessId), snapshot);
};

export const getCachedStockSnapshot = async (businessId) => {
  if (!businessId) {
    return null;
  }

  return readCachedValue(cacheKey(STOCK_CACHE_PREFIX, businessId), { maxAgeMs: 14 * 24 * 60 * 60 * 1000 });
};

export const cacheReportSnapshot = async (businessId, period, snapshot) => {
  if (!businessId || !period || !snapshot) {
    return false;
  }

  return saveCachedValue(cacheKey(REPORT_CACHE_PREFIX, `${businessId}:${period}`), snapshot);
};

export const getCachedReportSnapshot = async (businessId, period) => {
  if (!businessId || !period) {
    return null;
  }

  return readCachedValue(cacheKey(REPORT_CACHE_PREFIX, `${businessId}:${period}`), { maxAgeMs: 14 * 24 * 60 * 60 * 1000 });
};
