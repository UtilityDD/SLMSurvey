# Desktop editor — agent README

Browser CAD + estimate tooling for SLM survey workspaces. Lives under `sld_editor/`. Open locally or via GitHub Pages. Same rental **license** model as the Android app (Supabase).

**Primary BOQ surface:** desktop **Estimate** tab / Assembly Builder — not the phone.

## Current focus

**Primary UI:** three desks in `desk/` — open `sld_editor/` (redirects) or `sld_editor/desk/`.

1. **Map** (`#map`) — import / open / demo map, verify poles, print, live estimate  
2. **Structures** (`#structures`) — browse kits by voltage; edit recipes via embed  
3. **Rates** (`#rates`) — materials, labour, turnkey schedules  

Print CAD still uses `index.html?cad=1` (Fit in N pages · simple print chrome). Legacy shells remain at `workspace/legacy.html`, `structure/legacy.html`, `schedules/legacy.html`.

Phone named presets are parked — do not block desktop cleanup on that work.

### Structures gallery

- Loads `estimate/kit-matrix.json` + demo turnkey SoR (`demo_contract_schedule.json`)
- Filter by **33kV / 11kV / LT**
- Detail panel → Edit kit (opens `estimate/?embed=1`)

### Map desk

- Map via `workspace/ws-map.js` (mobile-matched poles)
- Pole chips via `network-catalog.js`; overrides in workspace store
- Print handoff → CAD (`?cad=1&print=1&simple=1`)
- Live Materials / Labour / Scheme / Estimated; kit modal with optional admin edit

---

## What’s in this folder

| Path | Role |
|------|------|
| `desk/` | **Primary shell** — Map · Structures · Rates |
| `index.html` + `app.js` | Print CAD (`?cad=1`); otherwise redirects to `desk/` |
| `estimate/` | Kit editor engine (`?embed=1` from Structures / kit modal) |
| `workspace/` | Engines (`ws-store`, `ws-map`, catalog); `index.html` → desk |
| `structure/`, `schedules/` | Redirect to desk; `legacy.html` keeps old UI |
| `style.css`, `ui-dialog.js`, `ui-dialog.css` | CAD UI + confirm/prompt modals |
| `license.js`, `license-config.js` | License gate (same codes as Android) |
| `print_layout.js` | Print layouts (Fit in N pages) |
| `estimate/README.md` | Kit matrix / publish details (read next) |

Repo root also has `supabase/` for schema + edge functions used by license + catalog publish.

---

## How to run

1. Serve `sld_editor/` over HTTP (or open via Pages). Relative assets assume the folder URL.
2. Open `sld_editor/` or `sld_editor/desk/` — three desks only.
3. For license/catalog: configure Supabase URL/anon key the same way as the Android `local.properties`.
4. Print: from Map → Print (opens CAD with map handoff).

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
