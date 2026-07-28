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

**Structure kits** — usually `Voltage × Structure × Location × Arrangement × Pole × Conductor × Ext`.  
Locations: **Tangent / Angular / Dead-end / T-Off**.  
**T-Off** = take-off where a new network starts from an existing network (In-line/Sectional × ext).  
- LT T-Off: SP, or from DTR  
- 11kV T-Off: SP/DP/TP/4P, or DTR  
- 33kV T-Off: 1P / 2P / 3P / 4P  

**Short kit `code` (display + search):** e.g. `33-1P-TAN-INL-9M-DOG-3W-NX`  
| Token | Meaning |
|-------|---------|
| `33` / `11` / `LT` | Voltage |
| `1P`–`4P` / `D2` `D4` | Structure / DTR mount |
| `TAN` `ANG` `DE` `TOF` | Location |
| `INL` `SEC` | Arrangement (omit on Dead-end) |
| `8M` `9M` `RL` `T9` `WF`… | **Pole type** (variant) |
| `DOG` `ACSR` `ABC`… | Conductor |
| `3W` / `CAB` | Wire |
| `NX` / `WX` | Extension |

Long pipe `id` remains the technical key. Each kit also has `poleVariants[]` (same axes, one code per allowed pole, plus `matCode` / `labourCodes` for ratebook swap). `familyKey` e.g. `33|1P` groups the Structure board (**By family** view). DTR kits are hidden until **Show DTR** (or a DTR structure filter). Pole filter and editor pole-variant chips use the same tokens (`9M`, `RL`, …); clicking a chip loads that pole’s Mat (+ erection Lab when present) into the kit.  

**Estimate (desktop primary):** Assembly Builder → **Estimate** tab. Generates a West Bengal–style estimate: separate **Schedule of Materials** and **Schedule of Labour** (code, description, unit, qty, rate, amount — no Mat/Lab column on each row), then an **Abstract** with editable % extras (contingency on Mat/Lab, GST, cess) and **amount in words**.

**Sample survey (demo):** bundled at [`../demo/sample_workspace_33_11_lt.json`](../demo/sample_workspace_33_11_lt.json).

| Network | Contents |
|---------|----------|
| 33kV | 15 Proposed structures (1P–4P, angles, T-Off stub, Dead-end on **2P**) |
| 11kV | 12 assets incl. **3 DTRs** (100 / 250 / 63 kVA on 2P & 4P) |
| LT | 8 poles **tapped from the 250 kVA DTR** (bare + ABC + PVC) |

How to try the desktop flow (no file pick from disk):

1. Serve `sld_editor/` over HTTP, open CAD → **Load demo survey**. Edit in browser memory; use **Generate estimate**.  
2. Or open Assembly Builder → **Estimate** → **Load demo** → **Generate BOQ**.  
3. Kits ship as Draft — estimates still match them; tick **Final** when a kit is reviewed.  

**Size-agnostic exceptions:** all **LT** (ACSR / ABC / PVC); and **11kV · 1P · Tangent · In-line** (any conductor size → one structure kit; size stays on Conductor kits).  
LT **PVC** uses Mat PVC 1.1kV cables (phone tag `PVC`; size on conductor kits).  
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
