// Students screen: an editable table with search and a grade filter. Each cell saves when the person leaves it.

import { db } from '../core/db.js';
import { state, isAdmin, canWrite } from '../core/state.js';
import { $, esc, notify, friendly, done } from '../core/ui.js';
import { nullIfEmpty } from '../core/format.js';

async function renderStudents() {
  const [sRes, yRes, gRes] = await Promise.all([
    db.from('students')
      .select('*, enrollments(id, school_year_id, grade_id, grades(name, sort_order))')
      .order('full_name').limit(5000),
    db.from('school_years').select('id, label').eq('is_current', true).maybeSingle(),
    db.from('grades').select('id, name').order('sort_order').order('name'),
  ]);
  const err = sRes.error || gRes.error;
  if (err) return notify(friendly(err), true);

  const yearId = yRes.data?.id ?? null;
  state.yearId = yearId;
  const grades = gRes.data;
  const enrOf = s => (s.enrollments || []).find(e => e.school_year_id === yearId);
  const gradeField = selected => yearId
    ? `<label>Grade <select name="grade_id"><option value="">No grade</option>${grades.map(g =>
        `<option value="${g.id}" ${String(g.id) === String(selected) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>` : '';

  const rows = sRes.data.map(s => {
    const e = enrOf(s);
    const gid = e ? String(e.grade_id) : '';
    const gname = e?.grades?.name || '';
    const q = [s.full_name, s.guardian_name, s.guardian_phone, gname].filter(Boolean).join(' ').toLowerCase();
    const cell = (field, value, type, label) => !canWrite() ? `<span class="ro">${esc(value)}</span>` :
      `<input type="${type}" data-field="${field}" data-id="${s.id}" data-orig="${esc(value)}" value="${esc(value)}" aria-label="${label} — ${esc(s.full_name)}" ${field === 'full_name' ? 'required' : ''}>`;
    const gradeCell = yearId && !canWrite()
      ? (gname ? `<span class="badge">${esc(gname)}</span>` : '<span class="meta">—</span>')
      : yearId
      ? `<select data-field="grade" data-id="${s.id}" data-orig="${gid}" aria-label="Grade — ${esc(s.full_name)}">
           ${gid ? '' : '<option value="">Choose grade…</option>'}
           ${grades.map(g => `<option value="${g.id}" ${String(g.id) === gid ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
         </select>`
      : '<span class="meta">—</span>';
    const main = `<tr class="${s.active ? '' : 'inactive'}" data-id="${s.id}" data-grade="${gid}" data-q="${esc(q)}">
      <td class="wide" data-label="Full name">${cell('full_name', s.full_name, 'text', 'Full name')}${s.active ? '' : '<small class="meta">Not enrolled</small>'}</td>
      <td data-label="Grade">${gradeCell}</td>
      <td data-label="Parent or guardian">${cell('guardian_name', s.guardian_name ?? '', 'text', 'Parent or guardian')}</td>
      <td data-label="Parent phone">${cell('guardian_phone', s.guardian_phone ?? '', 'tel', 'Parent phone')}</td>
      <td class="tools-cell"><div class="tools"><span class="state" role="status"></span>
        ${canWrite() ? `<button class="btn small" type="button" data-action="edit" data-key="s${s.id}">Details</button>` : ''}
        ${isAdmin() ? `<button class="btn small danger" type="button" data-action="del-student" data-id="${s.id}" data-name="${esc(s.full_name)}">Delete</button>` : ''}
      </div></td></tr>`;
    const detail = state.editing === 's' + s.id
      ? `<tr class="detail"><td colspan="5"><form data-form="student-details" data-id="${s.id}">
          <label>Birth date <input type="date" name="birth_date" value="${s.birth_date ?? ''}"></label>
          <label>Notes <input type="text" name="notes" value="${esc(s.notes)}"></label>
          <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Currently enrolled</label>
          <button class="btn primary small" type="submit">Save details</button>
          <button class="btn small" type="button" data-action="cancel">Cancel</button>
        </form></td></tr>` : '';
    return main + detail;
  }).join('');

  const filterBar = sRes.data.length ? `
    <div class="add">
      <label>Search <input type="search" id="stu-q" placeholder="Name, parent or phone" value="${esc(state.stuQuery)}"></label>
      <label>Grade
        <select data-change="stu-filter">
          <option value="">All grades</option>
          ${grades.map(g => `<option value="${g.id}" ${String(g.id) === state.stuGrade ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
          <option value="none" ${state.stuGrade === 'none' ? 'selected' : ''}>No grade</option>
        </select>
      </label>
      <span class="meta" id="stu-count" role="status"></span>
    </div>` : '';

  $('#view').innerHTML = `
    <div style="display:grid;gap:1.25rem">
      <h2>Students</h2>
      <p class="lead">${canWrite() ? 'Click any name, grade, parent or phone in the list to change it. Each change is saved as soon as you leave the field. “Details” has birth date, notes and enrollment status.' : 'Every student with their grade and their parent’s contact. You have read-only access.'}</p>
      ${yearId ? '' : '<div class="empty">No school year is marked as current, so grades can’t be shown or set. Mark one in School years.</div>'}
      ${!canWrite() ? '' : `<form class="add" data-form="student-add">
        <label>Full name <input type="text" name="full_name" required></label>
        ${gradeField('')}
        <label>Parent or guardian <input type="text" name="guardian_name"></label>
        <label>Parent phone <input type="tel" name="guardian_phone"></label>
        <button class="btn primary" type="submit">Add student</button>
      </form>`}
      ${filterBar}
      ${sRes.data.length ? `<div class="table-wrap"><table class="grid" id="stu-table">
          <thead><tr><th>Full name</th><th>Grade</th><th>Parent or guardian</th><th>Parent phone</th><th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
        : `<div class="empty">No students yet.${canWrite() ? ' Add the first one above.' : ''}</div>`}
    </div>`;
  applyStudentFilter();
}

// Saves one cell of the students table as soon as the person leaves it.
async function saveStudentField(el) {
  const id = Number(el.dataset.id);
  const field = el.dataset.field;
  const row = el.closest('tr');
  const flag = row.querySelector('.state');
  const say = (text, cls) => { flag.textContent = text; flag.className = 'state ' + cls; };
  const orig = el.dataset.orig;
  const value = el.value.trim();

  if (value === orig) { if (el.value !== value) el.value = value; return; }
  if (field === 'full_name' && !value) { el.value = orig; say('Name can’t be empty', 'bad'); return; }
  if (field === 'grade' && !value) return;           // the "Choose grade…" placeholder: nothing to save

  say('Saving…', '');
  let error;
  if (field === 'grade') {
    ({ error } = await db.from('enrollments').upsert(
      { student_id: id, school_year_id: state.yearId, grade_id: Number(value) },
      { onConflict: 'student_id,school_year_id' }));
  } else {
    ({ error } = await db.from('students').update({ [field]: field === 'full_name' ? value : nullIfEmpty(value) }).eq('id', id));
  }
  if (error) { el.value = orig; say('Not saved: ' + friendly(error), 'bad'); return; }

  el.value = value;
  el.dataset.orig = value;
  if (field === 'grade') el.querySelector('option[value=""]')?.remove();

  // Keep the search and grade filters in step with what is now on screen.
  const gSel = row.querySelector('[data-field="grade"]');
  const gText = gSel?.value ? gSel.selectedOptions[0].textContent : '';
  row.dataset.grade = gSel?.value || '';
  row.dataset.q = ['full_name', 'guardian_name', 'guardian_phone']
    .map(f => row.querySelector(`[data-field="${f}"]`).value).concat(gText)
    .filter(Boolean).join(' ').toLowerCase();

  say('Saved ✓', 'ok');
  setTimeout(() => { if (flag.textContent === 'Saved ✓') say('', ''); }, 2500);
}

function applyStudentFilter() {
  const g = state.stuGrade;
  const q = state.stuQuery.trim().toLowerCase();
  let shown = 0, total = 0;
  document.querySelectorAll('#stu-table tbody tr[data-q]').forEach(li => {
    total++;
    const okGrade = !g || (g === 'none' ? li.dataset.grade === '' : li.dataset.grade === g);
    const okText = !q || li.dataset.q.includes(q);
    li.hidden = !(okGrade && okText);
    if (!li.hidden) shown++;
  });
  const c = $('#stu-count');
  if (c) c.textContent = `${shown} of ${total} students`;
}

// What main.js plugs into the page for this screen:
//   render  draws the screen            forms    handlers for <form data-form="...">
//   actions handlers for data-action    changes  handlers for data-change (selects)
//   inputs  handlers for typing         cells    saves for table cells (data-table="...")
export const screen = {
  id: 'students', group: 'Set up', label: 'Students', render: renderStudents,
  forms: {
    async 'student-add'(f) {
      const { data, error } = await db.from('students').insert({
        full_name: f.full_name.trim(),
        guardian_name: nullIfEmpty((f.guardian_name || '').trim()),
        guardian_phone: nullIfEmpty((f.guardian_phone || '').trim()),
      }).select('id').single();
      if (error) return notify(friendly(error), true);
      if (f.grade_id && state.yearId) {
        const enr = await db.from('enrollments').insert({
          student_id: data.id, school_year_id: state.yearId, grade_id: Number(f.grade_id),
        });
        if (enr.error) {
          await renderStudents();
          return notify('Student added, but the grade could not be set: ' + friendly(enr.error), true);
        }
      }
      return done(null, 'Student added.', renderStudents);
    },
    async 'student-details'(f, id) {
      const { error } = await db.from('students').update({
        birth_date: nullIfEmpty(f.birth_date),
        notes: nullIfEmpty((f.notes || '').trim()),
        active: f.active === 'on',
      }).eq('id', id);
      state.editing = null;
      return done(error, 'Details saved.', renderStudents);
    },
  },
  actions: {
    async 'del-student'(b) {
      if (!confirm(`Delete ${b.dataset.name}? This also removes their enrollments and fee payments, and can’t be undone. To keep the history, edit the student and untick “Currently enrolled” instead.`)) return;
      const { error } = await db.from('students').delete().eq('id', b.dataset.id);
      return done(error, 'Student deleted.', renderStudents);
    },
  },
  changes: {
  'stu-filter': el => { state.stuGrade = el.value; applyStudentFilter(); },
  },
  inputs: {
  'stu-q': el => { state.stuQuery = el.value; applyStudentFilter(); },
  },
  cells: { students: saveStudentField },
};
