-- Run this in Supabase SQL Editor on the SAME project where you see "Trial User"
-- Creates / upgrades your admin license

insert into public.licenses (
  code, customer_name, customer_phone, status, expires_at,
  max_devices, can_suggest, can_approve, notes
)
values (
  'SLM-ADMIN-001',
  'SLM Admin',
  '',
  'active',
  now() + interval '365 days',
  3,
  true,
  true,
  'Owner admin: suggest + approve + Publish to app'
)
on conflict (code) do update set
  status = 'active',
  customer_name = excluded.customer_name,
  expires_at = excluded.expires_at,
  max_devices = 3,
  can_suggest = true,
  can_approve = true,
  notes = excluded.notes,
  updated_at = now();

-- Also promote existing trial to admin rights (optional)
update public.licenses
set
  can_suggest = true,
  can_approve = true,
  max_devices = greatest(max_devices, 2),
  status = 'active',
  updated_at = now()
where code = 'SLM-TRIAL-001';

select code, customer_name, status, can_suggest, can_approve, max_devices, expires_at
from public.licenses
order by code;
