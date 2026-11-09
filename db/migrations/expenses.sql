-- =====================================================================
-- Expenses: make sure the table exists with the columns the app uses,
-- and that only admins can see or change it.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
-- Safe to run more than once. Existing expenses are kept.
-- =====================================================================

-- 1) The table (created only if it is missing).
create table if not exists public.expenses (
  id             bigint generated always as identity primary key,
  school_year_id bigint references public.school_years(id) on delete restrict,
  category       text not null,
  description    text,
  amount         numeric(12,2) not null check (amount >= 0),     -- GNF
  spent_on       date not null default current_date,
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- 2) If the table already existed with fewer columns, add what is missing.
alter table public.expenses add column if not exists school_year_id bigint references public.school_years(id) on delete restrict;
alter table public.expenses add column if not exists category       text;
alter table public.expenses add column if not exists description    text;
alter table public.expenses add column if not exists amount         numeric(12,2);
alter table public.expenses add column if not exists spent_on       date default current_date;
alter table public.expenses add column if not exists created_by     uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.expenses add column if not exists created_at     timestamptz not null default now();

create index if not exists expenses_year_idx on public.expenses (school_year_id);

-- 3) Expenses that have no school year yet go to the year whose dates contain them,
--    or to the current year if no dates match.
update public.expenses e
set school_year_id = coalesce(
  (select y.id from public.school_years y
   where e.spent_on between y.start_date and y.end_date limit 1),
  (select id from public.school_years where is_current limit 1))
where e.school_year_id is null;

-- 4) Access: admins only (data-entry users cannot even read expenses).
alter table public.expenses enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'expenses' loop
    execute format('drop policy %I on public.expenses', p.policyname);
  end loop;
end $$;

create policy "expenses admin all" on public.expenses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5) Check: expenses per school year.
select coalesce(y.label, '(no school year)') as school_year,
       count(e.id) as expenses,
       coalesce(sum(e.amount), 0) as total_gnf
from public.expenses e
left join public.school_years y on y.id = e.school_year_id
group by y.label
order by y.label desc nulls last;
