-- =====================================================================
-- Fees: the terms of each school year, and payments linked to a term.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
-- Mark a school year as "current" in the app first, so the three standard
-- terms can be created for it:
--   Quarter 1 (Oct-Dec) 800,000 GNF, Quarter 2 (Jan-Mar) 350,000 GNF,
--   Quarter 3 (Apr-Jun) 50,000 GNF.
-- Also recreates the payments table if it is missing.
-- Safe to run more than once.
-- =====================================================================

-- 1) Terms: the same fee schedule applies to every student of a school year.
create table if not exists public.fee_terms (
  id             bigint generated always as identity primary key,
  school_year_id bigint not null references public.school_years(id) on delete cascade,
  name           text not null,
  amount         numeric(12,0) not null check (amount >= 0),   -- GNF, no decimals
  sort_order     int not null default 0,
  installments   int not null default 1 check (installments between 1 and 6),   -- payments allowed in the term
  unique (school_year_id, name)
);
-- If the table already existed without the installments column, add it.
alter table public.fee_terms
  add column if not exists installments int not null default 1 check (installments between 1 and 6);

-- 2) Payments: create the table if it is missing, and link each payment to one term.
create table if not exists public.payments (
  id            bigint generated always as identity primary key,
  enrollment_id bigint not null references public.enrollments(id) on delete cascade,
  term_id       bigint references public.fee_terms(id) on delete restrict,
  amount        numeric(12,2) not null check (amount > 0),
  paid_on       date not null default current_date,
  method        text,
  note          text,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
-- If the table already existed without the term link, add it.
alter table public.payments
  add column if not exists term_id bigint references public.fee_terms(id) on delete restrict;
create index if not exists payments_term_idx       on public.payments (term_id);
create index if not exists payments_enrollment_idx on public.payments (enrollment_id);

-- 3) Access rules: everyone signed in can read the terms; only admins change them.
alter table public.fee_terms enable row level security;
alter table public.payments  enable row level security;

drop policy if exists "fee_terms read"   on public.fee_terms;
drop policy if exists "fee_terms insert" on public.fee_terms;
drop policy if exists "fee_terms update" on public.fee_terms;
drop policy if exists "fee_terms delete" on public.fee_terms;

create policy "fee_terms read"   on public.fee_terms for select to authenticated using (public.is_staff());
create policy "fee_terms insert" on public.fee_terms for insert to authenticated with check (public.is_admin());
create policy "fee_terms update" on public.fee_terms for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "fee_terms delete" on public.fee_terms for delete to authenticated using (public.is_super_admin());

-- Payments: everyone signed in can read and record; only admins correct or delete.
drop policy if exists "payments read"   on public.payments;
drop policy if exists "payments insert" on public.payments;
drop policy if exists "payments update" on public.payments;
drop policy if exists "payments delete" on public.payments;

create policy "payments read"   on public.payments for select to authenticated using (public.is_staff());
create policy "payments insert" on public.payments for insert to authenticated with check (public.is_staff());
create policy "payments update" on public.payments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "payments delete" on public.payments for delete to authenticated using (public.is_admin());

-- 4) Create the three standard terms for the current school year (only if it has none yet).
do $$
declare yid bigint;
begin
  select id into yid from public.school_years where is_current limit 1;
  if yid is not null and not exists (select 1 from public.fee_terms where school_year_id = yid) then
    insert into public.fee_terms (school_year_id, name, amount, sort_order, installments) values
      (yid, 'Quarter 1 (Oct–Dec)', 800000, 1, 3),
      (yid, 'Quarter 2 (Jan–Mar)', 350000, 2, 3),
      (yid, 'Quarter 3 (Apr–Jun)',  50000, 3, 1);
  end if;
end $$;

-- 5) Balance view for reports: what each student owes, based on the terms.
drop view if exists public.enrollment_balances;
create view public.enrollment_balances
with (security_invoker = true) as
select
  e.id as enrollment_id,
  e.school_year_id,
  e.grade_id,
  s.id as student_id,
  s.full_name,
  coalesce(t.total_due, 0)  as total_due,
  coalesce(p.total_paid, 0) as total_paid,
  coalesce(t.total_due, 0) - coalesce(p.total_paid, 0) as balance
from public.enrollments e
join public.students s on s.id = e.student_id
left join (select school_year_id, sum(amount) as total_due
           from public.fee_terms group by school_year_id) t on t.school_year_id = e.school_year_id
left join (select enrollment_id, sum(amount) as total_paid
           from public.payments group by enrollment_id) p on p.enrollment_id = e.id;

-- 6) Check: the terms that now exist.
select y.label as school_year, t.name as term, t.amount
from public.fee_terms t
join public.school_years y on y.id = t.school_year_id
order by y.label desc, t.sort_order;
