# Desktop editor — agent README

Browser CAD + estimate tooling for SLM survey workspaces. Lives under `sld_editor/`. Open locally or via GitHub Pages. Same rental **license** model as the Android app (Supabase).

**Primary BOQ surface:** desktop **Estimate** tab / Assembly Builder — not the phone.

## Current focus

Two desks for day-to-day use:

1. **Workspace** (`workspace/`) — one survey job: import → review → estimate  
2. **Library** (`structure/`) — browse kits + edit recipes (Builder merged here)
3. Job workspace for survey → estimate

Phone named presets are parked — do not block desktop cleanup on that work.

### Structure gallery

- Loads `estimate/kit-matrix.json` + demo turnkey SoR (`demo_contract_schedule.json`)
- Groups by **33kV / 11kV / LT**, then by type (1P, 2P, …)
- Cards show location · arrangement · conductor + **SoR** chip when linked
- Status: Final / Suggested (local) / Draft / Empty / Schedule linked
- Detail drawer → Mark suggested · Edit kit (same Library desk)

### Workspace

- Catalog loader restored: `workspace/ws-catalog.js` (`SlmCatalog`)
- Nav: Survey → Assemblies → Rates → Contract → Estimate (presets parked)

### CAD chrome cleanup

- Print toolbar hidden until Print Layout is on
- Top menubar wired; **Send survey** → Workspace

---

## What’s in this folder

| Path | Role |
|------|------|
| `index.html` + `app.js` | Main CAD editor (Leaflet map, import survey JSON, SLD tools) |
| `structure/` | **Library** — browse gallery + edit kits (Builder) |
| `estimate/` | Kit editor engine (opens inside Library · Edit; `?embed=1`) |
| `workspace/` | Job hub: survey → assemblies → rates → estimate |
| `style.css`, `ui-dialog.js`, `ui-dialog.css` | UI + confirm/prompt modals |
| `license.js`, `license-config.js` | License gate (same codes as Android) |
| `print_layout.js` | Print layouts |
| `estimate/README.md` | Kit matrix / publish details (read next) |

Repo root also has `supabase/` for schema + edge functions used by license + catalog publish.

---

## How to run

1. Serve `sld_editor/` over HTTP (or open via Pages). Relative assets assume the folder URL (GitHub Pages script in `index.html` fixes missing trailing slash).
2. For license/catalog: configure Supabase URL/anon key the same way as the Android `local.properties` (see `license-config.js` / estimate publish UI).
3. Library: open `sld_editor/structure/` — use **Browse** / **Edit** on the left (Builder is merged here).

---

## Product flow (end-to-end)

```
Phone survey (GPS + kit tags)
    → export workspace JSON
    → Desktop CAD import (edit / print SLD)
    → Estimate tab: match Proposed poles to Final kits → BOQ

Assembly Builder (Mat/Lab → kits)
    → Publish to app (Supabase)
    → Phones pull catalog for field check only
```

**Do not** treat phone Estimate as the final quotation engine.

---

## CAD editor (`app.js`) — agent notes

- Import survey JSON exported from Android (`ExportHelper` shape: assets, connections, kit fields, `guarding`, etc.).
- Edit geometry / metadata; generate printable SLD; optional **Generate estimate** when survey loaded.
- Prefer existing dialog helpers in `ui-dialog.js` over `alert`/`confirm`.
- Keep UI consistent with current CSS variables / layout; avoid drive-by refactors of the whole CAD.

Key user journeys to preserve:

- Load / save workspace
- License gate when configured
- Link into Assembly Builder / Estimate

---

## Assembly Builder + Estimate (`estimate/`)

Read [`estimate/README.md`](estimate/README.md) for kit families and publish steps.

**Short version**

| Artifact | Purpose |
|----------|---------|
| `ratebook.json` | Materials + labour rates |
| `kit-matrix.json` | Structure / conductor / add-on kit shells |
| UI tabs | Build kits, mark Final, disable invalid combos |
| **Estimate** tab | Import phone JSON → match kits → BOQ |
| **Publish to app** | Push catalog to Supabase for phones |

### Kit axes (must stay aligned with Android tags)

Phone wizard writes labels that matcher keys on:

- Voltage: 33kV / 11kV / LT  
- Structure: 1P / 2P / 3P / 4P / DTR  
- Location: Tangent / Angular / Dead-end / **T-Off**  
- Arrangement: HT 1P = In-line (default) or Sectional; HT 2P/3P/4P/DTR = Sectional only; Dead-end = N/A  
- Extension: No-ext / With-ext (+ guarding on phone for map ××; BOQ impact optional)  
- Conductor size / family (see `ConductorTagMap` on Android)

**T-Off rules (matrix):**

- LT: SP or from DTR  
- 11kV: SP–4P or DTR  
- 33kV: SP–4P (incl. 1P)

For 33/11kV continuation, a **1P** keeps the previous pole/current-section conductor. A conductor change is
represented by a sectional **2P/3P/4P** structure. The generated matrix therefore
contains no HT In-line combinations for 2P/3P/4P/DTR.

Structure kits now carry a short **`code`** (incl. pole token) for search/display; long pipe `id` stays the match key. See [`estimate/README.md`](estimate/README.md).

Regenerate matrix from CSV: `estimate/_gen_catalog.py` (see estimate README). Custom kits survive regenerate.

---

## Supabase touchpoints

| Feature | Functions / SQL |
|---------|-----------------|
| License | `license-admin`, activate/validate |
| Catalog publish | `catalog-publish`, `catalog-current` |
| Schema | `supabase/schema_estimate.sql`, `schema.sql`, … |

Details: [`../supabase/README.md`](../supabase/README.md).

Publish needs admin license + `CATALOG_PUBLISH_KEY`. Phones cache published catalog offline after validate/activate.

---

## Agent do / don’t

**Do**

- Keep desktop as **primary** estimate/BOQ.
- Keep kit identity axes compatible with Android `NetworkCatalog` / `SurveyBubbleWizard` tags.
- Use Assembly Builder publish path for phone catalog updates.
- Prefer small, scoped edits in `app.js` / `estimate/*.js`.

**Don’t**

- Move final BOQ ownership to the phone.
- Break T-Off / arrangement / extension semantics without updating Android matcher + wizard.
- Commit publish keys or local secrets (`.catalog_publish_key.local`, etc.).

---

## Related docs

- Android field app: [`../app/README.md`](../app/README.md)
- Estimate kits deep-dive: [`estimate/README.md`](estimate/README.md)
- Supabase: [`../supabase/README.md`](../supabase/README.md)
- Repo root: [`../README.md`](../README.md)
