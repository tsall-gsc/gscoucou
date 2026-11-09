-- =====================================================================
-- Rename the grades GS and MS to GSA and MSA, to match your student list.
-- Teachers stay assigned to their class: only the name changes.
-- If GSA or MSA already exist (created by an earlier script), everything is
-- moved into them and the old GS / MS rows are removed.
-- Safe to run more than once.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
-- Afterwards, run link_student_grades.sql again.
-- =====================================================================

do $$
declare
  pair     text[];
  old_id   bigint;
  new_id   bigint;
begin
  foreach pair slice 1 in array array[array['GS', 'GSA'], array['MS', 'MSA']] loop
    select id into old_id from public.grades where name = pair[1];
    select id into new_id from public.grades where name = pair[2];

    if old_id is null then
      continue;                                   -- nothing to rename
    elsif new_id is null then
      update public.grades set name = pair[2] where id = old_id;
    else
      -- both exist: move teachers and students to the new grade, then remove the old one
      update public.teacher_assignments a
         set grade_id = new_id
       where a.grade_id = old_id
         and not exists (select 1 from public.teacher_assignments b
                         where b.teacher_id = a.teacher_id
                           and b.school_year_id = a.school_year_id
                           and b.grade_id = new_id);
      delete from public.teacher_assignments where grade_id = old_id;
      update public.enrollments set grade_id = new_id where grade_id = old_id;
      delete from public.grades where id = old_id;
    end if;
  end loop;
end $$;

-- Display order: highest class first, as in your list.
update public.grades g
set sort_order = v.n
from (values ('6A', 1), ('5A', 2), ('4A', 3), ('3A', 4), ('2A', 5),
             ('1A', 6), ('GSA', 7), ('MSA', 8), ('PSA', 9), ('PSB', 10)) as v(name, n)
where g.name = v.name;

-- Check: grades and how many students each has in the current school year.
select g.name as grade, count(e.id) as students
from public.grades g
left join public.enrollments e
       on e.grade_id = g.id
      and e.school_year_id = (select id from public.school_years where is_current limit 1)
group by g.name, g.sort_order
order by g.sort_order, g.name;
