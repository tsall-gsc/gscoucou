-- =====================================================================
-- Link each student to their grade, using the grade column already in
-- the students table. The app shows grades from "enrollments" (one row per
-- student per school year), not from that column, so this fills them in.
--
-- Before running:
--   1) Mark a school year as "current" in the app.
--   2) If your grade column is not called grade, change grade_col below.
--   3) The grades must already exist in the Grades screen (6A, 5A, ...).
--
-- Matching ignores capital letters and spaces, so "6a" and "6 A" both match "6A".
-- Safe to run more than once: students that already have a grade are skipped.
-- The result at the bottom lists students that still have no grade.
-- =====================================================================

do $$
declare
  grade_col text := 'grade';   -- <-- change this if the column has another name
  yid bigint;
begin
  select id into yid from public.school_years where is_current limit 1;
  if yid is null then
    raise exception 'No current school year. Add one in the app, click "Make current", then run this again.';
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'students' and column_name = grade_col) then
    raise exception 'The students table has no column named "%". Check the exact name in Table Editor and change grade_col at the top.', grade_col;
  end if;

  execute format($f$
    insert into public.enrollments (student_id, school_year_id, grade_id)
    select s.id, %L::bigint, g.id
    from public.students s
    join public.grades g
      on lower(regexp_replace(g.name, '\s', '', 'g')) = lower(regexp_replace(s.%I::text, '\s', '', 'g'))
    where not exists (select 1 from public.enrollments e
                      where e.student_id = s.id and e.school_year_id = %L::bigint)
  $f$, yid, grade_col, yid);
end $$;

-- Students that still have no grade for the current year.
-- Look at the grade value in their row: if it differs from your grade names, that is why.
-- No rows returned means every student now has a grade.
select s.*
from public.students s
where not exists (
  select 1
  from public.enrollments e
  join public.school_years y on y.id = e.school_year_id and y.is_current
  where e.student_id = s.id
)
order by s.full_name;
