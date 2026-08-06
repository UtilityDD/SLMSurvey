# SLMSurvey

Electrical network **field survey** (Android) + **desktop CAD / estimate** (browser). Survey GPS stays local on the phone; desktop is primary for final BOQ. Licensing and estimate catalog use Supabase.

## Start here (agents)

| Area | README |
|------|--------|
| **Android app** | [`app/README.md`](app/README.md) |
| **Structure combinations (admissible / defaults)** | [`docs/SURVEY_COMBINATIONS.md`](docs/SURVEY_COMBINATIONS.md) |
| **Desktop CAD + Assembly Builder** | [`sld_editor/README.md`](sld_editor/README.md) |
| Estimate kits / publish detail | [`sld_editor/estimate/README.md`](sld_editor/estimate/README.md) |
| Supabase (license + catalog) | [`supabase/README.md`](supabase/README.md) |

## Repo layout

```
app/                 Android (Room, MapLibre, survey wizard, field estimate check)
sld_editor/          Desktop CAD (Leaflet) + estimate/
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

Phone **survey presets** are parked (`PresetPreferences.FEATURE_ENABLED = false`); see [`app/README.md`](app/README.md).

## Build notes

- Android Gradle: use **JDK 21** (Java 25 fails).
- Android secrets: root `local.properties` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
- Desktop: serve `sld_editor/` (opens Map desk) or `sld_editor/desk/` directly.

## Data flow (one line)

Phone survey JSON (poles + kit tags) → Map desk → print / estimate from kits.  
Kits built in Structures → **Publish to app** → phones pull catalog for optional field check.
