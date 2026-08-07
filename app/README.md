# Android app — agent README

Field survey app for electrical network poles/spans (GPS map). Survey data stays **on device** (Room). Licensing + **survey combination rules** sync via Supabase. **Desktop is primary for kits / BOQ**; phone Estimate is **disabled** (`PhoneFeatures.ESTIMATE_ENABLED = false`).

**Package:** `com.blackgrapes.slmtoolbox`  
**Module path:** `app/`  
**JDK:** use **21** (Java 25 breaks Gradle). Example: `C:\Program Files\Microsoft\jdk-21.*`

---

## Product split (do not blur)

| Concern | Where |
|---------|--------|
| GPS poles, spans, Existing/Proposed, kit **tags** | Phone (this app) |
| Allowed / blocked chip combinations | Shared `survey-rules.json` (PC publish → phone) |
| Final estimate / BOQ matching | Desktop `sld_editor/` |
| Rate book + kit assembly | Desktop Structures / Estimate → **Publish to app** |

Phone stores **classification tags** on each pole (material, conductor, type, location, arrangement, extension, guarding) so desktop can match kits later. Phone does **not** download the full kit matrix for field BOQ.

**Full admissible / default matrix:** [`docs/SURVEY_COMBINATIONS.md`](../docs/SURVEY_COMBINATIONS.md) · machine file [`sld_editor/estimate/survey-rules.json`](../sld_editor/estimate/survey-rules.json) (also in `assets/`).

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

### Grey / disable rules (summary)

| Rule | Effect |
|------|--------|
| Location = Dead-end | Arrangement disabled; HT Type cannot be 1P |
| HT Type = 1P | Dead-end location greyed |
| Continuing 33/11kV 1P | Conductor locked to previous pole/current section |
| HT Type = 2P/3P/4P/DTR | Arrangement forced to Sectional |
| Extension / material | Guarding only when `allowsGuardingChoice` (With-ext, or No-ext on Rail/H-Pole) |
| LT ABC / PVC | ABC → 3P only; PVC → 1P or 3P |

**Full admissible / default matrix:** [`docs/SURVEY_COMBINATIONS.md`](../docs/SURVEY_COMBINATIONS.md)

Existing and Proposed both get Loc/Arr/Ext/Guard. Defaults pre-highlighted; user may change.

### Catalog options by voltage (`NetworkCatalog`)

| | 33kV | 11kV | LT |
|--|------|------|-----|
| Material | H-Pole, Rail, 9m PCC | 8m/9m PCC, H-Pole, Rail | 8m PCC |
| Conductor | 100, 150, 200 | 30, 50, 100, ABC | 30, 50, ABC, PVC |
| Type | 1P–4P (Dead-end: 2P–4P) | 1P–4P, DTR (Dead-end: 2P–4P or DTR) | Phase 1P/2P/3P (ABC & bare; PVC→1P\|3P) |

**Dead-end** = end of network. HT never 1P (33kV: 2P/3P/4P; 11kV: also DTR).  
**HT arrangement:** 1P defaults In-line but may be Sectional; 2P/3P/4P/DTR are always Sectional.  
**HT continuation:** a continuing 1P always keeps the previous pole/current-section conductor; conductor change requires a sectional multi-pole structure.  
**Location defaults:** insert/tap → T-Off; else Tangent.  
**Guarding:** Yes (when allowed) → map draws ×× on spans (`SurveyMapRenderer.addGuardedCrossMarks`).

### Wizard entry modes

| Trigger | Mode |
|---------|------|
| Empty map tap | `NEW_NETWORK` |
| Place & Continue | `CONTINUE_SERIES` (locks voltage/status; HT 1P also locks conductor) |
| Insert on line | `NEAR_LINE` / split |
| Branch from pole | `TAPPING_BRANCH` |
| Tap pole | Edit menu |

Also: **DTR branch** (11kV or LT only) — see `SurveyBubbleWizard.startFlow()`.

### Survey presets — parked (do later)

Named Pre/Post presets (`SurveyPresetCatalog`, colour-coded short names, `PresetSettingsFragment`) are **disabled** for now:

- Flag: `PresetPreferences.FEATURE_ENABLED = false`
- Map FAB `btnPresetSettings` is hidden
- Wizard ignores presets / LT-conversion-from-preset until the flag is turned back on

Survey uses the usual voltage → status → compact review flow only. Revisit presets after desktop UI cleanup.

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
- Structure combinations (admissible / defaults): [`../docs/SURVEY_COMBINATIONS.md`](../docs/SURVEY_COMBINATIONS.md)
- Estimate kits detail: [`../sld_editor/estimate/README.md`](../sld_editor/estimate/README.md)
- Supabase: [`../supabase/README.md`](../supabase/README.md)
- Repo root: [`../README.md`](../README.md)
