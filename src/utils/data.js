import { supabase } from './supabase';

export const humanizeLabel = (value = '') =>
  String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

export const fetchProfileNameMap = async (ids = []) => {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', uniqueIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((acc, profile) => {
    acc[profile.id] = profile.full_name;
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
