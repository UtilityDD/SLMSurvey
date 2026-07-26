# SLM Estimate — Assembly Builder

Desktop admin UI to turn the Mat/Lab rate book into reusable estimate kits.

## What’s included

| File | Purpose |
|------|---------|
| `ratebook.json` | 299 materials + 120 labour items (from Google Sheet Mat/Lab) |
| `kit-matrix.json` | Auto-generated empty kits |
| `index.html` | Assembly Builder UI |
| `_gen_catalog.py` | Regenerates JSON from local Mat/Lab CSV exports |

## Kit families

**Structure kits** — usually `Voltage × Structure × Location × Arrangement × Conductor size`.  
Locations: **Tangent / Angular / Dead-end / T-Off**.  
**T-Off** = take-off where a new network starts from an existing network (In-line/Sectional × ext).  
- LT T-Off: SP, or from DTR  
- 11kV T-Off: SP/DP/TP/4P, or DTR  
- 33kV T-Off: existing DP (2P) or 4P only  

**Estimate (desktop primary):** Assembly Builder → **Estimate** tab. Import phone workspace JSON (or **Generate estimate** from CAD with a loaded survey). Matches Proposed poles/spans to **Final** kits and builds the BOQ.  

**Size-agnostic exceptions:** all **LT**; and **11kV · 1P · Tangent · In-line** (any conductor size → one structure kit; size stays on Conductor kits).  
Example HT size-based: `11kV · 2P · Angular · Dog 100`.  
Example size-agnostic: `11kV · 1P · Tangent · In-line arr. · ACSR · 3 wire`.

**Conductor kits** — wire/cable + stringing labour per km (still by size).

**Add-ons (6)** — Road crossing / Along highway per voltage.

## How to use

1. Open `sld_editor/estimate/` (or **Assembly Builder** from the CAD sidebar).
2. Filter by voltage / structure / conductor, disable invalid rows, **Build** the rest.
3. Edits save in the browser. **Export kits** to back up.

## Publish to mobile (Supabase)

Uses the **same** Supabase project as rental licensing.

1. Run `supabase/schema_estimate.sql` once in the SQL editor.
2. Deploy `catalog-current` and `catalog-publish` (see `supabase/README.md`).
3. Set secret `CATALOG_PUBLISH_KEY`.
4. Click **Publish to app** in this UI (or run `python supabase/scripts/publish_catalog.py`).

Activated Android devices pull the catalog after license activate/validate and cache it offline.

## Custom structures

Use **+ Custom structure** on the Structure kits tab for non-matrix poles/structures.

- Stored separately (`customKits` in catalog + browser `slm_estimate_custom_kits_v1`)
- Not wiped when `_gen_catalog.py` regenerates the matrix
- Included when you **Publish to app**
- Filter: Structure = Custom, or Origin = Custom only
