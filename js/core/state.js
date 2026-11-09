// Shared state: who is signed in and what each screen currently shows.
// Screens read and write these fields directly; nothing here talks to the database.

export const ROLE_LABEL = { super_admin: 'Super admin', admin: 'Admin', user: 'Data entry', viewer: 'Read-only' };

export const state = {
  // session
  user: null,
  profile: null,          // { full_name, role } from the profiles table
  view: 'grades',         // id of the screen on show
  editing: null,          // key of the row whose "Details" panel is open, such as 's12' or 't3'

  // Assign teachers
  assignYear: null,
  // Students
  stuGrade: '', stuQuery: '', yearId: null,
  // Teachers
  teacherYearId: null,
  // Fees
  feeYear: null, feeQuery: '', feeGrade: '', feeStatus: '', openFee: null, fee: null,
  // Expenses
  expYear: null, expQuery: '', expCat: '', exp: null,
  // Reports
  repYear: null, repGrade: '', rep: null,
};

// Role checks. The database enforces the same rules; these only decide what to show.
export const isAdmin = () => ['admin', 'super_admin'].includes(state.profile?.role);
export const isSuper = () => state.profile?.role === 'super_admin';
// Everyone except a read-only viewer may enter and edit students and payments.
export const canWrite = () => ['user', 'admin', 'super_admin'].includes(state.profile?.role);
// Admins and read-only viewers may open the reports (which include spending).
export const canSeeMoney = () => ['viewer', 'admin', 'super_admin'].includes(state.profile?.role);
