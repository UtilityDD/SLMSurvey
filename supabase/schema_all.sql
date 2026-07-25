-- SLM ToolBox — full Supabase schema (one shot)
-- Paste this entire file into Supabase → SQL Editor → Run
-- Safe to re-run: uses IF NOT EXISTS / IF NOT EXISTS columns.
--
-- Covers: licenses, activations, estimate catalogs, kit suggestions.

-- ---------------------------------------------------------------------------
-- 1) Rental licenses
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_name text not null default '',
  customer_phone text not null default '',
  status text not null default 'active'
    check (status in ('active', 'blocked', 'expired')),
  expires_at timestamptz not null,
  max_devices int not null default 1 check (max_devices between 1 and 5),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses (id) on delete cascade,
  device_id text not null,
  device_label text not null default '',
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (license_id, device_id)
);

create index if not exists idx_licenses_code on public.licenses (code);
create index if not exists idx_activations_device on public.activations (device_id);

alter table public.licenses enable row level security;
alter table public.activations enable row level security;

create or replace function public.normalize_license_code(raw text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(raw, ''), '\s+', '', 'g'));
$$;

create or replace function public.admin_create_license(
  p_code text,
  p_customer text,
  p_phone text,
  p_days int default 30,
  p_max_devices int default 1
)
returns uuid
language plpgsql
security definer
as $$
declare
  new_id uuid;
begin
  insert into public.licenses (code, customer_name, customer_phone, expires_at, max_devices)
  values (
    public.normalize_license_code(p_code),
    coalesce(p_customer, ''),
    coalesce(p_phone, ''),
    now() + make_interval(days => greatest(p_days, 1)),
    greatest(least(p_max_devices, 5), 1)
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Estimate catalog (rate book + kits for mobile)
-- ---------------------------------------------------------------------------
create table if not exists public.estimate_catalogs (
  id uuid primary key default gen_random_uuid(),
  version_label text not null,
  is_current boolean not null default false,
  ratebook jsonb not null,
  kit_matrix jsonb not null,
  kit_edits jsonb not null default '{}'::jsonb,
  notes text not null default '',
  published_at timestamptz not null default now()
);

create unique index if not exists estimate_catalogs_one_current
  on public.estimate_catalogs (is_current)
  where is_current;

create index if not exists idx_estimate_catalogs_published
  on public.estimate_catalogs (published_at desc);

alter table public.estimate_catalogs enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Kit suggestions (can_suggest / can_approve)
-- ---------------------------------------------------------------------------
alter table public.licenses
  add column if not exists can_suggest boolean not null default false;

alter table public.licenses
  add column if not exists can_approve boolean not null default false;

create table if not exists public.estimate_suggestions (
  id uuid primary key default gen_random_uuid(),
  kit_id text not null,
  kit_family text not null default 'structure'
    check (kit_family in ('structure', 'conductor', 'addon')),
  kit_label text not null default '',
  base_version_label text not null default '',
  proposed jsonb not null,
  message text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  submitter_license_id uuid references public.licenses (id) on delete set null,
  submitter_device_id text not null default '',
  submitter_code text not null default '',
  reviewer_license_id uuid references public.licenses (id) on delete set null,
  reviewer_device_id text not null default '',
  review_note text not null default '',
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_estimate_suggestions_status
  on public.estimate_suggestions (status, created_at desc);

create index if not exists idx_estimate_suggestions_submitter
  on public.estimate_suggestions (submitter_license_id, created_at desc);

create index if not exists idx_estimate_suggestions_kit
  on public.estimate_suggestions (kit_id);

alter table public.estimate_suggestions enable row level security;

-- ---------------------------------------------------------------------------
-- Optional: first trial license (uncomment and change the code)
-- ---------------------------------------------------------------------------
-- select public.admin_create_license('SLM-TRIAL-001', 'Trial User', '', 14, 2);
-- update licenses set can_suggest = true, can_approve = true where code = 'SLM-TRIAL-001';
