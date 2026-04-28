import { supabase } from './supabase';

const profileNameCache = new Map();

export const humanizeLabel = (value = '') =>
  String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const fetchProfileNameMap = async (ids = []) => {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return {};
  }

  const missingIds = uniqueIds.filter((id) => !profileNameCache.has(id));

  if (missingIds.length > 0) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', missingIds);

    if (error) {
      throw error;
    }

    (data || []).forEach((profile) => {
      profileNameCache.set(profile.id, profile.full_name || 'Staff');
    });
  }

  return uniqueIds.reduce((acc, id) => {
    acc[id] = profileNameCache.get(id) || 'Staff';
    return acc;
  }, {});
};

export const attachSellerNames = async (sales = []) => {
  const nameMap = await fetchProfileNameMap(sales.map((sale) => sale.sold_by));

  return sales.map((sale) => ({
    ...sale,
    sellerName: nameMap[sale.sold_by] || 'Staff',
  }));
};
