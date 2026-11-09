-- =====================================================================
-- Load students from the staging table public.import_students
-- Run this AFTER the CSV has been imported into import_students.
-- Run it ONCE. Running it twice creates every student twice.
-- Requirements: one school year must be marked "current" in the app.
-- =====================================================================

-- 1) Create any grade that appears in the list but doesn't exist yet.
insert into public.grades (name)
select distinct trim(grade)
from public.import_students
where trim(coalesce(grade, '')) <> ''
on conflict (name) do nothing;

-- 2) Insert each student and enroll them in their grade for the current year.
do $$
declare
  r   record;
  sid bigint;
  yid bigint;
begin
  select id into yid from public.school_years where is_current limit 1;
  if yid is null then
    raise exception 'No current school year. Add one in the app and click "Make current", then run this again.';
  end if;

  for r in select * from public.import_students order by id loop
    insert into public.students (full_name, guardian_name, guardian_phone)
    values (
      trim(r.first_name || ' ' || r.last_name),
      nullif(trim(coalesce(r.guardian_name, '')), ''),
      nullif(trim(coalesce(r.guardian_phone, '')), '')
    )
    returning id into sid;

    insert into public.enrollments (student_id, school_year_id, grade_id)
    select sid, yid, g.id
    from public.grades g
    where g.name = trim(r.grade);
  end loop;
end $$;

-- 3) Quick check: students per grade for the current year.
select g.name as grade, count(*) as students
from public.enrollments e
join public.grades g on g.id = e.grade_id
join public.school_years y on y.id = e.school_year_id and y.is_current
group by g.name, g.sort_order
order by g.sort_order, g.name;
