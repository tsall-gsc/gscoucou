-- =====================================================================
-- Move the payments from q1_payments, q2_payments and q3_payments into
-- the payments table that the Fees screen uses.
--   q1_payments -> Quarter 1,  q2_payments -> Quarter 2,  q3_payments -> Quarter 3
-- Each row keeps its student (enrollment), amount, date, method and note.
--
-- Before running:
--   1) Run fees.sql, so the three fee terms exist for the school year.
--   2) Students must be linked to their grades (enrollments), because the
--      payments in your tables point to those enrollments.
--
-- Safe to run more than once: payments already moved are not added again.
-- If anything is wrong (an unknown student, a missing term, a zero amount) the
-- script stops with a clear message and imports NOTHING.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
-- =====================================================================

do $$
declare
  tbl text;
  q   int;
  n   int;
begin
  foreach tbl in array array['q1_payments', 'q2_payments', 'q3_payments'] loop
    q := substring(tbl from 2 for 1)::int;          -- 1, 2 or 3

    -- Check: every payment points to an existing enrollment.
    execute format(
      'select count(*) from public.%I p
       where not exists (select 1 from public.enrollments e where e.id = p.enrollment_id)', tbl) into n;
    if n > 0 then
      raise exception '% row(s) in % point to an enrollment that does not exist. Nothing was imported.', n, tbl;
    end if;

    -- Check: the amounts are real amounts.
    execute format('select count(*) from public.%I where amount is null or amount <= 0', tbl) into n;
    if n > 0 then
      raise exception '% row(s) in % have an empty, zero or negative amount. Fix them, then run this again. Nothing was imported.', n, tbl;
    end if;

    -- Check: the school year of each payment has this quarter''s fee term.
    execute format(
      'select count(*) from public.%I p
       join public.enrollments e on e.id = p.enrollment_id
       where not exists (select 1 from public.fee_terms t
                         where t.school_year_id = e.school_year_id and t.sort_order = %s)', tbl, q) into n;
    if n > 0 then
      raise exception '% row(s) in % belong to a school year that has no fee term number %. Run fees.sql or create the terms in the Fees screen first. Nothing was imported.', n, tbl, q;
    end if;

    -- Import (skipping payments that were already moved).
    execute format($f$
      insert into public.payments (enrollment_id, term_id, amount, paid_on, method, note, created_by, created_at)
      select p.enrollment_id,
             t.id,
             p.amount,
             coalesce(p.paid_on, p.created_at::date, current_date),
             p.method,
             p.note,
             case when exists (select 1 from auth.users u where u.id = p.created_by) then p.created_by end,
             coalesce(p.created_at, now())
      from public.%I p
      join public.enrollments e on e.id = p.enrollment_id
      join public.fee_terms t on t.school_year_id = e.school_year_id and t.sort_order = %s
      where not exists (select 1 from public.payments x
                        where x.enrollment_id = p.enrollment_id
                          and x.term_id = t.id
                          and x.amount = p.amount
                          and x.paid_on = coalesce(p.paid_on, p.created_at::date, current_date)
                          and coalesce(x.note, '') = coalesce(p.note, ''))
    $f$, tbl, q);
  end loop;
end $$;

-- Check: what was in your tables compared with what the app now holds for the
-- current school year. The "in app" columns should match the "in source" columns.
with src as (
  select 1 as q, count(*) as n, coalesce(sum(amount), 0) as total from public.q1_payments
  union all
  select 2, count(*), coalesce(sum(amount), 0) from public.q2_payments
  union all
  select 3, count(*), coalesce(sum(amount), 0) from public.q3_payments
), dst as (
  select t.sort_order as q, count(p.id) as n, coalesce(sum(p.amount), 0) as total
  from public.fee_terms t
  left join public.payments p on p.term_id = t.id
  where t.school_year_id = (select id from public.school_years where is_current limit 1)
  group by t.sort_order
)
select q as quarter,
       src.n     as rows_in_source,
       src.total as total_in_source,
       dst.n     as rows_in_app,
       dst.total as total_in_app
from src
left join dst using (q)
order by q;
