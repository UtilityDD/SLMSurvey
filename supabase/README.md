# SLM ToolBox — Supabase rental licensing + estimate catalog

Survey / map / GPS stay **local**. Supabase is used for:

1. License activate + validate  
2. Estimate catalog publish + download (rate book + kits) for activated devices  
3. Kit edit suggestions (`can_suggest`) and accept/reject (`can_approve`)

On the SmartLineman project, these tables live in schema **`survey`** (not mixed with quiz/forum `public` tables).

## Step 1 — Create project & tables

1. Create a project at [supabase.com](https://supabase.com) **or** use your existing SmartLineman project.
2. SQL Editor → paste and run **`schema_all.sql`** once (creates `survey` schema + tables).

   **Existing DB already has tables in `public`:** run **`migrate_to_survey_schema.sql`** instead.

3. **Expose the schema** (required): Dashboard → **Project Settings → Data API** → **Exposed schemas** → add `survey` (keep `public`).

4. Create a trial license:

```sql
select public.admin_create_license('SLM-TRIAL-001', 'Trial User', '', 14, 2);
```

Grant suggestion / approval rights:

```sql
update survey.licenses set can_suggest = true where code = 'SUGGESTOR-CODE';
update survey.licenses set can_approve = true where code = 'APPROVER-CODE';
```

In Table Editor, switch schema dropdown to **`survey`** to see licenses / catalogs.
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
supabase functions deploy license-admin --no-verify-jwt
```

Set a publish secret (desktop/CLI only — never the service role key in the browser):

```bash
supabase secrets set CATALOG_PUBLISH_KEY=your-long-random-string

# Optional — separate key for Phone rules → Publish to app (keeps CATALOG_PUBLISH_KEY unchanged)
supabase secrets set SURVEY_RULES_PUBLISH_KEY=another-long-random-string
```

Functions use `SUPABASE_SERVICE_ROLE_KEY` automatically in hosted Supabase.

## Step 3 — Configure the Android app

In project root `local.properties`:

```properties
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
```

If these are **empty**, the app runs in **dev mode** (no license gate; catalog sync skipped).

## Step 4 — Publish phone rules / catalog

**Phone structure combinations (usual):**  
Desktop → **Rates → Phone rules → Publish to app**  
Uses Supabase secret **`SURVEY_RULES_PUBLISH_KEY`** (does not change `CATALOG_PUBLISH_KEY`).

**Full Mat/Lab + kits archive:**  
`sld_editor/estimate/` → **Publish full catalog** (uses **`CATALOG_PUBLISH_KEY`**), or CLI:

```bash
set SUPABASE_URL=https://YOUR_PROJECT.supabase.co
set SUPABASE_ANON_KEY=...
set CATALOG_PUBLISH_KEY=...
python supabase/scripts/publish_catalog.py --notes "initial seed"
```

## Kit suggestions (estimate maker)

Flow: **Suggest** → **Accept/Reject** → **Publish full catalog** (accepted merges into local kit edits only). Phone combinations update from **Phone rules → Publish to app**.

| Role | License flag | UI |
|------|----------------|-----|
| Suggestor | `can_suggest` | Kit editor → **Suggest change** |
| Approver | `can_approve` | **Suggestions** tab → Accept into maker / Reject |
| Publisher (phone rules) | `SURVEY_RULES_PUBLISH_KEY` | **Phone rules → Publish to app** |
| Publisher (full catalog) | `CATALOG_PUBLISH_KEY` | **Publish full catalog** |

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

**Rules-only** (phone structure combinations) — auth with `SURVEY_RULES_PUBLISH_KEY`:

```json
{
  "mode": "rules",
  "publish_key": "...",
  "version_label": "rules-v1-2026-08-07",
  "notes": "",
  "survey_rules": { ... }
}
```

Copies previous ratebook/kits so a rules push does not wipe the estimate archive.

**Full catalog** — auth with `CATALOG_PUBLISH_KEY`:

```json
{
  "mode": "full",
  "publish_key": "...",
  "version_label": "seed-1-2026-07-25",
  "notes": "",
  "ratebook": { ... },
  "kit_matrix": { ... },
  "kit_edits": { ... },
  "survey_rules": { ... }
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

### POST `/functions/v1/license-admin`
Requires activated device + `can_approve`. Used by Assembly Builder → **Licenses** tab.

```json
{ "device_id": "...", "action": "list" }
```

```json
{
  "device_id": "...",
  "action": "create",
  "code": "SLM-CUSTOMER-001",
  "customer_name": "Name",
  "customer_phone": "",
  "days": 30,
  "max_devices": 2,
  "can_suggest": false,
  "can_approve": false,
  "notes": ""
}
```

```json
{
  "device_id": "...",
  "action": "update",
  "id": "...",
  "status": "blocked",
  "extend_days": 30,
  "set_days": 30,
  "max_devices": 2,
  "can_suggest": true,
  "can_approve": false
}
```

Cannot demote or block your own admin license (`cannot_demote_self` / `cannot_block_self`).

Deploy: `supabase functions deploy license-admin --no-verify-jwt`

## Android behaviour

- After successful activate / periodic license refresh, `CatalogApi` pulls the current catalog.
- Cached under app files: `estimate_catalog/ratebook.json`, `kit_matrix.json`, `kit_edits.json`.
- License prefs also store `can_suggest` / `can_approve` for a future mobile suggest UI.
- Survey/map paths never call these endpoints.

## Ops (your rental workflow)

Prefer the Assembly Builder **Licenses** tab (admin license with `can_approve`). SQL still works as a fallback:

| Action | UI / SQL |
|--------|----------|
| New rental | Licenses → + New license · or `select admin_create_license('CODE', 'Name', 'Phone', 30, 2);` |
| Extend / block / flags | Licenses row actions · or SQL `update licenses …` |
| See devices | Listed on Licenses (activation_count) · or `select * from activations …` |
| See current catalog | `select version_label, published_at, notes from estimate_catalogs where is_current;` |
| Pending suggestions | Suggestions tab · or `select … from estimate_suggestions where status='pending';` |

**Same key for phone + desktop editor:** set `max_devices = 2` when creating/editing the license.

## Speed

- Activate: once per install  
- Validate: on app open + at most once / 12h when online  
- Catalog: after license OK; full download only when `version_label` changes (else tiny “unchanged”); at most ~6h between checks  
- Map/GPS never call Supabase  
