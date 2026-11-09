// Small formatting and parsing helpers shared by the screens.

// 1234567 -> "1,234,567" (GNF has no decimals)
export const money = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

// "1,234,567" or "1 234 567" -> 1234567. Empty -> 0. Anything that is not a whole number -> NaN.
export const parseMoney = v => {
  const t = String(v).replace(/[\s,\u00a0\u202f]/g, '');
  return t === '' ? 0 : (/^\d+$/.test(t) ? Number(t) : NaN);
};

// Today's date as YYYY-MM-DD in the visitor's own time zone.
export const todayLocal = () => new Date().toLocaleDateString('en-CA');

// '' or undefined -> null, so empty fields are stored as NULL in the database.
export const nullIfEmpty = v => (v === '' || v == null ? null : v);

// Full name of a teacher row.
export const tname = t => [t?.first_name, t?.last_name].filter(Boolean).join(' ');
