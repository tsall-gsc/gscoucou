// Entry point. Starts the app, checks who is signed in, builds the menu and routes
// every click, form submission and edit to the screen that owns it.
//
// How a screen plugs in: each file in js/screens/ exports a `screen` object
// (see any of them). Add a new screen by creating its file and listing it in SCREENS below.

import { db, connect } from './core/db.js';
import { state, isAdmin, canSeeMoney, ROLE_LABEL } from './core/state.js';
import { $, esc } from './core/ui.js';

import { screen as years }    from './screens/years.js';
import { screen as grades }   from './screens/grades.js';
import { screen as teachers } from './screens/teachers.js';
import { screen as assign }   from './screens/assign.js';
import { screen as students } from './screens/students.js';
import { screen as fees }     from './screens/fees.js';
import { screen as expenses } from './screens/expenses.js';
import { screen as reports }  from './screens/reports.js';

// Menu order. `group` is the heading in the menu.
// `admin: true` shows a screen to admins only; `money: true` also shows it to read-only viewers.
const SCREENS = [years, grades, teachers, assign, students, fees, expenses, reports];

// ---------- menu ----------
const visibleScreens = () => SCREENS.filter(s => (!s.admin || isAdmin()) && (!s.money || canSeeMoney()));

function renderNav() {
  let last = '';
  $('#nav').innerHTML = visibleScreens().map(s => {
    const head = s.group !== last ? `<span class="group">${esc(s.group)}</span>` : '';
    last = s.group;
    return head + `<button type="button" data-action="go" data-id="${s.id}" ${state.view === s.id ? 'aria-current="page"' : ''}>${esc(s.label)}</button>`;
  }).join('');
  document.querySelector('#nav [aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

async function show(id) {
  const screen = visibleScreens().find(s => s.id === id) || visibleScreens()[1];   // admin-only screens fall back to Grades
  state.view = screen.id;
  state.editing = null;
  renderNav();
  await screen.render();
}

const currentScreen = () => SCREENS.find(s => s.id === state.view);

// ---------- routing tables ----------
// Merges one kind of handler (forms, actions, ...) from every screen into a single lookup table.
// Two screens using the same name would silently overwrite each other, so that stops the app instead.
function merge(kind, base = {}) {
  const table = { ...base };
  for (const s of SCREENS) {
    for (const [name, handler] of Object.entries(s[kind] || {})) {
      if (name in table) throw new Error(`Two screens define the ${kind} handler "${name}"`);
      table[name] = handler;
    }
  }
  return table;
}

const FORMS = merge('forms', {
  async login(f) {
    $('#login-error').textContent = '';
    const { error } = await db.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    if (error) $('#login-error').textContent = 'Email or password is incorrect.';
  },
});

const ACTIONS = merge('actions', {
  go: b => show(b.dataset.id),
  edit: b => { state.editing = b.dataset.key; return currentScreen().render(); },
  cancel: () => { state.editing = null; return currentScreen().render(); },
  logout: () => db.auth.signOut(),
});

const CHANGES = merge('changes');
const INPUTS = merge('inputs');
const CELLS = merge('cells');   // keyed by the data-table attribute of an editable table

// ---------- events ----------
document.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const handler = FORMS[form.dataset.form];
  if (handler) await handler(Object.fromEntries(new FormData(form)), form.dataset.id, form);
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (b && ACTIONS[b.dataset.action]) ACTIONS[b.dataset.action](b);
});

document.addEventListener('change', e => {
  const cell = e.target.closest('[data-field]');                  // a table cell the person just edited
  if (cell) { CELLS[cell.dataset.table || 'students']?.(cell); return; }
  const el = e.target.closest('[data-change]');                   // a select that redraws or filters
  if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el);
});

document.addEventListener('input', e => {
  INPUTS[e.target.id]?.(e.target);                                // search boxes
});

// ---------- session ----------
async function enter(session) {
  if (!session) {
    state.user = null; state.profile = null;
    $('#app').hidden = true;
    $('#login').hidden = false;
    return;
  }
  state.user = session.user;
  const { data, error } = await db.from('profiles').select('full_name, role').eq('id', session.user.id).single();
  if (error || !data) {
    await db.auth.signOut();
    $('#login-error').textContent = 'Your account has no access yet. Ask the administrator.';
    return;
  }
  state.profile = data;
  $('#who-name').textContent = data.full_name || session.user.email;
  $('#who-role').textContent = ROLE_LABEL[data.role] || data.role;
  $('#login').hidden = true;
  $('#app').hidden = false;
  await show(state.view);
}

// SUPABASE_URL and SUPABASE_ANON_KEY come from config.js, which index.html loads first.
(async function boot() {
  if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined'
      || SUPABASE_URL.startsWith('PASTE') || SUPABASE_ANON_KEY.startsWith('PASTE')) {
    $('#setup').hidden = false;
    return;
  }
  connect(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await db.auth.getSession();
  await enter(data.session);
  db.auth.onAuthStateChange((event, session) => {
    // Re-render only when someone signs in or out, not on routine token refreshes.
    if (event === 'SIGNED_OUT') enter(null);
    if (event === 'SIGNED_IN' && !state.user) enter(session);
  });
})();
