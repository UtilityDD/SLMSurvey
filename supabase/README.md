# SLM ToolBox — Supabase rental licensing + estimate catalog

Survey / map / GPS stay **local**. Supabase is used for:

1. License activate + validate  
2. Estimate catalog publish + download (rate book + kits) for activated devices  
3. Kit edit suggestions (`can_suggest`) and accept/reject (`can_approve`)

## Step 1 — Create project & tables

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste and run **`schema_all.sql`** once (licenses + estimate catalog + suggestions).

   Or run separately in order: `schema.sql` → `schema_estimate.sql` → `schema_estimate_suggestions.sql`.

3. Create a trial license:

```sql
select public.admin_create_license('SLM-TRIAL-001', 'Trial User', '', 14, 1);
```

Grant suggestion / approval rights:

```sql
update licenses set can_suggest = true where code = 'SUGGESTOR-CODE';
update licenses set can_approve = true where code = 'APPROVER-CODE';
-- One license can have both flags if needed:
-- update licenses set can_suggest = true, can_approve = true where code = 'ADMIN-CODE';
```

## Step 2 — Deploy Edge Functions

```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy license-activate --no-verify-jwt
supabase functions deploy license-validate --no-verify-jwt
supabase functions deploy catalog-current --no-verify-jwt
supabase functions deploy catalog-publish --no-verify-jwt
supabase functions deploy catalog-suggest --no-verify-jwt
supabase functions deploy catalog-suggestions-list --no-verify-jwt
supabase functions deploy catalog-suggestion-review --no-verify-jwt
```

Set a publish secret (desktop/CLI only — never the service role key in the browser):

```bash
supabase secrets set CATALOG_PUBLISH_KEY=your-long-random-string
```

Functions use `SUPABASE_SERVICE_ROLE_KEY` automatically in hosted Supabase.

## Step 3 — Configure the Android app

In project root `local.properties`:

```properties
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
```

If these are **empty**, the app runs in **dev mode** (no license gate; catalog sync skipped).

## Step 4 — Publish the estimate catalog

After Assembly Builder kits look good, publish so phones can download:

**Option A — Desktop UI**  
Open `sld_editor/estimate/` → **Publish to app** (uses `license-config.js`; prompts for publish key if blank).

**Option B — CLI**

```bash
set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
set SUPABASE_ANON_KEY=...
set CATALOG_PUBLISH_KEY=...
python supabase/scripts/publish_catalog.py --notes "initial seed"
```

## Kit suggestions (estimate maker)

Flow: **Suggest** → **Accept/Reject** → **Publish to app** (accepted merges into local kit edits only; phones update on publish).

| Role | License flag | UI |
|------|----------------|-----|
| Suggestor | `can_suggest` | Kit editor → **Suggest change** |
| Approver | `can_approve` | **Suggestions** tab → Accept into maker / Reject |
| Publisher | `CATALOG_PUBLISH_KEY` | **Publish to app** |

Activate/validate responses include `can_suggest` and `can_approve` so the desktop UI shows the right controls.

## API contract

### POST `/functions/v1/license-activate`
```json
{ "code": "SLM-TRIAL-001", "device_id": "...", "device_label": "Pixel 7" }
```
Success includes `can_suggest`, `can_approve`.

### POST `/functions/v1/license-validate`
```json
{ "device_id": "..." }
```

### POST `/functions/v1/catalog-current`
Activated devices only. Sends optional `version_label` to skip re-download when unchanged.

```json
{ "device_id": "...", "version_label": "seed-1-2026-07-25" }
```

Success (payload): `ratebook`, `kit_matrix`, `kit_edits`, `version_label`, `published_at`  
Success (same version): `{ "ok": true, "unchanged": true, "version_label": "..." }`  
Errors: `not_activated`, `expired`, `blocked`, `no_catalog`

### POST `/functions/v1/catalog-publish`
```json
{
  "publish_key": "...",
  "version_label": "seed-1-2026-07-25",
  "notes": "",
  "ratebook": { ... },
  "kit_matrix": { ... },
  "kit_edits": { ... }
}
```

### POST `/functions/v1/catalog-suggest`
Requires activated device + `can_suggest`.

```json
{
  "device_id": "...",
  "kit_id": "...",
  "kit_family": "structure",
  "kit_label": "11kV · 2P · …",
  "base_version_label": "1",
  "proposed": { "enabled": true, "complete": false, "lines": [], "notes": "" },
  "message": "optional"
}
```

### POST `/functions/v1/catalog-suggestions-list`
Requires `can_approve` (all) or `can_suggest` (own only). Optional `status`: `pending` | `accepted` | `rejected`.

### POST `/functions/v1/catalog-suggestion-review`
Requires `can_approve`.

```json
{ "device_id": "...", "suggestion_id": "...", "action": "accept", "review_note": "" }
```

`action`: `accept` | `reject`. Accept returns `kit_id` + `proposed` for Assembly Builder merge (does **not** auto-publish).

## Android behaviour

- After successful activate / periodic license refresh, `CatalogApi` pulls the current catalog.
- Cached under app files: `estimate_catalog/ratebook.json`, `kit_matrix.json`, `kit_edits.json`.
- License prefs also store `can_suggest` / `can_approve` for a future mobile suggest UI.
- Survey/map paths never call these endpoints.

## Ops (your rental workflow)

| Action | SQL |
|--------|-----|
| New 30-day rental (phone + desktop) | `select admin_create_license('CODE', 'Name', 'Phone', 30, 2);` |
| New 30-day rental (phone only) | `select admin_create_license('CODE', 'Name', 'Phone', 30, 1);` |
| Allow existing code on desktop too | `update licenses set max_devices = 2 where code='CODE';` |
| Allow kit suggestions | `update licenses set can_suggest = true where code='CODE';` |
| Allow accept/reject | `update licenses set can_approve = true where code='CODE';` |
| Extend 30 days | `update licenses set expires_at = expires_at + interval '30 days', status='active' where code='CODE';` |
| Block unpaid | `update licenses set status='blocked' where code='CODE';` |
| See devices | `select * from activations a join licenses l on l.id=a.license_id where l.code='CODE';` |
| See current catalog | `select version_label, published_at, notes from estimate_catalogs where is_current;` |
| Pending suggestions | `select id, kit_label, submitter_code, created_at from estimate_suggestions where status='pending';` |

**Same key for phone + desktop editor:** create or update the license with `max_devices = 2`.

## Speed

- Activate: once per install  
- Validate: on app open + at most once / 12h when online  
- Catalog: after license OK; full download only when `version_label` changes (else tiny “unchanged”); at most ~6h between checks  
- Map/GPS never call Supabase  
