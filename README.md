# SLMSurvey

Electrical network **field survey** (Android) + **desktop CAD / estimate** (browser). Survey GPS stays local on the phone; desktop is primary for final BOQ. Licensing and estimate catalog use Supabase.

## Start here (agents)

| Area | README |
|------|--------|
| **Android app** | [`app/README.md`](app/README.md) |
| **Desktop CAD + Assembly Builder** | [`sld_editor/README.md`](sld_editor/README.md) |
| Estimate kits / publish detail | [`sld_editor/estimate/README.md`](sld_editor/estimate/README.md) |
| Supabase (license + catalog) | [`supabase/README.md`](supabase/README.md) |

## Repo layout

```
app/                 Android (Room, MapLibre, survey wizard, field estimate check)
sld_editor/          Desktop CAD (Leaflet) + estimate/
supabase/            SQL + edge functions
tools/               Misc assets/scripts
```

## Build notes

- Android Gradle: use **JDK 21** (Java 25 fails).
- Android secrets: root `local.properties` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
- Desktop: serve `sld_editor/`; Assembly Builder at `sld_editor/estimate/`.

## Data flow (one line)

Phone survey JSON (poles + kit tags) → desktop CAD / Estimate tab → BOQ from published kits.  
Kits built in Assembly Builder → **Publish to app** → phones pull catalog for optional field check.
