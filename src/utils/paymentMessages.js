const cleanSpaces = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const normalizeKenyanPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');

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

const titleCase = (value) => cleanSpaces(value)
  .toLowerCase()
  .replace(/\b\w/g, (match) => match.toUpperCase());

const REFERENCE_PATTERNS = [
  /\bref(?:erence)?[:\s#-]*([A-Z0-9-]{6,20})\b/i,
  /\b(?:transaction|txn|trans(?:action)?)\s*(?:id|code|ref)?[:\s#-]*([A-Z0-9-]{6,20})\b/i,
  /\b([A-Z0-9]{10,12})\s+confirmed\b/i,
];

const NAME_PATTERNS = [
  /\b(?:sent to|paid to|transferred to)\s+([A-Z][A-Z\s'.-]{2,48}?)(?=\s+(?:0\d{9}|254\d{9}|on\b|for\b|ref\b|account\b|$))/i,
  /\b(?:received from|from)\s+([A-Z][A-Z\s'.-]{2,48}?)(?=\s+(?:0\d{9}|254\d{9}|on\b|for\b|ref\b|account\b|$))/i,
  /\b(?:name|customer|payer)[:\s-]+([A-Z][A-Z\s'.-]{2,48}?)(?=\s+(?:0\d{9}|254\d{9}|on\b|for\b|ref\b|account\b|$))/i,
];

export const parsePaymentMessage = (message) => {
  const raw = cleanSpaces(message);
  if (!raw) {
    return {
      raw: '',
      payerName: '',
      paymentReference: '',
      customerPhone: '',
    };
  }

  const paymentReference = REFERENCE_PATTERNS
    .map((pattern) => raw.match(pattern)?.[1] || '')
    .find(Boolean) || '';

  const payerName = NAME_PATTERNS
    .map((pattern) => raw.match(pattern)?.[1] || '')
    .find(Boolean);

  const phoneMatch = raw.match(/\b(?:254|0)?7\d{8}\b/);
  const customerPhone = normalizeKenyanPhone(phoneMatch?.[0] || '');

  return {
    raw,
    payerName: payerName ? titleCase(payerName) : '',
    paymentReference: cleanSpaces(paymentReference).toUpperCase(),
    customerPhone,
  };
};

export const describePaymentEvidence = ({ paymentReference, payerName } = {}) => {
  const parts = [];

  if (paymentReference) {
    parts.push(`Ref ${paymentReference}`);
  }

  if (payerName) {
    parts.push(`Payer ${payerName}`);
  }

  return parts.join(' | ');
};
