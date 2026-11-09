// Fees screen: one row per student with a payment cell per term instalment. The balance is calculated, never typed.

import { db } from '../core/db.js';
import { state, isAdmin } from '../core/state.js';
import { $, esc, notify, friendly, done, downloadCsv } from '../core/ui.js';
import { money, parseMoney, todayLocal, nullIfEmpty } from '../core/format.js';

const METHODS = ['Cash', 'Bank transfer', 'Mobile money'];
const shortTerm = t => t.name.split(' (')[0];

async function renderFees() {
  const yRes = await db.from('school_years').select('id, label, is_current').order('label', { ascending: false });
  if (yRes.error) return notify(friendly(yRes.error), true);
  const years = yRes.data;
  if (!years.length) {
    state.fee = null;
    $('#view').innerHTML = `<div style="display:grid;gap:1.25rem"><h2>Fees</h2>
      <div class="empty">Add a school year first, in the School years section.</div></div>`;
    return;
  }
  const yearId = years.find(y => String(y.id) === String(state.feeYear))?.id
    ?? years.find(y => y.is_current)?.id ?? years[0].id;
  state.feeYear = yearId;

  const [tRes, eRes, gRes] = await Promise.all([
    db.from('fee_terms').select('*').eq('school_year_id', yearId).order('sort_order').order('id'),
    db.from('enrollments')
      .select('id, grade_id, grades(name), students(id, full_name, active), payments(id, term_id, amount, paid_on, method, note)')
      .eq('school_year_id', yearId).limit(5000),
    db.from('grades').select('id, name').order('sort_order').order('name'),
  ]);
  const err = tRes.error || eRes.error || gRes.error;
  if (err) return notify(friendly(err), true);

  const terms = tRes.data;
  const due = terms.reduce((a, t) => a + Number(t.amount), 0);
  const rows = eRes.data
    .filter(e => e.students)
    .map(e => {
      const pays = (e.payments || []).slice().sort((a, b) => (a.paid_on < b.paid_on ? 1 : a.paid_on > b.paid_on ? -1 : b.id - a.id));
      const paidBy = {};
      pays.forEach(p => { paidBy[p.term_id] = (paidBy[p.term_id] || 0) + Number(p.amount); });
      const paid = pays.reduce((a, p) => a + Number(p.amount), 0);
      return { e, s: e.students, g: e.grades?.name || '', pays, paidBy, paid, balance: due - paid };
    })
    .sort((a, b) => a.s.full_name.localeCompare(b.s.full_name));

  state.fee = { years, yearId, yearLabel: years.find(y => y.id === yearId).label, terms, grades: gRes.data, rows, due };
  drawFees();
}

const balText = r => r.balance > 0 ? 'Owes ' + money(r.balance) : r.balance < 0 ? 'Overpaid ' + money(-r.balance) : 'Paid up';
const payClass = (paid, t) => paid >= Number(t.amount) ? 'ok' : paid > 0 ? 'part' : 'none';

function recalcFeeRow(r, due) {
  r.paidBy = {};
  r.pays.forEach(p => { r.paidBy[p.term_id] = (r.paidBy[p.term_id] || 0) + Number(p.amount); });
  r.paid = r.pays.reduce((a, p) => a + Number(p.amount), 0);
  r.balance = due - r.paid;
}

function feeStatsHtml(f) {
  const { terms, rows, due } = f;
  const expected = due * rows.length;
  const collected = rows.reduce((a, r) => a + r.paid, 0);
  const owingCount = rows.filter(r => r.balance > 0).length;
  const pct = expected ? Math.round(collected / expected * 100) : 0;
  return `<div class="stats">
      <div class="stat"><span class="label">Collected</span><b>${money(collected)} GNF</b><span class="meta">of ${money(expected)} GNF (${pct}%)</span></div>
      <div class="stat"><span class="label">Still to collect</span><b>${money(Math.max(expected - collected, 0))} GNF</b><span class="meta">${owingCount} of ${rows.length} students owe</span></div>
      ${terms.map(t => {
        const got = rows.reduce((a, r) => a + (r.paidBy[t.id] || 0), 0);
        return `<div class="stat"><span class="label">${esc(t.name)}</span><b>${money(got)} GNF</b><span class="meta">of ${money(Number(t.amount) * rows.length)} · ${money(t.amount)} each</span></div>`;
      }).join('')}
    </div>`;
}

// The payments of one student for one term, oldest first. Payment 1, 2, 3 in the table follow this order.
const termPaysOf = (r, t) => r.pays.filter(p => p.term_id === t.id)
  .sort((a, b) => (a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : a.id - b.id));

// How many payment columns each term gets: the number allowed, or more if a student already has more.
function slotCountsOf(f) {
  const out = {};
  f.terms.forEach(t => {
    out[t.id] = f.rows.reduce((m, r) => Math.max(m, termPaysOf(r, t).length), Math.max(Number(t.installments) || 1, 1));
  });
  return out;
}

// The payment cells of one term for one student: an amount box when it can be changed, plain text otherwise.
function payCellsHtml(r, t, slots) {
  const tp = termPaysOf(r, t);
  const paid = r.paidBy[t.id] || 0;
  let html = '';
  for (let i = 0; i < slots; i++) {
    const p = tp[i];
    const cls = `pay ${payClass(paid, t)}${i === 0 ? ' termstart' : ''}`;
    const label = `${esc(shortTerm(t))}${slots > 1 ? ' payment ' + (i + 1) : ''} — ${esc(r.s.full_name)}`;
    const lab = esc(shortTerm(t).replace('Quarter ', 'Q')) + ' PYMT' + (slots > 1 ? ' ' + (i + 1) : '');
    if (p && !isAdmin()) {
      html += `<td class="${cls}" data-termcell="${t.id}" data-label="${lab}"><span class="ro">${money(p.amount)}</span></td>`;
    } else if (p || i === tp.length) {
      html += `<td class="${cls}" data-termcell="${t.id}" data-label="${lab}"><input type="text" inputmode="numeric" data-table="fees" data-field="pay" data-term="${t.id}"
        data-payment="${p ? p.id : ''}" data-orig="${p ? Number(p.amount) : 0}" value="${p ? money(p.amount) : ''}" placeholder="0" aria-label="${label}"></td>`;
    } else {
      html += `<td class="${cls}" data-termcell="${t.id}" data-label="${lab}"><span class="ro muted" title="Fill the payment before it first">—</span></td>`;
    }
  }
  return html;
}

function panelHtml(r, terms) {
  const firstOpenTerm = terms.find(t => Number(t.amount) - (r.paidBy[t.id] || 0) > 0) || terms[0];
  const defaultLeft = Math.max(Number(firstOpenTerm.amount) - (r.paidBy[firstOpenTerm.id] || 0), 0);
  const termName = id => esc(terms.find(t => t.id === id)?.name || 'No term');
  return `<div class="panel">
    <div>${r.pays.length ? r.pays.map(p => `<div class="pitem">
        <span class="amt">${money(p.amount)} GNF</span>
        <span>${termName(p.term_id)}</span>
        <span class="meta">${esc(p.paid_on)}${p.method ? ' · ' + esc(p.method) : ''}${p.note ? ' · ' + esc(p.note) : ''}</span>
        ${isAdmin() ? `<span class="actions"><button class="btn small danger" type="button" data-action="del-payment" data-id="${p.id}">Delete</button></span>` : ''}
      </div>`).join('') : '<p class="meta">No payments yet.</p>'}</div>
    <form data-form="pay-add" data-id="${r.e.id}">
      <label>Term <select name="term_id" data-change="pay-term" required>
        ${terms.map(t => { const left = Math.max(Number(t.amount) - (r.paidBy[t.id] || 0), 0);
          return `<option value="${t.id}" data-remaining="${left}" ${t.id === firstOpenTerm.id ? 'selected' : ''}>${esc(t.name)} — ${left > 0 ? money(left) + ' left' : 'paid'}</option>`; }).join('')}
      </select></label>
      <label>Amount (GNF) <input type="number" name="amount" min="1" step="1" value="${defaultLeft || ''}" required></label>
      <label>Date <input type="date" name="paid_on" value="${todayLocal()}" required></label>
      <label>Method <select name="method">${METHODS.map(m => `<option>${m}</option>`).join('')}</select></label>
      <label>Note <input type="text" name="note" placeholder="Optional"></label>
      <button class="btn primary small" type="submit">Record payment</button>
    </form></div>`;
}

function drawFees() {
  const f = state.fee;
  if (!f) return;
  const { years, yearId, terms, grades, rows } = f;

  const yearPicker = `<label class="year-pick">School year
    <select data-change="fee-year">
      ${years.map(y => `<option value="${y.id}" ${y.id === yearId ? 'selected' : ''}>${esc(y.label)}${y.is_current ? ' (current)' : ''}</option>`).join('')}
    </select></label>`;
  const head = `<h2>Fees</h2>
    <p class="lead">Type each payment a family makes in the term columns. A term can be paid in several instalments, filled in order. The balance is calculated for you and can’t be typed over. “Details” shows every payment with its date and method. ${isAdmin()
      ? 'As an admin you can also change or remove a payment.'
      : 'You can record new payments. An admin can correct existing ones.'}</p>${yearPicker}`;

  if (!terms.length) {
    $('#view').innerHTML = `<div style="display:grid;gap:1.25rem">${head}
      <div class="empty">No fee terms are set up for this school year.
      ${isAdmin() ? `<p style="margin-top:.75rem"><button class="btn primary" type="button" data-action="make-terms" data-year="${yearId}">Create the 3 standard terms</button></p>
        <p class="meta" style="margin-top:.5rem">Quarter 1 (Oct–Dec) 800,000 GNF in up to 3 payments · Quarter 2 (Jan–Mar) 350,000 GNF in up to 3 payments · Quarter 3 (Apr–Jun) 50,000 GNF</p>`
        : '<p style="margin-top:.5rem">An admin needs to set them up.</p>'}</div></div>`;
    return;
  }

  const slots = slotCountsOf(f);
  f.slots = slots;
  const totalSlots = terms.reduce((a, t) => a + slots[t.id], 0);

  const termEditor = isAdmin() ? `<details class="termbox"><summary>Change fee amounts</summary>
      <form data-form="terms-save" class="add">
        ${terms.map(t => `<label>Term name <input type="text" name="name_${t.id}" value="${esc(t.name)}" required></label>
          <label>Amount (GNF) <input type="number" name="amount_${t.id}" min="0" step="1" value="${Number(t.amount)}" required></label>
          ${t.installments !== undefined ? `<label>Payments allowed <input type="number" name="inst_${t.id}" min="1" max="6" step="1" value="${Number(t.installments) || 1}" required></label>` : ''}`).join('')}
        <button class="btn primary" type="submit">Save</button>
        <p class="meta" style="flex-basis:100%">Changing an amount changes what every student owes for that term. “Payments allowed” is how many payment columns the term has in the table.</p>
      </form></details>` : '';

  const rowHtml = r => {
    const isOpen = state.openFee === r.e.id;
    const q = [r.s.full_name, r.g].join(' ').toLowerCase();
    const gradeCell = `<select data-table="fees" data-field="grade" data-orig="${r.e.grade_id ?? ''}" aria-label="Grade — ${esc(r.s.full_name)}">
        ${r.e.grade_id ? '' : '<option value="">Choose grade…</option>'}
        ${grades.map(g => `<option value="${g.id}" ${g.id === r.e.grade_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
      </select>`;
    const main = `<tr data-enr="${r.e.id}" data-grade="${r.e.grade_id ?? ''}" data-status="${r.balance > 0 ? 'owing' : 'paid'}"
        data-owed="${Math.max(r.balance, 0)}" data-q="${esc(q)}">
      <td class="col-name wide" data-label="Full name"><input type="text" data-table="fees" data-field="full_name" data-orig="${esc(r.s.full_name)}" value="${esc(r.s.full_name)}" aria-label="Full name — ${esc(r.s.full_name)}" required></td>
      <td class="wide" data-label="Grade">${gradeCell}</td>
      ${terms.map(t => payCellsHtml(r, t, slots[t.id])).join('')}
      <td class="wide" data-label="Balance"><span class="bal ${r.balance > 0 ? 'owe' : ''}">${balText(r)}</span></td>
      <td class="tools-cell"><div class="tools"><span class="state" role="status"></span>
        <button class="btn small" type="button" data-action="open-fee" data-id="${r.e.id}">${isOpen ? 'Close' : 'Details'}</button></div></td></tr>`;
    const detail = isOpen ? `<tr class="detail"><td colspan="${4 + totalSlots}">${panelHtml(r, terms)}</td></tr>` : '';
    return main + detail;
  };

  const filterBar = rows.length ? `<div class="add">
      <label>Search <input type="search" id="fee-q" placeholder="Student name" value="${esc(state.feeQuery)}"></label>
      <label>Grade <select data-change="fee-filter" data-key="feeGrade">
        <option value="">All grades</option>
        ${grades.map(g => `<option value="${g.id}" ${String(g.id) === state.feeGrade ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
      </select></label>
      <label>Status <select data-change="fee-filter" data-key="feeStatus">
        <option value="">Everyone</option>
        <option value="owing" ${state.feeStatus === 'owing' ? 'selected' : ''}>Still owing</option>
        <option value="paid" ${state.feeStatus === 'paid' ? 'selected' : ''}>Paid up</option>
      </select></label>
      <span class="meta" id="fee-count" role="status"></span>
      ${isAdmin() ? '<button class="btn small" type="button" data-action="export-fees">Download as spreadsheet (CSV)</button>' : ''}
    </div>` : '';

  const groupHead = terms.map(t => `<th colspan="${slots[t.id]}" class="termgroup">${esc(shortTerm(t))}<small class="meta">fee ${money(t.amount)}</small></th>`).join('');
  const slotHead = terms.map(t => Array.from({ length: slots[t.id] },
    (_, i) => `<th class="termh${i === 0 ? ' termstart' : ''}" title="${slots[t.id] > 1 ? 'Payment ' + (i + 1) : 'Payment'}">${slots[t.id] > 1 ? 'PYMT ' + (i + 1) : 'PYMT'}</th>`).join('')).join('');

  const table = rows.length ? `<div class="table-wrap"><table class="grid" id="fee-table" style="--fee-min:${37 + totalSlots * 7.5}rem">
      <thead>
        <tr><th rowspan="2" class="col-name">Full name</th><th rowspan="2" class="col-grade">Grade</th>${groupHead}<th rowspan="2" class="col-bal">Balance<small class="meta">calculated</small></th><th rowspan="2" class="col-tools"><span class="sr-only">Actions</span></th></tr>
        <tr>${slotHead}</tr>
      </thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`
    : '<div class="empty">No students are enrolled for this school year yet.</div>';

  $('#view').innerHTML = `<div style="display:grid;gap:1.25rem">${head}
    <div id="fee-stats">${feeStatsHtml(f)}</div>${termEditor}${filterBar}${table}</div>`;
  applyFeeFilter();
  if (state.openFee) $('#fee-table tr[data-enr="' + state.openFee + '"]')?.scrollIntoView({ block: 'nearest' });
}

// Saves one cell of the fees table as soon as the person leaves it.
async function saveFeeCell(el) {
  const f = state.fee;
  const rowEl = el.closest('tr');
  const r = f.rows.find(x => x.e.id === Number(rowEl.dataset.enr));
  const flag = rowEl.querySelector('.state');
  const say = (text, cls) => { flag.textContent = text; flag.className = 'state ' + cls; };
  const field = el.dataset.field;
  const orig = el.dataset.orig;

  const refreshRow = () => {
    rowEl.dataset.grade = r.e.grade_id ?? '';
    rowEl.dataset.q = [r.s.full_name, r.g].join(' ').toLowerCase();
    rowEl.dataset.status = r.balance > 0 ? 'owing' : 'paid';
    rowEl.dataset.owed = Math.max(r.balance, 0);
    const bal = rowEl.querySelector('.bal');
    bal.textContent = balText(r);
    bal.className = 'bal ' + (r.balance > 0 ? 'owe' : '');
    $('#fee-stats').innerHTML = feeStatsHtml(f);
    applyFeeFilter();
  };
  const done = () => {
    say('Saved ✓', 'ok');
    setTimeout(() => { if (flag.textContent === 'Saved ✓') say('', ''); }, 2500);
  };

  if (field === 'full_name') {
    const value = el.value.trim();
    if (value === orig) { el.value = value; return; }
    if (!value) { el.value = orig; say('Name can’t be empty', 'bad'); return; }
    say('Saving…', '');
    const res = await db.from('students').update({ full_name: value }).eq('id', r.s.id).select('id');
    const error = res.error || (res.data?.length ? null : { message: 'Your role doesn’t allow this change.' });
    if (error) { el.value = orig; say('Not saved: ' + friendly(error), 'bad'); return; }
    r.s.full_name = value; el.value = value; el.dataset.orig = value;
    refreshRow(); done(); return;
  }

  if (field === 'grade') {
    const value = el.value;
    if (!value || value === orig) return;
    say('Saving…', '');
    const res = await db.from('enrollments').update({ grade_id: Number(value) }).eq('id', r.e.id).select('id');
    const error = res.error || (res.data?.length ? null : { message: 'Your role doesn’t allow this change.' });
    if (error) { el.value = orig; say('Not saved: ' + friendly(error), 'bad'); return; }
    r.e.grade_id = Number(value);
    r.g = el.selectedOptions[0].textContent;
    el.dataset.orig = value;
    el.querySelector('option[value=""]')?.remove();
    refreshRow(); done(); return;
  }

  // field === 'pay': one payment of one term
  const term = f.terms.find(t => t.id === Number(el.dataset.term));
  const origN = Number(orig || 0);
  const showOrig = () => { el.value = origN ? money(origN) : ''; };
  const n = parseMoney(el.value);
  if (Number.isNaN(n)) { showOrig(); say('Enter a whole number', 'bad'); return; }
  if (n === origN) { showOrig(); return; }
  const after = (r.paidBy[term.id] || 0) - origN + n;
  if (after > Number(term.amount) &&
      !confirm(`With this payment, ${term.name} would reach ${money(after)} GNF, more than its fee of ${money(term.amount)} GNF. Record it anyway?`)) { showOrig(); return; }

  const paymentId = el.dataset.payment ? Number(el.dataset.payment) : null;
  say('Saving…', '');
  let res;
  if (!paymentId) {
    res = await db.from('payments')
      .insert({ enrollment_id: r.e.id, term_id: term.id, amount: n, paid_on: todayLocal() })
      .select('id, term_id, amount, paid_on, method, note');
  } else if (n === 0) {
    if (!isAdmin()) { showOrig(); say('Only an admin can remove a payment', 'bad'); return; }
    if (!confirm(`Remove the payment of ${money(origN)} GNF for ${term.name}?`)) { showOrig(); say('', ''); return; }
    res = await db.from('payments').delete().eq('id', paymentId).select('id');
  } else {
    res = await db.from('payments').update({ amount: n }).eq('id', paymentId)
      .select('id, term_id, amount, paid_on, method, note');
  }
  const error = res.error || (res.data?.length ? null : { message: 'Your role doesn’t allow this change.' });
  if (error) { showOrig(); say('Not saved: ' + friendly(error), 'bad'); return; }

  if (!paymentId) r.pays.unshift(res.data[0]);
  else if (n === 0) r.pays = r.pays.filter(p => p.id !== paymentId);
  else Object.assign(r.pays.find(p => p.id === paymentId), res.data[0]);
  recalcFeeRow(r, f.due);

  // Redraw this student's cells for the term (payments shift, the next box opens, the colour changes).
  const cells = rowEl.querySelectorAll(`td[data-termcell="${term.id}"]`);
  const html = payCellsHtml(r, term, f.slots[term.id]);
  for (let i = cells.length - 1; i > 0; i--) cells[i].remove();
  cells[0].outerHTML = html;
  refreshRow();
  done();
  if (state.openFee === r.e.id) drawFees();      // keep an open payment history up to date
}

function applyFeeFilter() {
  const g = state.feeGrade, st = state.feeStatus, q = state.feeQuery.trim().toLowerCase();
  let shown = 0, total = 0, owed = 0;
  document.querySelectorAll('#fee-table tbody tr[data-q]').forEach(li => {
    total++;
    const ok = (!g || li.dataset.grade === g) && (!st || li.dataset.status === st) && (!q || li.dataset.q.includes(q));
    li.hidden = !ok;
    if (ok) { shown++; owed += Number(li.dataset.owed); }
  });
  const c = $('#fee-count');
  if (c) c.textContent = `${shown} of ${total} students · ${money(owed)} GNF outstanding`;
}

// What main.js plugs into the page for this screen:
//   render  draws the screen            forms    handlers for <form data-form="...">
//   actions handlers for data-action    changes  handlers for data-change (selects)
//   inputs  handlers for typing         cells    saves for table cells (data-table="...")
export const screen = {
  id: 'fees', group: 'Money', label: 'Fees', render: renderFees,
  forms: {
    async 'pay-add'(f, id, form) {
      const amount = Number(f.amount);
      if (!(amount > 0)) return notify('Enter an amount greater than zero.', true);
      const left = Number(form.elements.term_id.selectedOptions[0]?.dataset.remaining ?? 0);
      if (amount > left && !confirm(`This is more than what is left for this term (${money(left)} GNF). Record it anyway?`)) return;
      const { error } = await db.from('payments').insert({
        enrollment_id: Number(id), term_id: Number(f.term_id), amount,
        paid_on: f.paid_on, method: nullIfEmpty(f.method), note: nullIfEmpty((f.note || '').trim()),
      });
      return done(error, 'Payment recorded.', renderFees);
    },
    async 'terms-save'(f) {
      const ids = Object.keys(f).map(k => k.match(/^amount_(\d+)$/)).filter(Boolean).map(m => m[1]);
      for (const id of ids) {
        const change = { name: f['name_' + id].trim(), amount: Number(f['amount_' + id]) };
        if (f['inst_' + id] !== undefined) change.installments = Math.min(6, Math.max(1, Number(f['inst_' + id]) || 1));
        const { error } = await db.from('fee_terms').update(change).eq('id', id);
        if (error) return notify(friendly(error), true);
      }
      return done(null, 'Fee terms updated.', renderFees);
    },
  },
  actions: {
    'open-fee'(b) {
      const id = Number(b.dataset.id);
      state.openFee = state.openFee === id ? null : id;
      drawFees();
    },
    async 'del-payment'(b) {
      if (!confirm('Delete this payment? This can’t be undone.')) return;
      const { error } = await db.from('payments').delete().eq('id', b.dataset.id);
      return done(error, 'Payment deleted.', renderFees);
    },
    async 'make-terms'(b) {
      const y = Number(b.dataset.year);
      const base = [
        { school_year_id: y, name: 'Quarter 1 (Oct–Dec)', amount: 800000, sort_order: 1, installments: 3 },
        { school_year_id: y, name: 'Quarter 2 (Jan–Mar)', amount: 350000, sort_order: 2, installments: 3 },
        { school_year_id: y, name: 'Quarter 3 (Apr–Jun)', amount: 50000, sort_order: 3, installments: 1 },
      ];
      let { error } = await db.from('fee_terms').insert(base);
      if (error && ['PGRST204', '42703'].includes(error.code)) {
        ({ error } = await db.from('fee_terms').insert(base.map(({ installments, ...t }) => t)));
      }
      return done(error, 'Fee terms created.', renderFees);
    },
    'export-fees'() {
      const f = state.fee;
      if (!f) return;
      downloadCsv(`fees-${f.yearLabel}.csv`, [
        ['Student', 'Grade', ...f.terms.map(t => t.name + ' paid'), 'Total due', 'Total paid', 'Balance'],
        ...f.rows.map(r => [r.s.full_name, r.g, ...f.terms.map(t => r.paidBy[t.id] || 0), f.due, r.paid, r.balance]),
      ]);
    },
  },
  changes: {
  'fee-year': el => { state.feeYear = el.value; state.openFee = null; return renderFees(); },
  'fee-filter': el => { state[el.dataset.key] = el.value; applyFeeFilter(); },
    'pay-term': el => {
      const amt = el.form?.elements.amount;
      const opt = el.selectedOptions[0];
      if (amt && opt) amt.value = Number(opt.dataset.remaining) > 0 ? opt.dataset.remaining : '';
    },
  },
  inputs: {
  'fee-q': el => { state.feeQuery = el.value; applyFeeFilter(); },
  },
  cells: { fees: saveFeeCell },
};
