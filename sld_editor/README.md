# Desktop editor — agent README

Browser CAD + estimate tooling for SLM survey workspaces. Lives under `sld_editor/`. Open locally or via GitHub Pages. Same rental **license** model as the Android app (Supabase).

**Primary BOQ surface:** desktop **Estimate** tab / Assembly Builder — not the phone.

---

## What’s in this folder

| Path | Role |
|------|------|
| `index.html` + `app.js` | Main CAD editor (Leaflet map, import survey JSON, SLD tools) |
| `style.css`, `ui-dialog.js`, `ui-dialog.css` | UI + confirm/prompt modals |
| `license.js`, `license-config.js` | License gate (same codes as Android) |
| `print_layout.js` | Print layouts |
| `estimate/` | **Assembly Builder** + Estimate BOQ UI |
| `estimate/README.md` | Kit matrix / publish details (read next) |

Repo root also has `supabase/` for schema + edge functions used by license + catalog publish.

---

## How to run

1. Serve `sld_editor/` over HTTP (or open via Pages). Relative assets assume the folder URL (GitHub Pages script in `index.html` fixes missing trailing slash).
2. For license/catalog: configure Supabase URL/anon key the same way as the Android `local.properties` (see `license-config.js` / estimate publish UI).
3. Assembly Builder: open `sld_editor/estimate/` or use sidebar link **Assembly Builder**.

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
- Arrangement: In-line / Sectional (N/A for Dead-end)  
- Extension: No-ext / With-ext (+ guarding on phone for map ××; BOQ impact optional)  
- Conductor size / family (see `ConductorTagMap` on Android)

**T-Off rules (matrix):**

- LT: SP or from DTR  
- 11kV: SP–4P or DTR  
- 33kV: SP–4P (incl. 1P)

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
