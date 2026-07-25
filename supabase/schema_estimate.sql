-- SLM ToolBox estimate catalog (run in Supabase SQL Editor after schema.sql)
-- Same project as rental licensing. Survey/GPS stay local — this is rate book + kits only.

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
-- No public policies = blocked for anon/authenticated. Edge Functions use service role.
