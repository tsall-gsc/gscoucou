-- =====================================================================
-- Align the existing students table with the app, keeping your uploaded data.
-- The app uses: full_name, birth_date, guardian_name, guardian_phone, notes, active
-- Safe to run more than once.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
-- Tip: mark a school year as "current" in the app first, so a grade column
--      (if your upload has one) can be turned into enrollments.
-- =====================================================================

-- 1) Make sure every column the app uses exists.
alter table public.students add column if not exists full_name      text;
alter table public.students add column if not exists guardian_name  text;
alter table public.students add column if not exists guardian_phone text;
alter table public.students add column if not exists birth_date     date;
alter table public.students add column if not exists notes          text;
alter table public.students add column if not exists active         boolean not null default true;

-- 2) Keep data that an upload may have put under other column names.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'students' and column_name = 'first_name') then
    execute 'update public.students
             set full_name = trim(coalesce(first_name, '''') || '' '' || coalesce(last_name, ''''))
             where full_name is null';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'students' and column_name = 'parent_phone') then
    execute 'update public.students set guardian_phone = parent_phone where guardian_phone is null and parent_phone is not null';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'students' and column_name = 'phone') then
    execute 'update public.students set guardian_phone = phone where guardian_phone is null and phone is not null';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'students' and column_name = 'parent_name') then
    execute 'update public.students set guardian_name = parent_name where guardian_name is null and parent_name is not null';
  end if;
end $$;

-- 3) If the upload put the class in a "grade" column, enroll those students
--    in that grade for the current school year (creating missing grades).
do $$
declare yid bigint;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'students' and column_name = 'grade') then
    select id into yid from public.school_years where is_current limit 1;
    if yid is null then
      raise notice 'No current school year: grades from the grade column were NOT turned into enrollments. Mark a year as current and run this again.';
    else
      execute 'insert into public.grades (name)
               select distinct trim(grade) from public.students
               where trim(coalesce(grade, '''')) <> ''''
               on conflict (name) do nothing';
      execute format(
        'insert into public.enrollments (student_id, school_year_id, grade_id)
         select s.id, %L::bigint, g.id
         from public.students s
         join public.grades g on g.name = trim(s.grade)
         where not exists (select 1 from public.enrollments e
                           where e.student_id = s.id and e.school_year_id = %L::bigint)', yid, yid);
    end if;
  end if;
end $$;

-- 4) Make sure the links between tables are in place.
create unique index if not exists enrollments_student_year_key
  on public.enrollments (student_id, school_year_id);

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.enrollments'::regclass
                   and contype = 'f' and confrelid = 'public.students'::regclass) then
    alter table public.enrollments
      add constraint enrollments_student_id_fkey
      foreign key (student_id) references public.students(id) on delete cascade;
  end if;
end $$;

-- 5) Rebuild the balance view so it uses full_name (needed for the Fees screen later).
drop view if exists public.enrollment_balances;
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

-- 6) Reset the access rules for students and enrollments to the intended ones.
alter table public.students    enable row level security;
alter table public.enrollments enable row level security;

do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('students', 'enrollments') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "students read"   on public.students for select to authenticated using (public.is_staff());
create policy "students insert" on public.students for insert to authenticated with check (public.is_staff());
create policy "students update" on public.students for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "students delete" on public.students for delete to authenticated using (public.is_admin());

create policy "enrollments read"   on public.enrollments for select to authenticated using (public.is_staff());
create policy "enrollments insert" on public.enrollments for insert to authenticated with check (public.is_staff());
create policy "enrollments update" on public.enrollments for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "enrollments delete" on public.enrollments for delete to authenticated using (public.is_admin());

-- 7) Check: students per grade for the current year, and students without a grade.
select coalesce(g.name, '(no grade)') as grade, count(*) as students
from public.students s
left join public.enrollments e on e.student_id = s.id
       and e.school_year_id = (select id from public.school_years where is_current limit 1)
left join public.grades g on g.id = e.grade_id
group by g.name, g.sort_order
order by g.sort_order nulls last, g.name;
