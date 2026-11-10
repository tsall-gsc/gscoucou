// School years screen: one row per year, exactly one marked "current".

import { db } from '../core/db.js';
import { state, isAdmin, isSuper } from '../core/state.js';
import { $, esc, notify, friendly, done } from '../core/ui.js';
import { nullIfEmpty } from '../core/format.js';

async function renderYears() {
  const { data, error } = await db.from('school_years').select('*').order('label', { ascending: false });
  if (error) return notify(friendly(error), true);

  const rows = data.map(y => state.editing === 'y' + y.id
    ? `<li><form data-form="year-edit" data-id="${y.id}">
         <label>Label <input type="text" name="label" value="${esc(y.label)}" required></label>
         <label>Starts <input type="date" name="start_date" value="${y.start_date ?? ''}"></label>
         <label>Ends <input type="date" name="end_date" value="${y.end_date ?? ''}"></label>
         <button class="btn primary small" type="submit">Save changes</button>
         <button class="btn small" type="button" data-action="cancel">Cancel</button>
       </form></li>`
    : `<li><span class="grow">${esc(y.label)}</span>
         ${y.is_current ? '<span class="badge">Current</span>' : ''}
         <span class="meta">${y.start_date ? esc(y.start_date) : '…'} to ${y.end_date ? esc(y.end_date) : '…'}</span>
         <span class="actions">
           ${isAdmin() && !y.is_current ? `<button class="btn small" type="button" data-action="make-current" data-id="${y.id}">Make current</button>` : ''}
           ${isAdmin() ? `<button class="btn small" type="button" data-action="edit" data-key="y${y.id}">Edit</button>` : ''}
           ${isSuper() ? `<button class="btn small danger" type="button" data-action="del-year" data-id="${y.id}" data-name="${esc(y.label)}">Delete</button>` : ''}
         </span></li>`).join('');

  $('#view').innerHTML = `
    <div style="display:grid;gap:1.25rem">
      <h2>School years</h2>
      <p class="lead">Fees, enrollments and teacher assignments are tracked per school year. Mark one year as current.</p>
      ${isAdmin() ? `<form class="add" data-form="year-add">
          <label>Label <input type="text" name="label" placeholder="e.g. 2026-2027" required></label>
          <label>Starts <input type="date" name="start_date"></label>
          <label>Ends <input type="date" name="end_date"></label>
          <button class="btn primary" type="submit">Add school year</button>
        </form>` : ''}
      ${data.length ? `<ul class="rows">${rows}</ul>`
        : `<div class="empty">No school years yet. ${isAdmin() ? 'Add the first one above.' : 'An admin needs to add one.'}</div>`}
    </div>`;
}

// What main.js plugs into the page for this screen:
//   render  draws the screen            forms    handlers for <form data-form="...">
//   actions handlers for data-action    changes  handlers for data-change (selects)
//   inputs  handlers for typing         cells    saves for table cells (data-table="...")
export const screen = {
  id: 'years', group: 'Set up', label: 'School years', render: renderYears,
  forms: {
    async 'year-add'(f) {
      const { error } = await db.from('school_years').insert({ label: f.label.trim(), start_date: nullIfEmpty(f.start_date), end_date: nullIfEmpty(f.end_date) });
      return done(error, 'School year added.', renderYears);
    },
    async 'year-edit'(f, id) {
      const { error } = await db.from('school_years').update({ label: f.label.trim(), start_date: nullIfEmpty(f.start_date), end_date: nullIfEmpty(f.end_date) }).eq('id', id);
      state.editing = null;
      return done(error, 'School year updated.', renderYears);
    },
  },
  actions: {
    async 'del-year'(b) {
      if (!confirm(`Delete the school year “${b.dataset.name}”? This can’t be undone.`)) return;
      const { error } = await db.from('school_years').delete().eq('id', b.dataset.id);
      return done(error, 'School year deleted.', renderYears);
    },
    async 'make-current'(b) {
      const off = await db.from('school_years').update({ is_current: false }).eq('is_current', true);
      if (off.error) return notify(friendly(off.error), true);
      const { error } = await db.from('school_years').update({ is_current: true }).eq('id', b.dataset.id);
      return done(error, 'Current school year updated.', renderYears);
    },
  },
};
