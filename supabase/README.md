# SLM ToolBox — Supabase rental licensing

Survey / map / GPS stay **local**. Supabase is used only for activate + validate.

## Step 1 — Create project & tables

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste and run `schema.sql`.
3. Create a trial license:

```sql
select public.admin_create_license('SLM-TRIAL-001', 'Trial User', '', 14, 1);
```

## Step 2 — Deploy Edge Functions

```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy license-activate --no-verify-jwt
supabase functions deploy license-validate --no-verify-jwt
```

Functions use `SUPABASE_SERVICE_ROLE_KEY` automatically in hosted Supabase.

## Step 3 — Configure the Android app

In project root `local.properties` (never commit secrets to git if you prefer; anon key is public-ish but keep URL private if you want):

```properties
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
```

If these are **empty**, the app runs in **dev mode** (no license gate) so local builds keep working.

## API contract

### POST `/functions/v1/license-activate`
```json
{ "code": "SLM-TRIAL-001", "device_id": "...", "device_label": "Pixel 7" }
```
Success:
```json
{ "ok": true, "customer_name": "...", "expires_at": "2026-08-01T00:00:00Z", "grace_days": 7 }
```

### POST `/functions/v1/license-validate`
```json
{ "device_id": "..." }
```

Errors: `invalid_code`, `expired`, `blocked`, `device_limit`, `not_activated`

## Ops (your rental workflow)

| Action | SQL |
|--------|-----|
| New 30-day rental (phone + desktop) | `select admin_create_license('CODE', 'Name', 'Phone', 30, 2);` |
| New 30-day rental (phone only) | `select admin_create_license('CODE', 'Name', 'Phone', 30, 1);` |
| Allow existing code on desktop too | `update licenses set max_devices = 2 where code='CODE';` |
| Extend 30 days | `update licenses set expires_at = expires_at + interval '30 days', status='active' where code='CODE';` |
| Block unpaid | `update licenses set status='blocked' where code='CODE';` |
| See devices | `select * from activations a join licenses l on l.id=a.license_id where l.code='CODE';` |

**Same key for phone + desktop editor:** create or update the license with `max_devices = 2`. The desktop editor (`sld_editor/`) uses the same activate/validate Edge Functions and the same code the user enters on Android.

## Speed

- Activate: once per install  
- Validate: on app open + at most once / 12h when online  
- Map/GPS never call Supabase  
