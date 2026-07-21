-- SLM ToolBox rental licenses (run in Supabase SQL Editor)
-- Step 1 of rental licensing setup.

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

-- App never reads tables directly with anon key — only Edge Functions with service role.
alter table public.licenses enable row level security;
alter table public.activations enable row level security;

-- No public policies = blocked for anon/authenticated clients.

-- Helper: normalize license codes (uppercase, strip spaces)
create or replace function public.normalize_license_code(raw text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(raw, ''), '\s+', '', 'g'));
$$;

-- Admin helper: create a 30-day rental (run in SQL editor)
-- select public.admin_create_license('ACME-DEMO-001', 'Test Customer', '9999999999', 30, 1);
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

-- Sample seed (optional — change code before production)
-- select public.admin_create_license('SLM-TRIAL-001', 'Trial User', '', 14, 1);
