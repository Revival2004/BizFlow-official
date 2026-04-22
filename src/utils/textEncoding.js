const buildBadString = (...codes) => String.fromCharCode(...codes);

const MOJIBAKE_REPLACEMENTS = [
  [buildBadString(0x00c2), ''],
  [buildBadString(0x00e2, 0x20ac, 0x201d), '-'],
  [buildBadString(0x00e2, 0x20ac, 0x201c), '-'],
  [buildBadString(0x00e2, 0x20ac, 0x2122), "'"],
  [buildBadString(0x00e2, 0x20ac, 0x0153), '"'],
  [buildBadString(0x00e2, 0x20ac, 0x009d), '"'],
  [buildBadString(0x00e2, 0x20ac, 0x00a2), '*'],
  [buildBadString(0x00e2, 0x20ac, 0x00a6), '...'],
  [buildBadString(0x00e2, 0x2020, 0x2019), '->'],
  [buildBadString(0x00e2, 0x2020, 0x201c), '<-'],
  [buildBadString(0x00e2, 0x20ac, 0x00a0), ''],
];

export function cleanText(value) {
  if (typeof value !== 'string') {
    return value;
  }

  let cleaned = value;

  for (const [bad, good] of MOJIBAKE_REPLACEMENTS) {
    cleaned = cleaned.split(bad).join(good);
  }

  return cleaned.replace(/[ \t]{2,}/g, ' ').trim();
}

export function cleanObject(value) {
  if (typeof value === 'string') {
    return cleanText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => cleanObject(item));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, entryValue]) => {
      acc[key] = cleanObject(entryValue);
      return acc;
    }, {});
  }

  return value;
}

export function cleanRecords(records, textFields = []) {
  if (!Array.isArray(records)) {
    return records;
  }

  if (!textFields.length) {
    return cleanObject(records);
  }

  return records.map((record) => {
    if (!record || typeof record !== 'object') {
      return record;
    }

    const cleaned = { ...record };
    textFields.forEach((field) => {
      if (field in cleaned) {
        cleaned[field] = cleanObject(cleaned[field]);
      }
    });
    return cleaned;
  });
}

export default {
  cleanText,
  cleanObject,
  cleanRecords,
};
