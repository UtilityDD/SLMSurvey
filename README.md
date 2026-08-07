# SLMSurvey

Electrical network **field survey** (Android) + **desktop CAD / estimate** (browser). Survey GPS stays local on the phone; desktop is primary for final BOQ. Licensing uses Supabase. Phones sync **survey combination rules** from PC (not the heavy kit catalog).

## Start here (agents)

| Area | README |
|------|--------|
| **Android app** | [`app/README.md`](app/README.md) |
| **Structure combinations (admissible / defaults)** | [`docs/SURVEY_COMBINATIONS.md`](docs/SURVEY_COMBINATIONS.md) |
| **Shared rules JSON** | [`sld_editor/estimate/survey-rules.json`](sld_editor/estimate/survey-rules.json) |
| **Desktop CAD + Assembly Builder** | [`sld_editor/README.md`](sld_editor/README.md) |
| Estimate kits / publish detail | [`sld_editor/estimate/README.md`](sld_editor/estimate/README.md) |
| Supabase (license + catalog) | [`supabase/README.md`](supabase/README.md) |

## Repo layout

```
app/                 Android (Room, MapLibre, survey wizard)
sld_editor/          Desktop CAD (Leaflet) + estimate/ + survey-rules.json
docs/                Cross-cutting review refs (structure combinations, …)
supabase/            SQL + edge functions
tools/               Misc assets/scripts
```

## Current focus

**Desktop UI** — three desks in `sld_editor/desk/`:

| Desk | Path | Role |
|------|------|------|
| **Map** | `sld_editor/desk/#map` | Import / open / demo map, verify poles, print, live estimate |
| **Structures** | `sld_editor/desk/#structures` | Browse / edit kits |
| **Rates** | `sld_editor/desk/#rates` | Materials, labour, turnkey schedules |

`sld_editor/` redirects into the desk shell; print CAD stays on `index.html?cad=1`.

Phone **Estimate is disabled** (`PhoneFeatures.ESTIMATE_ENABLED = false`). Field app surveys + downloads `survey-rules` after license sync.

## Build notes

- Android Gradle: use **JDK 21** (Java 25 fails).
- Android secrets: root `local.properties` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
- Desktop: serve `sld_editor/` (opens Map desk) or `sld_editor/desk/` directly.
- After schema change: run `supabase/schema_survey_rules.sql`, redeploy `catalog-publish` + `catalog-current`.

## Data flow (one line)

Phone survey JSON (poles + kit tags) → Map desk → print / estimate from kits.  
PC **Publish to app** → phones pull **survey-rules** (combinations); kits/rates stay for desktop BOQ.
