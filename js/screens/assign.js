// Assign teachers screen: which teachers teach which grade in a chosen school year (a grade can have several).

import { db } from '../core/db.js';
import { state, isAdmin } from '../core/state.js';
import { $, esc, notify, friendly, done } from '../core/ui.js';
import { tname } from '../core/format.js';

async function renderAssign() {
  const [yRes, gRes, tRes] = await Promise.all([
    db.from('school_years').select('id, label, is_current').order('label', { ascending: false }),
    db.from('grades').select('id, name').order('sort_order').order('name'),
    db.from('teachers').select('id, first_name, last_name').eq('active', true).order('last_name').order('first_name'),
  ]);
  const err = yRes.error || gRes.error || tRes.error;
  if (err) return notify(friendly(err), true);

  const years = yRes.data;
  if (!years.length) {
    $('#view').innerHTML = `<div style="display:grid;gap:1.25rem"><h2>Assign teachers</h2>
      <div class="empty">Add a school year first, in the School years section.</div></div>`;
    return;
  }
  const yearId = years.find(y => String(y.id) === String(state.assignYear))?.id
    ?? years.find(y => y.is_current)?.id ?? years[0].id;
  state.assignYear = yearId;

  const aRes = await db.from('teacher_assignments')
    .select('id, grade_id, teacher_id, teachers(first_name, last_name)').eq('school_year_id', yearId);
  if (aRes.error) return notify(friendly(aRes.error), true);

  const byGrade = {};
  aRes.data.forEach(a => (byGrade[a.grade_id] ||= []).push(a));

  const rows = gRes.data.map(g => {
    const list = byGrade[g.id] || [];
    const taken = new Set(list.map(a => a.teacher_id));
    const options = tRes.data.filter(t => !taken.has(t.id));
    const chips = list.map(a => `<span class="chip">${esc(tname(a.teachers))}${isAdmin()
      ? `<button type="button" class="chip-x" data-action="unassign" data-id="${a.id}" aria-label="Remove ${esc(tname(a.teachers))} from ${esc(g.name)}">×</button>` : ''}</span>`).join('');
    const picker = isAdmin() && options.length
      ? `<form class="pick" data-form="assign-add">
           <input type="hidden" name="grade_id" value="${g.id}">
           <input type="hidden" name="year_id" value="${yearId}">
           <select name="teacher_id" required aria-label="Add a teacher to ${esc(g.name)}">
             <option value="">Add a teacher…</option>
             ${options.map(t => `<option value="${t.id}">${esc(tname(t))}</option>`).join('')}
           </select>
           <button class="btn small primary" type="submit">Assign</button>
         </form>` : '';
    return `<li><span class="grow">${esc(g.name)}</span>
      <span class="chips">${chips || '<span class="meta">No teacher yet</span>'}</span>${picker}</li>`;
  }).join('');

  $('#view').innerHTML = `
    <div style="display:grid;gap:1.25rem">
      <h2>Assign teachers</h2>
      <p class="lead">Choose which teacher teaches each class in a given school year. A class can have more than one teacher.</p>
      <label class="year-pick">School year
        <select data-change="assign-year">
          ${years.map(y => `<option value="${y.id}" ${y.id === yearId ? 'selected' : ''}>${esc(y.label)}${y.is_current ? ' (current)' : ''}</option>`).join('')}
        </select>
      </label>
      ${gRes.data.length ? `<ul class="rows">${rows}</ul>`
        : `<div class="empty">No grades yet. Add them in the Grades section first.</div>`}
    </div>`;
}

// What main.js plugs into the page for this screen:
//   render  draws the screen            forms    handlers for <form data-form="...">
//   actions handlers for data-action    changes  handlers for data-change (selects)
//   inputs  handlers for typing         cells    saves for table cells (data-table="...")
export const screen = {
  id: 'assign', group: 'Set up', label: 'Assign teachers', render: renderAssign,
  forms: {
    async 'assign-add'(f) {
      const { error } = await db.from('teacher_assignments').insert({
        teacher_id: Number(f.teacher_id), grade_id: Number(f.grade_id), school_year_id: Number(f.year_id),
      });
      return done(error, 'Teacher assigned.', renderAssign);
    },
  },
  actions: {
    async unassign(b) {
      const { error } = await db.from('teacher_assignments').delete().eq('id', b.dataset.id);
      return done(error, 'Teacher removed from the class.', renderAssign);
    },
  },
  changes: {
  'assign-year': el => { state.assignYear = el.value; return renderAssign(); },
  },
};
