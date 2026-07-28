# Demo surveys

Bundled workspaces for CAD + Estimate testing (no file pick from disk).

| File | Description |
|------|-------------|
| `sample_workspace_33_11_lt.json` | 33kV feeder (15) + 11kV with 3 DTRs + LT tapped from 250 kVA DTR |

Span lengths are **GPS haversine** between poles, placed under app `ContinueSpanGuidance` limits (LT ABC ≤40 m; HT 9m PCC ≤70 m; HT Rail ≤80 m). Regenerate with `python _gen_sample_workspace.py`.

**CAD:** click **Load demo survey**  
**Estimate:** click **Load demo**

Serve `sld_editor/` over HTTP so `fetch` can read these files (`file://` is blocked by browsers).
