# School Manager

A small web app to run a private school: students, teachers, grades, fees, expenses and reports.
It is plain HTML, CSS and JavaScript. There is **no server to run and no build step**.

```
 Browser  ──►  static files on GitHub Pages      (index.html, css/, js/)
    │
    └────────►  Supabase (cloud)                 Postgres database + sign-in + row-level security
```

The pages are public, so **every rule that matters lives in the database** (row-level security, see
`db/schema.sql`). The app only decides what to show; the database decides what is allowed.

## Folder layout

```
index.html              The page shell: markup only (sign-in box, menu, empty content area)
config.js               YOUR Supabase URL + public key (copy of config.example.js; not in the zip)
css/
  base.css              Design tokens, buttons, form fields
  layout.css            Sign-in page, app frame, message bar
  screens.css           Lists, tables, fees, expenses, reports
  print.css             What a printed report hides
  mobile.css            Phones: top-bar menu, big touch targets, table rows as cards
js/
  main.js               Entry point: menu, event routing, session. Lists every screen.
  core/
    db.js               The Supabase client (`db`)
    state.js            Who is signed in, what each screen shows, role checks
    ui.js               $, esc(), message bar, error wording, CSV download
    format.js           money(), parseMoney(), todayLocal(), tname()
  screens/              One file per screen. Each exports a `screen` object.
    years.js  grades.js  teachers.js  assign.js  students.js
    fees.js   expenses.js  reports.js
db/
  schema.sql            Fresh install: tables, roles, row-level security
  migrations/           Changes made after the first release. Run in this order:
                          fees.sql -> installments.sql -> expenses.sql -> viewer-role.sql
  maintenance/          One-off repairs (see the table below). Safe to run twice.
  imports/              One-off data loads. import_teachers.sql holds phone numbers and is git-ignored.
```

## How a screen works

Every screen file has the same shape:

1. `renderX()` reads from the database through `db`, then writes HTML into `#view`.
2. Handlers react to what the person does. They are found by **attributes in the HTML**:

| In the HTML | Calls | Declared in the screen as |
|---|---|---|
| `<form data-form="grade-add">` | submit | `forms: { 'grade-add': f => ... }` |
| `<button data-action="del-grade">` | click | `actions: { 'del-grade': button => ... }` |
| `<select data-change="fee-year">` | change | `changes: { 'fee-year': select => ... }` |
| `<input data-table="fees" data-field="pay">` | leaving the cell | `cells: { fees: saveFeeCell }` |
| `<input id="stu-q">` | typing | `inputs: { 'stu-q': input => ... }` |

3. The bottom of the file exports `screen = { id, group, label, render, forms, actions, ... }`.
   `main.js` merges every screen's handlers into one table. If two screens use the same handler name
   the app refuses to start and says which one, instead of one silently overriding the other.

### Add a screen

1. Create `js/screens/books.js`:
   ```js
   import { db } from '../core/db.js';
   import { $, esc } from '../core/ui.js';

   async function renderBooks() {
     const { data } = await db.from('books').select('*');
     $('#view').innerHTML = `<h2>Books</h2><ul>${data.map(b => `<li>${esc(b.title)}</li>`).join('')}</ul>`;
   }

   export const screen = { id: 'books', group: 'Set up', label: 'Books', render: renderBooks };
   ```
2. In `js/main.js`, import it and add it to `SCREENS`. Add `admin: true` to hide it from data-entry users.
3. Create its table and access rules in a new file under `db/migrations/`. Turn on row-level security.

Always pass database text through `esc()` before putting it in HTML.

## Roles

| Role | Can do |
|---|---|
| `super_admin` | Everything, including deleting and changing roles |
| `admin` | Manage records, correct or delete payments, expenses, reports |
| `user` (data entry) | See students, teachers and fees; add and edit students; record payments |
| `viewer` (read-only) | See everything and run the Reports; cannot add, change or delete anything |

Roles live in the `profiles` table and are enforced by policies in the database.

## Set up from scratch

1. Create a Supabase project (free plan is enough). Choose the region closest to the school.
2. SQL Editor: run `db/schema.sql`, then `db/migrations/fees.sql`, `installments.sql`, `expenses.sql`
   and, if you want a read-only role, `viewer-role.sql`.
3. Authentication: **turn off public sign-ups**. Add your own user (tick "Auto confirm"), then make it super admin
   (Table Editor, `profiles` table, set `role` to `super_admin`).
4. Copy `config.example.js` to `config.js` and paste in the project URL (base address only) and the publishable/anon key.
   Never use the secret or `service_role` key: this file is public.
5. Publish: GitHub, Settings, Pages, "Deploy from a branch". The repo must be public on the free plan.

## Create a read-only user (for example a governor who only needs the reports)

1. Run `db/migrations/viewer-role.sql` once (after `fees.sql` and `expenses.sql`).
2. Supabase, Authentication, Users, **Add user** (tick "Auto confirm user").
3. Table Editor, `profiles` table, find that user and set `role` to `viewer`.

A viewer sees the Reports and Fees screens and the lists, with no edit boxes, and cannot see the Expenses screen.
The database refuses their writes even if someone calls the API directly. The viewer can read expenses
(the reports need them) but not staff pay.

Anything that resets the access rules (`expenses.sql`, `fees.sql`, `maintenance/fix_students_table.sql`)
undoes `viewer-role.sql`: run it again afterwards.

## Run it on your own machine

ES modules do not load from `file://`, so serve the folder (and keep the server on your own machine only):

```bash
cd <repo root>
python3 -m http.server 8000 --bind 127.0.0.1
# open http://localhost:8000
```

After an update, reload with Ctrl+Shift+R. Browsers and GitHub Pages cache the `.js` and `.css` files for a few minutes.

## SQL maintenance files

| File | When to run |
|---|---|
| `maintenance/fix_teachers_table.sql` | The teachers table does not use first_name/last_name |
| `maintenance/fix_students_table.sql` | The students table does not match the app (full_name, guardian columns) |
| `maintenance/fix_grade_names.sql` | Rename grades GS/MS to GSA/MSA (merges if both exist) |
| `maintenance/link_student_grades.sql` | Students have a `grade` column but no enrollment for the current year |
| `imports/import_students.sql` | Load students from a staging table `import_students` |
| `imports/import_teachers.sql` | Load the first set of teachers (contains phone numbers: keep out of Git) |
| `imports/move_payments.sql` | Move payments from `q1_payments`, `q2_payments`, `q3_payments` into `payments` |

## Backups and limits (free Supabase plan)

- A project pauses after a week without activity. Restore it from the dashboard.
- Free projects have no automatic backups. Use the CSV downloads (Fees, Expenses, Reports) regularly.
- The database holds a few hundred students comfortably; the 500 MB limit is far away.
