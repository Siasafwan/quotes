-- =====================================================================
--  Quotation & Invoice Studio — database setup
--  Run this once in Supabase → SQL Editor → New query → Run.
--  Safe to run again (it only creates what is missing).
-- =====================================================================

-- Company settings (one row per user)
create table if not exists public.settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Saved clients
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null default '',
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Quotations and invoices
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  doc_type    text not null check (doc_type in ('quote', 'invoice')),
  number      text not null,
  status      text not null default 'Draft',
  client_name text not null default '',
  issue_date  date,
  total       numeric(14, 2) not null default 0,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, doc_type, number)
);

create index if not exists documents_user_type_idx on public.documents (user_id, doc_type, issue_date desc);
create index if not exists clients_user_idx on public.clients (user_id, name);

-- ---------------------------------------------------------------------
-- Row Level Security: each signed-in user can only see and change
-- their own rows. Nobody without a login can read anything.
-- ---------------------------------------------------------------------
alter table public.settings  enable row level security;
alter table public.clients   enable row level security;
alter table public.documents enable row level security;

drop policy if exists "own settings"  on public.settings;
drop policy if exists "own clients"   on public.clients;
drop policy if exists "own documents" on public.documents;

create policy "own settings" on public.settings
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own clients" on public.clients
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own documents" on public.documents
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
