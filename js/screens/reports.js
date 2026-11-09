// Reports screen (admins only): fees collected, spending, balances and call lists for one school year. The figures are worked out in buildReport().

import { db } from '../core/db.js';
import { state } from '../core/state.js';
import { $, esc, notify, friendly, downloadCsv } from '../core/ui.js';
import { money } from '../core/format.js';

const signedMoney = n => (n < 0 ? '−' : '') + money(Math.abs(n));
const pctOf = (a, b) => (b ? Math.round(a / b * 100) : 0) + '%';
const monthLabel = k => new Date(k + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

// Turns the raw records of one school year into the figures the reports show.
function buildReport(terms, enrollments, expenses, assigns, grades) {
  const due = terms.reduce((a, t) => a + Number(t.amount), 0);
  const people = enrollments.filter(e => e.students).map(e => {
    const pays = e.payments || [];
    const paid = pays.reduce((a, p) => a + Number(p.amount), 0);
    return {
      name: e.students.full_name, parent: e.students.guardian_name || '', phone: e.students.guardian_phone || '',
      grade: e.grades?.name || 'No grade', sort: e.grades?.sort_order ?? 999, pays, paid, owed: Math.max(due - paid, 0),
    };
  });

  const G = {};
  grades.forEach(g => { G[g.name] = { name: g.name, sort: g.sort_order, students: 0, collected: 0, owed: 0, teachers: [] }; });
  people.forEach(p => {
    const g = G[p.grade] || (G[p.grade] = { name: p.grade, sort: p.sort, students: 0, collected: 0, owed: 0, teachers: [] });
    g.students++; g.collected += p.paid; g.owed += p.owed;
  });
  const gradeName = Object.fromEntries(grades.map(g => [g.id, g.name]));
  assigns.forEach(a => {
    const g = G[gradeName[a.grade_id]];
    const nm = a.teachers ? [a.teachers.first_name, a.teachers.last_name].filter(Boolean).join(' ') : '';
    if (g && nm) g.teachers.push(nm);
  });
  const gradeRows = Object.values(G)
    .map(g => ({ ...g, expected: g.students * due }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  const termRows = terms.map(t => {
    const amount = Number(t.amount);
    let collected = 0, owed = 0;
    people.forEach(p => {
      const got = p.pays.filter(x => x.term_id === t.id).reduce((a, x) => a + Number(x.amount), 0);
      collected += got; owed += Math.max(amount - got, 0);
    });
    return { name: t.name, expected: amount * people.length, collected, owed };
  });

  const methods = {};
  people.forEach(p => p.pays.forEach(x => {
    const k = x.method || 'Not recorded';
    const m = methods[k] || (methods[k] = { name: k, count: 0, total: 0 });
    m.count++; m.total += Number(x.amount);
  }));

  const months = {};
  const slot = k => months[k] || (months[k] = { collected: 0, spent: 0 });
  people.forEach(p => p.pays.forEach(x => { const k = String(x.paid_on || '').slice(0, 7); if (k) slot(k).collected += Number(x.amount); }));
  expenses.forEach(x => { const k = String(x.spent_on || '').slice(0, 7); if (k) slot(k).spent += Number(x.amount); });
  const monthRows = Object.keys(months).sort().map(k => ({ key: k, ...months[k], net: months[k].collected - months[k].spent }));

  const cats = {};
  expenses.forEach(x => { cats[x.category] = (cats[x.category] || 0) + Number(x.amount); });
  const catRows = Object.entries(cats).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);

  const expected = due * people.length;
  const collected = people.reduce((a, p) => a + p.paid, 0);
  const spent = expenses.reduce((a, x) => a + Number(x.amount), 0);
  return {
    due, gradeRows, termRows, monthRows, catRows,
    methodRows: Object.values(methods).sort((a, b) => b.total - a.total),
    owedRows: people.filter(p => p.owed > 0).sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name)),
    totals: { students: people.length, expected, collected, owed: people.reduce((a, p) => a + p.owed, 0), spent, net: collected - spent },
  };
}

async function renderReports() {
  const yRes = await db.from('school_years').select('id, label, is_current').order('label', { ascending: false });
  if (yRes.error) return notify(friendly(yRes.error), true);
  const years = yRes.data;
  if (!years.length) {
    state.rep = null;
    $('#view').innerHTML = `<div style="display:grid;gap:1.25rem"><h2>Reports</h2>
      <div class="empty">Add a school year first, in the School years section.</div></div>`;
    return;
  }
  const yearId = years.find(y => String(y.id) === String(state.repYear))?.id
    ?? years.find(y => y.is_current)?.id ?? years[0].id;
  state.repYear = yearId;

  const [tRes, eRes, xRes, aRes, gRes] = await Promise.all([
    db.from('fee_terms').select('*').eq('school_year_id', yearId).order('sort_order').order('id'),
    db.from('enrollments')
      .select('id, grade_id, grades(name, sort_order), students(full_name, guardian_name, guardian_phone), payments(amount, term_id, paid_on, method)')
      .eq('school_year_id', yearId).limit(5000),
    db.from('expenses').select('category, amount, spent_on').eq('school_year_id', yearId).limit(5000),
    db.from('teacher_assignments').select('grade_id, teachers(first_name, last_name)').eq('school_year_id', yearId),
    db.from('grades').select('id, name, sort_order').order('sort_order').order('name'),
  ]);
  const err = tRes.error || eRes.error || xRes.error || aRes.error || gRes.error;
  if (err) return notify(friendly(err), true);

  state.rep = {
    years, yearId, yearLabel: years.find(y => y.id === yearId).label,
    ...buildReport(tRes.data, eRes.data, xRes.data, aRes.data, gRes.data),
  };
  drawReports();
}

function drawReports() {
  const r = state.rep;
  if (!r) return;
  const t = r.totals;
  const th = h => typeof h === 'string' ? `<th>${esc(h)}</th>` : `<th class="l${h.cls ? ' ' + h.cls : ''}">${esc(h.t)}</th>`;
  const table = (head, body, foot = '', id = '') =>
    `<div class="rt-wrap"><table class="rt"${id ? ` id="${id}"` : ''}><thead><tr>${head.map(th).join('')}</tr></thead><tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`;
  const none = text => `<div class="empty">${text}</div>`;

  const yearPicker = `<label class="year-pick noprint">School year
    <select data-change="rep-year">
      ${r.years.map(y => `<option value="${y.id}" ${y.id === r.yearId ? 'selected' : ''}>${esc(y.label)}${y.is_current ? ' (current)' : ''}</option>`).join('')}
    </select></label>`;

  const stats = `<div class="stats">
      <div class="stat"><span class="label">Fees expected</span><b>${money(t.expected)} GNF</b><span class="meta">${t.students} students × ${money(r.due)}</span></div>
      <div class="stat"><span class="label">Fees collected</span><b>${money(t.collected)} GNF</b><span class="meta">${pctOf(t.collected, t.expected)} of expected</span></div>
      <div class="stat"><span class="label">Still owed</span><b>${money(t.owed)} GNF</b><span class="meta">${r.owedRows.length} students owe</span></div>
      <div class="stat"><span class="label">Spent</span><b>${money(t.spent)} GNF</b><span class="meta">from Expenses</span></div>
      <div class="stat"><span class="label">Collected minus spent</span><b class="${t.net < 0 ? 'neg' : 'pos'}">${signedMoney(t.net)} GNF</b><span class="meta">${t.net < 0 ? 'spending is above collections' : 'collections cover spending'}</span></div>
    </div>`;

  const maxM = Math.max(1, ...r.monthRows.flatMap(m => [m.collected, m.spent]));
  const monthBody = r.monthRows.map(m => `<tr>
      <td>${esc(monthLabel(m.key))}<span class="mbars" aria-hidden="true"><span class="mbar c" style="width:${Math.round(m.collected / maxM * 100)}%"></span><span class="mbar s" style="width:${Math.round(m.spent / maxM * 100)}%"></span></span></td>
      <td>${money(m.collected)}</td><td>${money(m.spent)}</td><td class="${m.net < 0 ? 'neg' : 'pos'}">${signedMoney(m.net)}</td></tr>`).join('');
  const monthFoot = `<tr><td>Total</td><td>${money(t.collected)}</td><td>${money(t.spent)}</td><td class="${t.net < 0 ? 'neg' : 'pos'}">${signedMoney(t.net)}</td></tr>`;

  const gradeBody = r.gradeRows.map(g => `<tr><td>${esc(g.name)}</td><td class="l hide-sm">${esc(g.teachers.join(', ') || '—')}</td>
      <td>${g.students}</td><td>${money(g.expected)}</td><td>${money(g.collected)}</td><td>${money(g.owed)}</td><td>${pctOf(g.collected, g.expected)}</td></tr>`).join('');
  const gradeFoot = `<tr><td>All grades</td><td class="l hide-sm"></td><td>${t.students}</td><td>${money(t.expected)}</td><td>${money(t.collected)}</td><td>${money(t.owed)}</td><td>${pctOf(t.collected, t.expected)}</td></tr>`;

  const termBody = r.termRows.map(x => `<tr><td>${esc(x.name)}</td><td>${money(x.expected)}</td><td>${money(x.collected)}</td><td>${money(x.owed)}</td><td>${pctOf(x.collected, x.expected)}</td></tr>`).join('');
  const methodBody = r.methodRows.map(x => `<tr><td>${esc(x.name)}</td><td>${x.count}</td><td>${money(x.total)}</td></tr>`).join('');
  const catBody = r.catRows.map(x => `<tr><td>${esc(x.name)}</td><td>${money(x.total)}</td><td>${pctOf(x.total, t.spent)}</td></tr>`).join('');

  const owedGrades = [...new Set(r.owedRows.map(p => p.grade))];
  const owedBody = r.owedRows.map(p => `<tr data-grade="${esc(p.grade)}" data-owed="${p.owed}">
      <td>${esc(p.name)}</td><td class="l">${esc(p.grade)}</td><td class="l wrap">${esc(p.parent)}</td><td class="l">${esc(p.phone)}</td>
      <td>${money(p.paid)}</td><td><b>${money(p.owed)}</b></td></tr>`).join('');

  $('#view').innerHTML = `<div style="display:grid;gap:1.5rem">
    <div style="display:grid;gap:.5rem">
      <h2>Reports</h2>
      <p class="lead">Figures for one school year, worked out from the payments in Fees and the spending in Expenses. Only admins can see this section.</p>
      <p class="meta">School year ${esc(r.yearLabel)} · ${new Date().toLocaleDateString('en-GB')}</p>
    </div>
    <div class="noprint" style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:end">${yearPicker}
      <button class="btn" type="button" data-action="print">Print this report</button></div>
    ${stats}

    <section class="repsec"><h3>Month by month</h3>
      <p class="legend">The bars compare the two amounts: <span class="key c"></span> collected, <span class="key s"></span> spent. Net is collected minus spent.</p>
      ${r.monthRows.length ? table(['Month', 'Collected', 'Spent', 'Net'], monthBody, monthFoot) : none('No payments or expenses with a date in this school year yet.')}</section>

    <section class="repsec"><h3>By grade</h3>
      ${r.gradeRows.length ? table(['Grade', { t: 'Teacher', cls: 'hide-sm' }, 'Students', 'Expected', 'Collected', 'Owed', 'Paid'], gradeBody, gradeFoot) : none('No grades yet.')}</section>

    <section class="repsec"><h3>By term</h3>
      ${r.termRows.length ? table(['Term', 'Expected', 'Collected', 'Owed', 'Paid'], termBody) : none('No fee terms are set up for this school year.')}</section>

    <section class="repsec"><h3>How families paid</h3>
      ${r.methodRows.length ? table(['Method', 'Payments', 'Total'], methodBody) : none('No payments yet.')}</section>

    <section class="repsec"><h3>Spending by category</h3>
      ${r.catRows.length ? table(['Category', 'Spent', 'Share'], catBody) : none('No expenses yet.')}</section>

    <section class="repsec"><h3>Families who still owe</h3>
      ${r.owedRows.length ? `<div class="add noprint">
          <label>Grade <select data-change="rep-grade">
            <option value="">All grades</option>
            ${owedGrades.map(g => `<option value="${esc(g)}" ${g === state.repGrade ? 'selected' : ''}>${esc(g)}</option>`).join('')}
          </select></label>
          <span class="meta" id="rep-owed-count" role="status"></span>
          <button class="btn small" type="button" data-action="export-owed">Download call list (CSV)</button>
        </div>
        ${table(['Student', { t: 'Grade' }, { t: 'Parent or guardian' }, { t: 'Phone' }, 'Paid', 'Owes'], owedBody, '', 'rep-owed')}`
        : none('Every family is paid up.')}</section>
  </div>`;
  applyOwedFilter();
}

function applyOwedFilter() {
  const g = state.repGrade;
  let shown = 0, sum = 0;
  document.querySelectorAll('#rep-owed tbody tr[data-grade]').forEach(tr => {
    const ok = !g || tr.dataset.grade === g;
    tr.hidden = !ok;
    if (ok) { shown++; sum += Number(tr.dataset.owed); }
  });
  const c = $('#rep-owed-count');
  if (c) c.textContent = `${shown} student${shown === 1 ? '' : 's'} owe ${money(sum)} GNF`;
}

// What main.js plugs into the page for this screen:
//   render  draws the screen            forms    handlers for <form data-form="...">
//   actions handlers for data-action    changes  handlers for data-change (selects)
//   inputs  handlers for typing         cells    saves for table cells (data-table="...")
export const screen = {
  id: 'reports', group: 'Money', label: 'Reports', render: renderReports, admin: true,
  actions: {
    'export-owed'() {
      const r = state.rep;
      if (!r) return;
      const g = state.repGrade;
      downloadCsv(`balances-${r.yearLabel}.csv`, [['Student', 'Grade', 'Parent or guardian', 'Parent phone', 'Total due', 'Paid', 'Owes'],
        ...r.owedRows.filter(p => !g || p.grade === g).map(p => [p.name, p.grade, p.parent, p.phone, r.due, p.paid, p.owed])]);
    },
    'print'() { window.print(); },
  },
  changes: {
  'rep-year': el => { state.repYear = el.value; return renderReports(); },
  'rep-grade': el => { state.repGrade = el.value; applyOwedFilter(); },
  },
};
