-- =====================================================================
-- Align the existing teachers table with the app:
--   first_name, last_name, phone, email, active
-- Keeps your imported first and last names. Safe to run more than once.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
-- =====================================================================

-- 1) Make sure every column the app uses exists.
alter table public.teachers add column if not exists first_name text;
alter table public.teachers add column if not exists last_name  text;
alter table public.teachers add column if not exists phone      text;
alter table public.teachers add column if not exists email      text;
alter table public.teachers add column if not exists active     boolean not null default true;

-- 2) If an older full_name column is still there, keep anything in it, then remove it.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'teachers' and column_name = 'full_name') then
    update public.teachers set first_name = full_name
    where first_name is null and full_name is not null;
    alter table public.teachers drop column full_name;
  end if;
end $$;

-- 3) Re-link teacher assignments and pay records to teachers if the links were lost.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.teacher_assignments'::regclass
                   and contype = 'f' and confrelid = 'public.teachers'::regclass) then
    alter table public.teacher_assignments
      add constraint teacher_assignments_teacher_id_fkey
      foreign key (teacher_id) references public.teachers(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.teacher_payments'::regclass
                   and contype = 'f' and confrelid = 'public.teachers'::regclass) then
    alter table public.teacher_payments
      add constraint teacher_payments_teacher_id_fkey
      foreign key (teacher_id) references public.teachers(id) on delete cascade;
  end if;
end $$;

-- 4) Reset the access rules for this table to the intended ones.
alter table public.teachers enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'teachers' loop
    execute format('drop policy %I on public.teachers', p.policyname);
  end loop;
end $$;

create policy "teachers read"   on public.teachers for select to authenticated using (public.is_staff());
create policy "teachers insert" on public.teachers for insert to authenticated with check (public.is_admin());
create policy "teachers update" on public.teachers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "teachers delete" on public.teachers for delete to authenticated using (public.is_super_admin());

-- 5) Check: your teachers as the app will see them.
select id, first_name, last_name, phone, email, active
from public.teachers
order by last_name, first_name;
