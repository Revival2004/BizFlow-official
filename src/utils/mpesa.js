import { cleanText } from './textEncoding';

export const normalizeKenyanPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (digits.startsWith('254') && digits.length === 12) {
    return digits;
  }

  if (digits.startsWith('0') && digits.length === 10) {
    return `254${digits.slice(1)}`;
  }

  if (digits.startsWith('7') && digits.length === 9) {
    return `254${digits}`;
  }

  return '';
};

export const formatKenyanPhoneInput = (value) => cleanText(value || '').replace(/[^\d+]/g, '');

export const isValidKenyanPhone = (value) => normalizeKenyanPhone(value).length === 12;

export const maskSecret = (value, { keepStart = 3, keepEnd = 2 } = {}) => {
  const raw = cleanText(value || '');
  if (!raw) {
    return '';
  }

  if (raw.length <= keepStart + keepEnd) {
    return '*'.repeat(raw.length);
  }

  const start = raw.slice(0, keepStart);
  const end = raw.slice(-keepEnd);
  return `${start}${'*'.repeat(Math.max(raw.length - keepStart - keepEnd, 4))}${end}`;
};

export const mpesaEnvironmentLabel = (value) => (value === 'live' ? 'Live' : 'Sandbox');
export const mpesaTillTypeLabel = (value) => (value === 'till' ? 'Till' : 'Paybill');
