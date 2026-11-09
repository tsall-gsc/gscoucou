-- =====================================================================
-- School management app: Supabase schema + role rules
-- Run ONCE in a fresh project: Supabase Dashboard -> SQL Editor -> New query
-- Roles: super_admin (everything, manages users), admin (manages data),
--        user (data entry: students, enrollments, payments)
-- =====================================================================

-- ---------- 1. Roles and profiles ----------
create type public.app_role as enum ('super_admin', 'admin', 'user');

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       public.app_role not null default 'user',
  created_at timestamptz not null default now()
);

-- Every new login automatically gets a profile with the lowest role.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', 'user');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. Role helper functions (used by the policies) ----------
create function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

create function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.current_app_role() is not null; $$;

create function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.current_app_role() in ('admin', 'super_admin'); $$;

create function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.current_app_role() = 'super_admin'; $$;

-- ---------- 3. Tables ----------
create table public.school_years (
  id         bigint generated always as identity primary key,
  label      text not null unique,            -- e.g. '2026-2027'
  start_date date,
  end_date   date,
  is_current boolean not null default false
);

create table public.grades (
  id         bigint generated always as identity primary key,
  name       text not null unique,            -- e.g. 'CP', 'CE1', 'Grade 3'
  sort_order int  not null default 0
);

create table public.teachers (
  id         bigint generated always as identity primary key,
  first_name text not null,
  last_name  text not null,
  phone      text,
  email      text,
  active     boolean not null default true
);

create table public.teacher_assignments (
  id             bigint generated always as identity primary key,
  teacher_id     bigint not null references public.teachers(id) on delete cascade,
  grade_id       bigint not null references public.grades(id) on delete restrict,
  school_year_id bigint not null references public.school_years(id) on delete restrict,
  unique (teacher_id, grade_id, school_year_id)
);

create table public.students (
  id             bigint generated always as identity primary key,
  full_name      text not null,
  birth_date     date,
  guardian_name  text,
  guardian_phone text,
  notes          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- One row per student per school year: which grade they are in and their fee.
create table public.enrollments (
  id             bigint generated always as identity primary key,
  student_id     bigint not null references public.students(id) on delete cascade,
  school_year_id bigint not null references public.school_years(id) on delete restrict,
  grade_id       bigint not null references public.grades(id) on delete restrict,
  annual_fee     numeric(12,2) not null default 0 check (annual_fee >= 0),
  unique (student_id, school_year_id)
);

-- Fee payments received from families.
create table public.payments (
  id            bigint generated always as identity primary key,
  enrollment_id bigint not null references public.enrollments(id) on delete cascade,
  amount        numeric(12,2) not null check (amount > 0),
  paid_on       date not null default current_date,
  method        text,                         -- cash, transfer, ...
  note          text,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- School expenses.
create table public.expenses (
  id             bigint generated always as identity primary key,
  school_year_id bigint references public.school_years(id) on delete restrict,
  category       text not null,
  description    text,
  amount         numeric(12,2) not null check (amount >= 0),
  spent_on       date not null default current_date,
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Teacher / staff pay (admin-only, replaces the staff pay Excel file).
create table public.teacher_payments (
  id         bigint generated always as identity primary key,
  teacher_id bigint not null references public.teachers(id) on delete cascade,
  amount     numeric(12,2) not null check (amount >= 0),
  pay_month  date not null,                   -- use the 1st of the month
  paid_on    date,
  note       text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);

-- Indexes on foreign keys (keeps lookups fast as data grows).
create index on public.teacher_assignments (grade_id, school_year_id);
create index on public.enrollments (school_year_id, grade_id);
create index on public.payments (enrollment_id);
create index on public.expenses (school_year_id);
create index on public.teacher_payments (teacher_id, pay_month);

-- ---------- 4. Balance view (what each student owes) ----------
create view public.enrollment_balances
with (security_invoker = true) as
select
  e.id            as enrollment_id,
  e.school_year_id,
  e.grade_id,
  s.id            as student_id,
  s.full_name,
  e.annual_fee,
  coalesce(sum(p.amount), 0)                 as total_paid,
  e.annual_fee - coalesce(sum(p.amount), 0)  as balance
from public.enrollments e
join public.students s on s.id = e.student_id
left join public.payments p on p.enrollment_id = e.id
group by e.id, s.id;

-- ---------- 5. Row-level security (this is what enforces the roles) ----------
alter table public.profiles            enable row level security;
alter table public.school_years        enable row level security;
alter table public.grades              enable row level security;
alter table public.teachers            enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.students            enable row level security;
alter table public.enrollments         enable row level security;
alter table public.payments            enable row level security;
alter table public.expenses            enable row level security;
alter table public.teacher_payments    enable row level security;

-- profiles: you can read your own; admins can read all; only super admin edits roles.
create policy "profiles read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "profiles super admin update" on public.profiles
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy "profiles super admin delete" on public.profiles
  for delete to authenticated using (public.is_super_admin());

-- Reference data (school years, grades, teachers, assignments):
-- everyone signed in can read; admins write; only super admin deletes.
create policy "school_years read"   on public.school_years for select to authenticated using (public.is_staff());
create policy "school_years insert" on public.school_years for insert to authenticated with check (public.is_admin());
create policy "school_years update" on public.school_years for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "school_years delete" on public.school_years for delete to authenticated using (public.is_super_admin());

create policy "grades read"   on public.grades for select to authenticated using (public.is_staff());
create policy "grades insert" on public.grades for insert to authenticated with check (public.is_admin());
create policy "grades update" on public.grades for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "grades delete" on public.grades for delete to authenticated using (public.is_super_admin());

create policy "teachers read"   on public.teachers for select to authenticated using (public.is_staff());
create policy "teachers insert" on public.teachers for insert to authenticated with check (public.is_admin());
create policy "teachers update" on public.teachers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "teachers delete" on public.teachers for delete to authenticated using (public.is_super_admin());

create policy "assignments read"   on public.teacher_assignments for select to authenticated using (public.is_staff());
create policy "assignments insert" on public.teacher_assignments for insert to authenticated with check (public.is_admin());
create policy "assignments update" on public.teacher_assignments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "assignments delete" on public.teacher_assignments for delete to authenticated using (public.is_admin());

-- Students and enrollments: data-entry users can read, add and edit; admins delete.
create policy "students read"   on public.students for select to authenticated using (public.is_staff());
create policy "students insert" on public.students for insert to authenticated with check (public.is_staff());
create policy "students update" on public.students for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "students delete" on public.students for delete to authenticated using (public.is_admin());

create policy "enrollments read"   on public.enrollments for select to authenticated using (public.is_staff());
create policy "enrollments insert" on public.enrollments for insert to authenticated with check (public.is_staff());
create policy "enrollments update" on public.enrollments for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "enrollments delete" on public.enrollments for delete to authenticated using (public.is_admin());

-- Payments: data-entry users can read and record; only admins correct or delete.
create policy "payments read"   on public.payments for select to authenticated using (public.is_staff());
create policy "payments insert" on public.payments for insert to authenticated with check (public.is_staff());
create policy "payments update" on public.payments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "payments delete" on public.payments for delete to authenticated using (public.is_admin());

-- Expenses and teacher pay: admins only (data-entry users cannot even read them).
create policy "expenses admin all" on public.expenses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "teacher_payments admin all" on public.teacher_payments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 6. Make yourself super admin (run AFTER creating your login) ----------
-- 1) Dashboard -> Authentication -> Users -> Add user (tick "Auto confirm user").
-- 2) Replace the email below with yours and run this single statement:
--
-- update public.profiles
-- set role = 'super_admin', full_name = 'Your Name'
-- where id = (select id from auth.users where email = 'you@example.com');
