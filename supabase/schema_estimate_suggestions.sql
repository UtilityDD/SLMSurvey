-- Kit suggestion workflow (run after schema.sql + schema_estimate.sql)
-- Suggestors: licenses.can_suggest = true
-- Approvers:  licenses.can_approve = true

alter table public.licenses
  add column if not exists can_suggest boolean not null default false;

alter table public.licenses
  add column if not exists can_approve boolean not null default false;

-- Ops:
--   update licenses set can_suggest = true where code = 'CODE';
--   update licenses set can_approve = true where code = 'CODE';

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
-- No public policies = Edge Functions (service role) only.
