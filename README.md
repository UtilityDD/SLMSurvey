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

**Desktop UI cleanup** — two desks:

| Desk | Path | Role |
|------|------|------|
| **Workspace** | `sld_editor/workspace/` | Job: import survey map, preview/print (via CAD), review poles, estimate |
| **Structure** | `sld_editor/structure/` | Visual catalog: voltage-grouped structure cards, draft/suggested/final status |

Phone **survey presets** are parked (`PresetPreferences.FEATURE_ENABLED = false`); see [`app/README.md`](app/README.md).

CAD print toolbar is off until Print Layout is enabled; menubar is wired; survey handoff goes to Workspace.

## Build notes

- Android Gradle: use **JDK 21** (Java 25 fails).
- Android secrets: root `local.properties` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
- Desktop: serve `sld_editor/`; Assembly Builder at `sld_editor/estimate/`; workspace hub at `sld_editor/workspace/`.

## Data flow (one line)

Phone survey JSON (poles + kit tags) → desktop CAD / Estimate tab → BOQ from published kits.  
Kits built in Assembly Builder → **Publish to app** → phones pull catalog for optional field check.
