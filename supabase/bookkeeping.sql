-- =====================================================================
--  Quotes & Invoices — bookkeeping add-on
--  Run once in Supabase → SQL Editor → New query → Run
--  (after schema.sql). Safe to run again.
-- =====================================================================

-- Payments received against invoices
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  invoice_id uuid,
  pay_date   date,
  amount     numeric(14, 2) not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Business expenses and supplier bills (payables)
create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exp_date   date,
  category   text not null default '',
  supplier   text not null default '',
  total      numeric(14, 2) not null default 0,
  vat        numeric(14, 2) not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Columns for supplier bills (safe to run again)
alter table public.expenses add column if not exists due_date date;
alter table public.expenses add column if not exists status   text not null default 'Paid';

create index if not exists payments_user_date_idx on public.payments (user_id, pay_date desc);
create index if not exists payments_invoice_idx   on public.payments (invoice_id);
create index if not exists expenses_user_date_idx on public.expenses (user_id, exp_date desc);

alter table public.payments enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "own payments" on public.payments;
drop policy if exists "own expenses" on public.expenses;

create policy "own payments" on public.payments
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own expenses" on public.expenses
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Private storage for receipt photos and PDFs (max 10 MB each).
-- Each user can only reach files inside their own folder.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "receipts read own"   on storage.objects;
drop policy if exists "receipts add own"    on storage.objects;
drop policy if exists "receipts change own" on storage.objects;
drop policy if exists "receipts remove own" on storage.objects;

create policy "receipts read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "receipts add own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "receipts change own" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "receipts remove own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
