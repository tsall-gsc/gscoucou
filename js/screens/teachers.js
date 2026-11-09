// Teachers screen: an editable table. Each cell saves when the person leaves it; the Grade cell moves the teacher to another grade for the current year.

import { db } from '../core/db.js';
import { state, isAdmin, isSuper } from '../core/state.js';
import { $, esc, notify, friendly, done } from '../core/ui.js';
import { nullIfEmpty, tname } from '../core/format.js';

async function renderTeachers() {
  const [tRes, yRes, gRes] = await Promise.all([
    db.from('teachers')
      .select('*, teacher_assignments(id, school_year_id, grade_id, grades(name, sort_order))')
      .order('last_name').order('first_name'),
    db.from('school_years').select('id, label').eq('is_current', true).maybeSingle(),
    db.from('grades').select('id, name').order('sort_order').order('name'),
  ]);
  const err = tRes.error || gRes.error;
  if (err) return notify(friendly(err), true);
  const yearId = yRes.data?.id ?? null;
  state.teacherYearId = yearId;
  const grades = gRes.data;

  const rows = tRes.data.map(t => {
    const name = tname(t);
    const cell = (field, value, type, label) => isAdmin()
      ? `<input type="${type}" data-table="teachers" data-field="${field}" data-id="${t.id}" data-orig="${esc(value)}" value="${esc(value)}" aria-label="${label} — ${esc(name)}">`
      : `<span class="ro">${esc(value)}</span>`;

    // Grade(s) this teacher has in the current school year.
    const mine = (t.teacher_assignments || [])
      .filter(a => a.school_year_id === yearId && a.grades)
      .sort((a, b) => a.grades.sort_order - b.grades.sort_order);
    const badges = mine.map(a => `<span class="badge">${esc(a.grades.name)}</span>`).join(' ');
    let gradeCell;
    if (!yearId) {
      gradeCell = '<span class="meta">—</span>';
    } else if (!isAdmin()) {
      gradeCell = badges || '<span class="meta">—</span>';
    } else if (mine.length > 1) {
      gradeCell = `${badges}<small class="meta">Several grades. Change them in Assign teachers.</small>`;
    } else {
      gradeCell = `<select data-table="teachers" data-field="grade" data-id="${t.id}"
          data-assignment="${mine[0]?.id ?? ''}" data-orig="${mine[0]?.grade_id ?? ''}" aria-label="Grade — ${esc(name)}">
          ${mine.length ? '' : '<option value="">Choose grade…</option>'}
          ${grades.map(g => `<option value="${g.id}" ${mine[0]?.grade_id === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
        </select>`;
    }

    const main = `<tr class="${t.active ? '' : 'inactive'}" data-id="${t.id}">
      <td data-label="First name">${cell('first_name', t.first_name ?? '', 'text', 'First name')}${t.active ? '' : '<small class="meta">Not teaching</small>'}</td>
      <td data-label="Last name">${cell('last_name', t.last_name ?? '', 'text', 'Last name')}</td>
      <td data-label="Phone">${cell('phone', t.phone ?? '', 'tel', 'Phone')}</td>
      <td data-label="Email">${cell('email', t.email ?? '', 'email', 'Email')}</td>
      <td data-label="Grade">${gradeCell}</td>
      <td class="tools-cell"><div class="tools"><span class="state" role="status"></span>
        ${isAdmin() ? `<button class="btn small" type="button" data-action="edit" data-key="t${t.id}">Details</button>` : ''}
        ${isSuper() ? `<button class="btn small danger" type="button" data-action="del-teacher" data-id="${t.id}" data-name="${esc(name)}">Delete</button>` : ''}
      </div></td></tr>`;
    const detail = isAdmin() && state.editing === 't' + t.id
      ? `<tr class="detail"><td colspan="6"><form data-form="teacher-details" data-id="${t.id}">
          <label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Currently teaching</label>
          <button class="btn primary small" type="submit">Save</button>
          <button class="btn small" type="button" data-action="cancel">Cancel</button>
        </form></td></tr>` : '';
    return main + detail;
  }).join('');

  $('#view').innerHTML = `
    <div style="display:grid;gap:1.25rem">
      <h2>Teachers</h2>
      <p class="lead">${isAdmin()
        ? 'Click any name, phone or email in the list to change it, and pick a grade from the list to move a teacher to another grade. Each change is saved as soon as you leave the field. The grade shown is for the current school year.'
        : 'Everyone who teaches at the school, with their grade for the current school year. Only admins can make changes.'}</p>
      ${yearId || !isAdmin() ? '' : '<div class="empty">No school year is marked as current, so grades can’t be shown or set. Mark one in School years.</div>'}
      ${isAdmin() ? `<form class="add" data-form="teacher-add">
          <label>First name <input type="text" name="first_name" required></label>
          <label>Last name <input type="text" name="last_name" required></label>
          <label>Phone <input type="tel" name="phone"></label>
          <label>Email <input type="email" name="email"></label>
          <button class="btn primary" type="submit">Add teacher</button>
        </form>` : ''}
      ${tRes.data.length ? `<div class="table-wrap"><table class="grid" id="teach-table">
          <thead><tr><th>First name</th><th>Last name</th><th>Phone</th><th>Email</th><th>Grade</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
        : `<div class="empty">No teachers yet. ${isAdmin() ? 'Add the first one above.' : 'An admin needs to add them.'}</div>`}
    </div>`;
}

// Saves one cell of the teachers table as soon as the person leaves it.
async function saveTeacherField(el) {
  const id = Number(el.dataset.id);
  const field = el.dataset.field;
  const row = el.closest('tr');
  const flag = row.querySelector('.state');
  const say = (text, cls) => { flag.textContent = text; flag.className = 'state ' + cls; };
  const orig = el.dataset.orig;
  const value = el.value.trim();

  if (value === orig) { if (el.value !== value) el.value = value; return; }
  if (field === 'grade' && !value) return;           // the "Choose grade…" placeholder: nothing to save
  if ((field === 'first_name' || field === 'last_name') && !value) { el.value = orig; say('Name can’t be empty', 'bad'); return; }
  if (field === 'email' && value && !el.checkValidity()) { el.value = orig; say('Not a valid email', 'bad'); return; }

  say('Saving…', '');
  let res;
  if (field === 'grade') {
    if (el.dataset.assignment) {
      res = await db.from('teacher_assignments').update({ grade_id: Number(value) })
        .eq('id', Number(el.dataset.assignment)).select('id');
    } else {
      res = await db.from('teacher_assignments')
        .insert({ teacher_id: id, grade_id: Number(value), school_year_id: state.teacherYearId }).select('id');
    }
  } else {
    res = await db.from('teachers').update({ [field]: nullIfEmpty(value) }).eq('id', id).select('id');
  }
  const error = res.error || (res.data?.length ? null : { message: 'Your role doesn’t allow this change.' });
  if (error) { el.value = orig; say('Not saved: ' + friendly(error), 'bad'); return; }

  el.value = value;
  el.dataset.orig = value;
  if (field === 'grade') {
    if (!el.dataset.assignment) el.dataset.assignment = res.data[0].id;   // later changes update this same row
    el.querySelector('option[value=""]')?.remove();
  }
  say('Saved ✓', 'ok');
  setTimeout(() => { if (flag.textContent === 'Saved ✓') say('', ''); }, 2500);
}

// What main.js plugs into the page for this screen:
//   render  draws the screen            forms    handlers for <form data-form="...">
//   actions handlers for data-action    changes  handlers for data-change (selects)
//   inputs  handlers for typing         cells    saves for table cells (data-table="...")
export const screen = {
  id: 'teachers', group: 'Set up', label: 'Teachers', render: renderTeachers,
  forms: {
    async 'teacher-add'(f) {
      const { error } = await db.from('teachers').insert({
        first_name: f.first_name.trim(), last_name: f.last_name.trim(), phone: nullIfEmpty(f.phone.trim()), email: nullIfEmpty(f.email.trim()),
      });
      return done(error, 'Teacher added.', renderTeachers);
    },
    async 'teacher-details'(f, id) {
      const { error } = await db.from('teachers').update({ active: f.active === 'on' }).eq('id', id);
      state.editing = null;
      return done(error, 'Teacher updated.', renderTeachers);
    },
  },
  actions: {
    async 'del-teacher'(b) {
      if (!confirm(`Delete ${b.dataset.name}? This also removes their class assignments and pay records, and can’t be undone. To keep the history, edit the teacher and untick “Currently teaching” instead.`)) return;
      const { error } = await db.from('teachers').delete().eq('id', b.dataset.id);
      return done(error, 'Teacher deleted.', renderTeachers);
    },
  },
  cells: { teachers: saveTeacherField },
};
