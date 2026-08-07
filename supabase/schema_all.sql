-- SLM ToolBox — full Supabase schema (one shot)
-- Paste into Supabase → SQL Editor → Run (or use migrate_to_survey_schema.sql on existing DBs).
-- Safe to re-run: uses IF NOT EXISTS.
--
-- Tables live in schema `survey` (keeps SmartLineman `public` tables separate).
-- public.admin_create_license is a thin wrapper for SQL Editor convenience.

create extension if not exists pgcrypto;

create schema if not exists survey;

-- ---------------------------------------------------------------------------
-- 1) Rental licenses
-- ---------------------------------------------------------------------------
create table if not exists survey.licenses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_name text not null default '',
  customer_phone text not null default '',
  status text not null default 'active'
    check (status in ('active', 'blocked', 'expired')),
  expires_at timestamptz not null,
  max_devices int not null default 1 check (max_devices between 1 and 5),
  notes text not null default '',
  can_suggest boolean not null default false,
  can_approve boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists survey.activations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references survey.licenses (id) on delete cascade,
  device_id text not null,
  device_label text not null default '',
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (license_id, device_id)
);

create index if not exists idx_licenses_code on survey.licenses (code);
create index if not exists idx_activations_device on survey.activations (device_id);

alter table survey.licenses enable row level security;
alter table survey.activations enable row level security;

create or replace function survey.normalize_license_code(raw text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(raw, ''), '\s+', '', 'g'));
$$;

create or replace function survey.admin_create_license(
  p_code text,
  p_customer text,
  p_phone text,
  p_days int default 30,
  p_max_devices int default 1
)
returns uuid
language plpgsql
security definer
set search_path = survey, public
as $$
declare
  new_id uuid;
begin
  insert into survey.licenses (code, customer_name, customer_phone, expires_at, max_devices)
  values (
    survey.normalize_license_code(p_code),
    coalesce(p_customer, ''),
    coalesce(p_phone, ''),
    now() + make_interval(days => greatest(p_days, 1)),
    greatest(least(p_max_devices, 5), 1)
  )
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.normalize_license_code(raw text)
returns text
language sql
immutable
as $$
  select survey.normalize_license_code(raw);
$$;

create or replace function public.admin_create_license(
  p_code text,
  p_customer text,
  p_phone text,
  p_days int default 30,
  p_max_devices int default 1
)
returns uuid
language sql
security definer
set search_path = survey, public
as $$
  select survey.admin_create_license(p_code, p_customer, p_phone, p_days, p_max_devices);
$$;

-- ---------------------------------------------------------------------------
-- 2) Estimate catalog (rate book + kits for mobile)
-- ---------------------------------------------------------------------------
create table if not exists survey.estimate_catalogs (
  id uuid primary key default gen_random_uuid(),
  version_label text not null,
  is_current boolean not null default false,
  ratebook jsonb not null,
  kit_matrix jsonb not null,
  kit_edits jsonb not null default '{}'::jsonb,
  survey_rules jsonb not null default '{}'::jsonb,
  notes text not null default '',
  published_at timestamptz not null default now()
);

create unique index if not exists estimate_catalogs_one_current
  on survey.estimate_catalogs (is_current)
  where is_current;

create index if not exists idx_estimate_catalogs_published
  on survey.estimate_catalogs (published_at desc);

alter table survey.estimate_catalogs enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Kit suggestions
-- ---------------------------------------------------------------------------
create table if not exists survey.estimate_suggestions (
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
  submitter_license_id uuid references survey.licenses (id) on delete set null,
  submitter_device_id text not null default '',
  submitter_code text not null default '',
  reviewer_license_id uuid references survey.licenses (id) on delete set null,
  reviewer_device_id text not null default '',
  review_note text not null default '',
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_estimate_suggestions_status
  on survey.estimate_suggestions (status, created_at desc);

create index if not exists idx_estimate_suggestions_submitter
  on survey.estimate_suggestions (submitter_license_id, created_at desc);

create index if not exists idx_estimate_suggestions_kit
  on survey.estimate_suggestions (kit_id);

alter table survey.estimate_suggestions enable row level security;

-- ---------------------------------------------------------------------------
-- Grants (RLS still blocks anon without policies; Edge Functions use service_role)
-- ---------------------------------------------------------------------------
grant usage on schema survey to postgres, anon, authenticated, service_role;
grant all on all tables in schema survey to postgres, service_role;
grant select, insert, update, delete on all tables in schema survey to anon, authenticated;
grant usage, select on all sequences in schema survey to postgres, anon, authenticated, service_role;
grant execute on all functions in schema survey to postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Optional trial
-- ---------------------------------------------------------------------------
-- select public.admin_create_license('SLM-TRIAL-001', 'Trial User', '', 14, 2);
-- update survey.licenses set can_suggest = true, can_approve = true where code = 'SLM-TRIAL-001';

-- IMPORTANT (hosted Supabase): Project Settings → API → Exposed schemas → add `survey`
-- (required for Edge Functions using db.schema = 'survey')
