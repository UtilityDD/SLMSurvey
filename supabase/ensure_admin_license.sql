-- Ensure admin license exists in survey.licenses (SQL Editor).
insert into survey.licenses (
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
  'Desktop admin — suggest, approve, publish, licenses'
)
on conflict (code) do update set
  status = 'active',
  can_suggest = true,
  can_approve = true,
  max_devices = greatest(survey.licenses.max_devices, 3),
  expires_at = greatest(survey.licenses.expires_at, excluded.expires_at),
  updated_at = now();

-- Optional: also allow trial to suggest (not approve)
update survey.licenses
set can_suggest = true
where code = 'SLM-TRIAL-001';

select code, customer_name, status, can_suggest, can_approve, max_devices, expires_at
from survey.licenses
order by code;
