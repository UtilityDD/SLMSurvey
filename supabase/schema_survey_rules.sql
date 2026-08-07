-- Add survey_rules JSON to estimate catalogs (phone combination rules; kits stay optional).
-- Run in Supabase SQL Editor after schema_estimate / schema_all.

alter table if exists public.estimate_catalogs
  add column if not exists survey_rules jsonb not null default '{}'::jsonb;

alter table if exists survey.estimate_catalogs
  add column if not exists survey_rules jsonb not null default '{}'::jsonb;
