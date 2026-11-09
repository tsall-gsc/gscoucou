-- =====================================================================
-- Allow several payments per term.
-- Adds "installments" (payments allowed) to each fee term and sets
-- Quarter 1 and Quarter 2 to 3 payments. Quarter 3 stays at 1.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
-- Safe to run more than once. Change the numbers later in the app:
-- Fees -> "Change fee amounts" -> "Payments allowed".
-- =====================================================================

alter table public.fee_terms
  add column if not exists installments int not null default 1
  check (installments between 1 and 6);

-- Quarter 1 and Quarter 2 (the first two terms of each year) get 3 payments,
-- only where they are still at the default of 1.
update public.fee_terms
set installments = 3
where sort_order in (1, 2) and installments = 1;

-- Check: the terms and how many payments each allows.
select y.label as school_year, t.name as term, t.amount, t.installments as payments_allowed
from public.fee_terms t
join public.school_years y on y.id = t.school_year_id
order by y.label desc, t.sort_order;
