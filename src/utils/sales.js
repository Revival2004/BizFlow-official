import { supabase } from './supabase';

const LEGACY_PROCESS_SALE_KEYS = [
  'p_business_id',
  'p_reference_number',
  'p_sold_by',
  'p_customer_name',
  'p_customer_phone',
  'p_total_amount',
  'p_cost_total',
  'p_profit',
  'p_payment_method',
  'p_amount_tendered',
  'p_change_given',
  'p_notes',
  'p_items',
];

const canRetryLegacyProcessSale = (message) => /process_sale/i.test(String(message || '')) &&
  /(could not find the function|does not exist|schema cache)/i.test(String(message || ''));

export const invokeProcessSale = async (payload) => {
  const response = await supabase.rpc('process_sale', payload);

  if (!response.error || !canRetryLegacyProcessSale(response.error.message)) {
    return response;
  }

  const legacyPayload = LEGACY_PROCESS_SALE_KEYS.reduce((accumulator, key) => {
    accumulator[key] = payload[key];
    return accumulator;
  }, {});

  return supabase.rpc('process_sale', legacyPayload);
};
