-- =====================================================================
-- Read-only role ("viewer"): can see everything the reports need and open
-- the Reports screen, but cannot add, change or delete anything.
--
-- What a viewer can do:   read students, teachers, grades, fees, payments, and expenses
--                         (expenses are needed for the spending side of the reports)
-- What a viewer cannot:   write to any table; see staff pay (teacher_payments)
--
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
-- Run it AFTER fees.sql and expenses.sql. If you ever re-run expenses.sql,
-- fix_students_table.sql or fees.sql, run this file again afterwards: those
-- files reset the access rules this one changes.
-- Safe to run more than once.
-- =====================================================================

-- 1) The new role. (If Supabase complains about the next statement, run just that
--    one statement on its own first, then run the whole file.)
alter type public.app_role add value if not exists 'viewer';

-- 2) Two helper questions the access rules can ask.
--    The role is compared as text so this works in the same run that adds the role.
create or replace function public.can_write()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.current_app_role()::text in ('user', 'admin', 'super_admin'); $$;

create or replace function public.can_see_money()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.current_app_role()::text in ('viewer', 'admin', 'super_admin'); $$;

-- 3) Until now "signed in" meant "may enter data". From now on writing needs can_write().
--    Reading is unchanged: any signed-in user, including a viewer, can read.
drop policy if exists "students insert"    on public.students;
drop policy if exists "students update"    on public.students;
drop policy if exists "enrollments insert" on public.enrollments;
drop policy if exists "enrollments update" on public.enrollments;
drop policy if exists "payments insert"    on public.payments;

create policy "students insert"    on public.students    for insert to authenticated with check (public.can_write());
create policy "students update"    on public.students    for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "enrollments insert" on public.enrollments for insert to authenticated with check (public.can_write());
create policy "enrollments update" on public.enrollments for update to authenticated using (public.can_write()) with check (public.can_write());
create policy "payments insert"    on public.payments    for insert to authenticated with check (public.can_write());

-- 4) Expenses: admins keep full control, viewers may read.
drop policy if exists "expenses admin all" on public.expenses;
drop policy if exists "expenses read"      on public.expenses;
drop policy if exists "expenses insert"    on public.expenses;
drop policy if exists "expenses update"    on public.expenses;
drop policy if exists "expenses delete"    on public.expenses;

create policy "expenses read"   on public.expenses for select to authenticated using (public.can_see_money());
create policy "expenses insert" on public.expenses for insert to authenticated with check (public.is_admin());
create policy "expenses update" on public.expenses for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "expenses delete" on public.expenses for delete to authenticated using (public.is_admin());

-- 5) Check: who can do what, per table. Write rules should say can_write() or is_admin(),
--    never is_staff(); the only read rule that mentions can_see_money() is on expenses.
select tablename, cmd, policyname, coalesce(qual, with_check) as rule
from pg_policies
where schemaname = 'public' and tablename in ('students', 'enrollments', 'payments', 'expenses')
order by tablename, cmd, policyname;
