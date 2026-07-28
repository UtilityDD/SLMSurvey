# Android app — agent README

Field survey app for electrical network poles/spans (GPS map). Survey data stays **on device** (Room). Licensing + estimate **catalog** sync via Supabase. **Desktop CAD is primary for final BOQ**; phone Estimate is a field check only.

**Package:** `com.blackgrapes.slmtoolbox`  
**Module path:** `app/`  
**JDK:** use **21** (Java 25 breaks Gradle). Example: `C:\Program Files\Microsoft\jdk-21.*`

---

## Product split (do not blur)

| Concern | Where |
|---------|--------|
| GPS poles, spans, Existing/Proposed, kit **tags** | Phone (this app) |
| Final estimate / BOQ matching | Desktop `sld_editor/estimate/` |
| Rate book + kit assembly | Desktop Assembly Builder → **Publish to app** |
| License activate / validate | Supabase edge functions |

Phone stores **classification tags** on each pole (material, conductor, type, location, arrangement, extension, guarding) so desktop can match kits later. Phone does **not** need to invent Mat/Lab line items.

---

## Build & run

```bat
set JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.8.9-hotspot
gradlew.bat :app:installDebug
```

Config in repo-root `local.properties` (not committed):

```properties
SUPABASE_URL=https://….supabase.co
SUPABASE_ANON_KEY=…
```

Empty URL = licensing disabled (dev mode). See `supabase/local.properties.example`.

Strings: `app/src/main/res/values/strings.xml` (+ `values-hi`, `values-bn`).

---

## Architecture map

```
app/src/main/java/com/blackgrapes/slmtoolbox/
  MainActivity.kt              # Host
  data/db/AppDatabase.kt       # Room v8 + migrations
  data/entity/Entities.kt
  data/mapper/SurveyMappers.kt
  data/repo/SurveyRepository.kt
  domain/model/SurveyModels.kt # Voltage, material, kit enums
  domain/NetworkCatalog.kt     # Voltage → materials/structures/conductors/locations
  ui/survey/SurveyMapFragment.kt
  ui/survey/SurveyBubbleWizard.kt   # Place/edit pole modal (compact review)
  ui/survey/SurveyViewModel.kt
  ui/map/SurveyMapRenderer.kt       # Lines, ×× guarding marks
  ui/estimate/EstimateFragment.kt   # Field BOQ check from published catalog
  estimate/EstimateMatcher.kt
  estimate/CatalogApi.kt / CatalogCache.kt / CatalogKitStore.kt
  license/…
```

Room version: **8** (`guarding` column). New schema changes need a new migration — never wipe user surveys casually.

---

## Survey place flow (current)

1. **Voltage** → **Existing / Proposed**
2. One **compact review card** (`SurveyBubbleWizard` → `POLE_REVIEW`):
   - Rows: Mat · Cond · Type · Loc · Arr · Ext · Guard
   - Feeder | SS side-by-side when starting a **new** 33/11kV network
   - Grey chips = not allowed for this choice (not “Existing-only”)
3. **Use this** → Place & Continue / Place & End  
   - **Dead-end** → End only

### Grey / disable rules (only these)

| Rule | Effect |
|------|--------|
| Location = Dead-end | Arrangement disabled; HT Type cannot be 1P |
| Extension = No-ext | Guarding disabled |

Existing and Proposed both get Loc/Arr/Ext/Guard (user requirement). Defaults pre-highlighted; user may change.

### Catalog options by voltage (`NetworkCatalog`)

| | 33kV | 11kV | LT |
|--|------|------|-----|
| Material | H-Pole, Rail, 9m PCC | 8m/9m PCC, H-Pole, Rail | 8m PCC |
| Conductor | 100, 150, 200 | 30, 50, 100, ABC | 30, 50, ABC, PVC |
| Type | 1P–4P (Dead-end: 2P–4P) | 1P–4P, DTR (Dead-end: 2P–4P or DTR) | Phase 1P/2P/3P (ABC/PVC → 1P) |

**Dead-end** = end of network. HT never 1P (33kV: 2P/3P/4P; 11kV: also DTR).  
**Location defaults:** insert/tap → T-Off; else Tangent.  
**Guarding:** With-ext + Yes → map draws ×× on spans (`SurveyMapRenderer.addGuardedCrossMarks`).

### Wizard entry modes

| Trigger | Mode |
|---------|------|
| Empty map tap | `NEW_NETWORK` |
| Place & Continue | `CONTINUE_SERIES` (series locks voltage/status) |
| Insert on line | `NEAR_LINE` / split |
| Branch from pole | `TAPPING_BRANCH` |
| Tap pole | Edit menu |

Also: Survey **preset**, **LT conversion ABC**, **DTR branch** (11kV or LT only) — see `SurveyBubbleWizard.startFlow()`.

---

## Estimate on phone

- Needs catalog from desktop **Publish to app** (`CatalogCache`).
- Matcher: `EstimateMatcher` + `ConductorTagMap` against Proposed poles’ kit tags.
- If no catalog: show empty/error — do not invent rates on device.

---

## Export

`ExportHelper` writes workspace JSON (includes `guarding`, kit fields). Desktop imports this for CAD + Estimate tab.

---

## Agent do / don’t

**Do**

- Prefer JDK 21 for Gradle.
- Keep survey GPS/local; don’t push pole geometry to Supabase.
- Extend `NetworkCatalog` for voltage option lists.
- Add Room migrations when changing entities.
- Keep review UI compact (label | chips); disable chips for rules, don’t hide whole rows unless asked.

**Don’t**

- Assume Existing skips kit tags (it does not anymore).
- Treat phone Estimate as source of truth for BOQ.
- Use Java 25 for builds.
- Commit `local.properties` secrets.

---

## Related docs

- Desktop CAD + Assembly Builder: [`../sld_editor/README.md`](../sld_editor/README.md)
- Estimate kits detail: [`../sld_editor/estimate/README.md`](../sld_editor/estimate/README.md)
- Supabase: [`../supabase/README.md`](../supabase/README.md)
- Repo root: [`../README.md`](../README.md)
