-- Move SLM Survey / licensing / estimate tables out of public → survey.
-- Safe to re-run. Does not touch SmartLineman app tables (profiles, quiz, …).

begin;

create schema if not exists survey;

-- Move tables if they still live in public
do $$
begin
  if to_regclass('public.licenses') is not null
     and to_regclass('survey.licenses') is null then
    alter table public.licenses set schema survey;
  end if;

  if to_regclass('public.activations') is not null
     and to_regclass('survey.activations') is null then
    alter table public.activations set schema survey;
  end if;

  if to_regclass('public.estimate_catalogs') is not null
     and to_regclass('survey.estimate_catalogs') is null then
    alter table public.estimate_catalogs set schema survey;
  end if;

  if to_regclass('public.estimate_suggestions') is not null
     and to_regclass('survey.estimate_suggestions') is null then
    alter table public.estimate_suggestions set schema survey;
  end if;
end $$;

-- Helpers live in survey; thin public wrappers keep SQL Editor commands working
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

-- API / roles (RLS still blocks anon direct access without policies)
grant usage on schema survey to postgres, anon, authenticated, service_role;

grant all on all tables in schema survey to postgres, service_role;
grant select, insert, update, delete on all tables in schema survey to anon, authenticated;

grant usage, select on all sequences in schema survey to postgres, anon, authenticated, service_role;
grant execute on all functions in schema survey to postgres, anon, authenticated, service_role;

alter default privileges in schema survey
  grant all on tables to postgres, service_role;
alter default privileges in schema survey
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema survey
  grant execute on functions to anon, authenticated, service_role;

commit;

-- Verify (optional)
-- select table_schema, table_name from information_schema.tables
-- where table_name in ('licenses','activations','estimate_catalogs','estimate_suggestions')
-- order by 1,2;
