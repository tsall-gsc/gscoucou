// Helpers for the page itself: finding elements, escaping text, messages and file downloads.

export const $ = s => document.querySelector(s);

// Every piece of database text that goes into HTML passes through esc() first.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let msgTimer;

// Shows the green or red message bar at the top of the page for a few seconds.
export function notify(text, isError = false) {
  const el = $('#msg');
  el.textContent = text;
  el.className = isError ? 'error' : '';
  el.hidden = false;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

// Turns a database error into a sentence a school secretary can act on.
export function friendly(error) {
  if (error.code === '23505') return 'That name already exists. Choose a different one.';
  if (error.code === '23503') return 'This item is still in use (by students, teachers or payments), so it can’t be deleted.';
  if (error.code === '42501') return 'Your role doesn’t allow this action.';
  if (['PGRST205', 'PGRST204', '42P01', '42703'].includes(error.code)) return 'The database is missing something this screen needs. Run the SQL files that came with the update (fees.sql, installments.sql, expenses.sql) in the Supabase SQL Editor, then reload.';
  return error.message || 'Something went wrong. Try again.';
}

// After a save: show the error, or confirm and redraw the screen.
export async function done(error, okText, rerender) {
  if (error) { notify(friendly(error), true); return; }
  notify(okText);
  await rerender();
}

// Downloads a table (array of rows) as a CSV file that opens correctly in Excel.
export function downloadCsv(name, table) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\ufeff' + table.map(l => l.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
