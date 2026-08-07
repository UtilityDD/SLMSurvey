#!/usr/bin/env python3
"""Publish local ratebook + kit-matrix to Supabase catalog-publish.

Usage (from repo root):
  set SUPABASE_URL=https://YOUR.supabase.co
  set SUPABASE_ANON_KEY=...
  set CATALOG_PUBLISH_KEY=...
  python supabase/scripts/publish_catalog.py

Optional:
  python supabase/scripts/publish_catalog.py --label seed-1-2026-07-25 --notes "initial"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EST = ROOT / "sld_editor" / "estimate"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="")
    ap.add_argument("--notes", default="")
    ap.add_argument("--edits", default="", help="Optional kit edits JSON path")
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    key = os.environ.get("CATALOG_PUBLISH_KEY", "")
    if not base or not anon or not key:
        print(
            "Need SUPABASE_URL, SUPABASE_ANON_KEY, CATALOG_PUBLISH_KEY in env",
            file=sys.stderr,
        )
        return 1

    ratebook = json.loads((EST / "ratebook.json").read_text(encoding="utf-8"))
    matrix = json.loads((EST / "kit-matrix.json").read_text(encoding="utf-8"))
    rules_path = EST / "survey-rules.json"
    survey_rules = {}
    if rules_path.is_file():
        survey_rules = json.loads(rules_path.read_text(encoding="utf-8"))
        validate = EST / "validate_survey_rules.py"
        if validate.is_file():
            import subprocess

            check = subprocess.run(
                [sys.executable, str(validate)],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
            )
            if check.returncode != 0:
                print(check.stdout or check.stderr, file=sys.stderr)
                print("survey-rules validation failed; abort publish", file=sys.stderr)
                return 1
    kit_edits: dict = {}
    if args.edits:
        raw = json.loads(Path(args.edits).read_text(encoding="utf-8"))
        kit_edits = raw.get("kits", raw)

    seed = matrix.get("seedVersion", "x")
    label = args.label.strip() or f"seed-{seed}-{__import__('datetime').date.today()}"

    payload = {
        "publish_key": key,
        "version_label": label,
        "notes": args.notes,
        "ratebook": ratebook,
        "kit_matrix": matrix,
        "kit_edits": kit_edits,
        "survey_rules": survey_rules,
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/functions/v1/catalog-publish",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {anon}",
            "apikey": anon,
        },
    )
    print(f"Publishing {label} ({len(body) / 1e6:.1f} MB)…")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code}: {err}", file=sys.stderr)
        return 1

    if not data.get("ok"):
        print(data, file=sys.stderr)
        return 1
    print("OK", data.get("version_label"), data.get("published_at"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
