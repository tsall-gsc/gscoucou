// Grades screen: the classes of the school (6A, 5A, GSA...). Admins add and edit, only the super admin deletes.

import { db } from '../core/db.js';
import { state, isAdmin, isSuper } from '../core/state.js';
import { $, esc, notify, friendly, done } from '../core/ui.js';

async function renderGrades() {
  const { data, error } = await db.from('grades').select('*').order('sort_order').order('name');
  if (error) return notify(friendly(error), true);

  const rows = data.map(g => state.editing === 'g' + g.id
    ? `<li><form data-form="grade-edit" data-id="${g.id}">
         <label>Name <input type="text" name="name" value="${esc(g.name)}" required></label>
         <label>Order <input type="number" name="sort_order" value="${g.sort_order}"></label>
         <button class="btn primary small" type="submit">Save changes</button>
         <button class="btn small" type="button" data-action="cancel">Cancel</button>
       </form></li>`
    : `<li><span class="grow">${esc(g.name)}</span><span class="meta">Order ${g.sort_order}</span>
         <span class="actions">
           ${isAdmin() ? `<button class="btn small" type="button" data-action="edit" data-key="g${g.id}">Edit</button>` : ''}
           ${isSuper() ? `<button class="btn small danger" type="button" data-action="del-grade" data-id="${g.id}" data-name="${esc(g.name)}">Delete</button>` : ''}
         </span></li>`).join('');

  $('#view').innerHTML = `
    <div style="display:grid;gap:1.25rem">
      <h2>Grades</h2>
      <p class="lead">The classes of your school. Students and teachers are linked to these, so add them first.</p>
      ${isAdmin() ? `<form class="add" data-form="grade-add">
          <label>Grade name <input type="text" name="name" placeholder="e.g. Grade 1" required></label>
          <label>Order <input type="number" name="sort_order" value="${data.length + 1}"></label>
          <button class="btn primary" type="submit">Add grade</button>
        </form>` : ''}
      ${data.length ? `<ul class="rows">${rows}</ul>`
        : `<div class="empty">No grades yet. ${isAdmin() ? 'Add your first grade above.' : 'An admin needs to add them.'}</div>`}
    </div>`;
}

// What main.js plugs into the page for this screen:
//   render  draws the screen            forms    handlers for <form data-form="...">
//   actions handlers for data-action    changes  handlers for data-change (selects)
//   inputs  handlers for typing         cells    saves for table cells (data-table="...")
export const screen = {
  id: 'grades', group: 'Set up', label: 'Grades', render: renderGrades,
  forms: {
    async 'grade-add'(f) {
      const { error } = await db.from('grades').insert({ name: f.name.trim(), sort_order: Number(f.sort_order) || 0 });
      return done(error, 'Grade added.', renderGrades);
    },
    async 'grade-edit'(f, id) {
      const { error } = await db.from('grades').update({ name: f.name.trim(), sort_order: Number(f.sort_order) || 0 }).eq('id', id);
      state.editing = null;
      return done(error, 'Grade updated.', renderGrades);
    },
  },
  actions: {
    async 'del-grade'(b) {
      if (!confirm(`Delete the grade “${b.dataset.name}”? This can’t be undone.`)) return;
      const { error } = await db.from('grades').delete().eq('id', b.dataset.id);
      return done(error, 'Grade deleted.', renderGrades);
    },
  },
};
