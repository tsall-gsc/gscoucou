// Expenses screen (admins only): add, edit and total what the school spends in a school year.

import { db } from '../core/db.js';
import { state } from '../core/state.js';
import { $, esc, notify, friendly, done, downloadCsv } from '../core/ui.js';
import { money, parseMoney, todayLocal, nullIfEmpty } from '../core/format.js';

const EXPENSE_CATEGORIES = ['Salaries', 'Rent', 'Electricity & water', 'Supplies', 'Maintenance', 'Transport', 'Events', 'Other'];

async function renderExpenses() {
  const yRes = await db.from('school_years').select('id, label, is_current').order('label', { ascending: false });
  if (yRes.error) return notify(friendly(yRes.error), true);
  const years = yRes.data;
  if (!years.length) {
    state.exp = null;
    $('#view').innerHTML = `<div style="display:grid;gap:1.25rem"><h2>Expenses</h2>
      <div class="empty">Add a school year first, in the School years section.</div></div>`;
    return;
  }
  const yearId = years.find(y => String(y.id) === String(state.expYear))?.id
    ?? years.find(y => y.is_current)?.id ?? years[0].id;
  state.expYear = yearId;
  const eRes = await db.from('expenses').select('*').eq('school_year_id', yearId)
    .order('spent_on', { ascending: false }).order('id', { ascending: false }).limit(5000);
  if (eRes.error) return notify(friendly(eRes.error), true);
  state.exp = { years, yearId, yearLabel: years.find(y => y.id === yearId).label, rows: eRes.data };
  drawExpenses();
}

function expSummaryHtml(rows) {
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  const by = {};
  rows.forEach(r => { by[r.category] = (by[r.category] || 0) + Number(r.amount); });
  const cats = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `<div class="stats">
      <div class="stat"><span class="label">Total spent</span><b>${money(total)} GNF</b><span class="meta">${rows.length} expense${rows.length === 1 ? '' : 's'}</span></div>
      ${cats.map(([c, v]) => `<div class="stat"><span class="label">${esc(c)}</span><b>${money(v)} GNF</b><span class="meta">${total ? Math.round(v / total * 100) : 0}% of spending</span></div>`).join('')}
    </div>`;
}

function drawExpenses() {
  const f = state.exp;
  if (!f) return;
  const { years, yearId, rows } = f;
  const yearPicker = `<label class="year-pick noprint">School year
    <select data-change="exp-year">
      ${years.map(y => `<option value="${y.id}" ${y.id === yearId ? 'selected' : ''}>${esc(y.label)}${y.is_current ? ' (current)' : ''}</option>`).join('')}
    </select></label>`;
  const suggestions = [...new Set([...EXPENSE_CATEGORIES, ...rows.map(r => r.category)])];
  const usedCats = [...new Set(rows.map(r => r.category))].sort((a, b) => a.localeCompare(b));

  const cell = (r, field, value, type, label, extra = '') =>
    `<input type="${type}" ${extra} data-table="expenses" data-field="${field}" data-id="${r.id}" data-orig="${esc(value)}" value="${field === 'amount' ? money(value) : esc(value)}" aria-label="${label}">`;
  const rowHtml = r => `<tr data-id="${r.id}" data-cat="${esc(r.category)}" data-amount="${Number(r.amount)}"
      data-q="${esc([r.category, r.description].filter(Boolean).join(' ').toLowerCase())}">
    <td data-label="Date">${cell(r, 'spent_on', r.spent_on ?? '', 'date', 'Date')}</td>
    <td data-label="Category">${cell(r, 'category', r.category ?? '', 'text', 'Category', 'list="exp-cats" autocomplete="off"')}</td>
    <td class="wide" data-label="Description">${cell(r, 'description', r.description ?? '', 'text', 'Description')}</td>
    <td data-label="Amount (GNF)">${cell(r, 'amount', Number(r.amount), 'text', 'Amount in GNF', 'inputmode="numeric"')}</td>
    <td class="tools-cell"><div class="tools"><span class="state" role="status"></span>
      <button class="btn small danger" type="button" data-action="del-expense" data-id="${r.id}">Delete</button></div></td></tr>`;

  const filterBar = rows.length ? `<div class="add noprint">
      <label>Search <input type="search" id="exp-q" placeholder="Category or description" value="${esc(state.expQuery)}"></label>
      <label>Category <select data-change="exp-filter">
        <option value="">All categories</option>
        ${usedCats.map(c => `<option value="${esc(c)}" ${c === state.expCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select></label>
      <span class="meta" id="exp-count" role="status"></span>
      <button class="btn small" type="button" data-action="export-expenses">Download as spreadsheet (CSV)</button>
    </div>` : '';

  $('#view').innerHTML = `<div style="display:grid;gap:1.25rem">
    <h2>Expenses</h2>
    <p class="lead">Record what the school spends. Click any field in the list to change it, and each change is saved as soon as you leave the field. Only admins can see this section.</p>
    ${yearPicker}
    <div id="exp-summary">${expSummaryHtml(rows)}</div>
    <datalist id="exp-cats">${suggestions.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
    <form class="add" data-form="expense-add">
      <label>Date <input type="date" name="spent_on" value="${todayLocal()}" required></label>
      <label>Category <input type="text" name="category" list="exp-cats" autocomplete="off" required></label>
      <label>Description <input type="text" name="description"></label>
      <label>Amount (GNF) <input type="text" inputmode="numeric" name="amount" required></label>
      <button class="btn primary" type="submit">Add expense</button>
    </form>
    ${filterBar}
    ${rows.length ? `<div class="table-wrap"><table class="grid" id="exp-table">
        <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount (GNF)</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`
      : '<div class="empty">No expenses recorded for this school year yet.</div>'}
  </div>`;
  applyExpenseFilter();
}

function applyExpenseFilter() {
  const cat = state.expCat;
  const q = state.expQuery.trim().toLowerCase();
  let shown = 0, total = 0, sum = 0;
  document.querySelectorAll('#exp-table tbody tr[data-q]').forEach(tr => {
    total++;
    const ok = (!cat || tr.dataset.cat === cat) && (!q || tr.dataset.q.includes(q));
    tr.hidden = !ok;
    if (ok) { shown++; sum += Number(tr.dataset.amount); }
  });
  const c = $('#exp-count');
  if (c) c.textContent = `${shown} of ${total} expenses · ${money(sum)} GNF`;
}

// Saves one cell of the expenses table as soon as the person leaves it.
async function saveExpenseCell(el) {
  const f = state.exp;
  const row = el.closest('tr');
  const r = f.rows.find(x => x.id === Number(el.dataset.id));
  const flag = row.querySelector('.state');
  const say = (text, cls) => { flag.textContent = text; flag.className = 'state ' + cls; };
  const field = el.dataset.field;
  const orig = el.dataset.orig;
  const restore = () => { el.value = field === 'amount' ? money(orig) : orig; };

  let change, shown;
  if (field === 'amount') {
    const n = parseMoney(el.value);
    if (Number.isNaN(n) || n <= 0) { restore(); say('Enter an amount above zero', 'bad'); return; }
    if (n === Number(orig)) { el.value = money(n); return; }
    change = { amount: n }; shown = String(n);
  } else {
    const value = el.value.trim();
    if (value === orig) { el.value = value; return; }
    if ((field === 'category' || field === 'spent_on') && !value) {
      restore(); say(field === 'category' ? 'Category can’t be empty' : 'Date can’t be empty', 'bad'); return;
    }
    change = { [field]: nullIfEmpty(value) }; shown = value;
  }

  say('Saving…', '');
  const res = await db.from('expenses').update(change).eq('id', r.id).select('id');
  const error = res.error || (res.data?.length ? null : { message: 'Your role doesn’t allow this change.' });
  if (error) { restore(); say('Not saved: ' + friendly(error), 'bad'); return; }

  Object.assign(r, change);
  el.dataset.orig = shown;
  el.value = field === 'amount' ? money(shown) : shown;
  row.dataset.cat = r.category;
  row.dataset.amount = Number(r.amount);
  row.dataset.q = [r.category, r.description].filter(Boolean).join(' ').toLowerCase();
  $('#exp-summary').innerHTML = expSummaryHtml(f.rows);
  applyExpenseFilter();
  say('Saved ✓', 'ok');
  setTimeout(() => { if (flag.textContent === 'Saved ✓') say('', ''); }, 2500);
}

// What main.js plugs into the page for this screen:
//   render  draws the screen            forms    handlers for <form data-form="...">
//   actions handlers for data-action    changes  handlers for data-change (selects)
//   inputs  handlers for typing         cells    saves for table cells (data-table="...")
export const screen = {
  id: 'expenses', group: 'Money', label: 'Expenses', render: renderExpenses, admin: true,
  forms: {
    async 'expense-add'(f) {
      const amount = parseMoney(f.amount);
      if (Number.isNaN(amount) || amount <= 0) return notify('Enter an amount above zero, in whole GNF.', true);
      const { error } = await db.from('expenses').insert({
        school_year_id: state.expYear, category: f.category.trim(),
        description: nullIfEmpty((f.description || '').trim()), amount, spent_on: f.spent_on,
      });
      return done(error, 'Expense added.', renderExpenses);
    },
  },
  actions: {
    async 'del-expense'(b) {
      if (!confirm('Delete this expense? This can’t be undone.')) return;
      const { error } = await db.from('expenses').delete().eq('id', b.dataset.id);
      return done(error, 'Expense deleted.', renderExpenses);
    },
    'export-expenses'() {
      const f = state.exp;
      if (!f) return;
      downloadCsv(`expenses-${f.yearLabel}.csv`, [['Date', 'Category', 'Description', 'Amount (GNF)'],
        ...f.rows.map(r => [r.spent_on, r.category, r.description, Number(r.amount)])]);
    },
  },
  changes: {
  'exp-year': el => { state.expYear = el.value; return renderExpenses(); },
  'exp-filter': el => { state.expCat = el.value; applyExpenseFilter(); },
  },
  inputs: {
  'exp-q': el => { state.expQuery = el.value; applyExpenseFilter(); },
  },
  cells: { expenses: saveExpenseCell },
};
