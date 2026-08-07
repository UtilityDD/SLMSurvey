#!/usr/bin/env python3
"""Validate kit-matrix.json against survey-rules.json blocked / voltage rules.

Exit 0 if OK, 1 if violations. Run from repo root:
  python sld_editor/estimate/validate_survey_rules.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RULES = ROOT / "survey-rules.json"
MATRIX = ROOT / "kit-matrix.json"


def norm_arr(a: str | None) -> str:
    if not a:
        return ""
    if a in ("InlineArr", "In-line", "In-line arr."):
        return "In-line"
    if a == "Sectional":
        return "Sectional"
    return str(a)


def norm_ext(e: str | None) -> str:
    if not e or e in ("NoExt", "No ext"):
        return "No ext"
    if e in ("WithExt", "With ext"):
        return "With ext"
    return str(e)


def structure_id(kit: dict) -> str:
    st = str(kit.get("structure") or "")
    if st.startswith("DTR"):
        return "DTR"
    return st


def violations_for_kit(kit: dict, rules: dict) -> list[str]:
    out: list[str] = []
    v = kit.get("voltage") or ""
    by = (rules.get("byVoltage") or {}).get(v) or {}
    st = structure_id(kit)
    loc = kit.get("location") or kit.get("position") or ""
    arr = norm_arr(kit.get("arrangement"))
    ext = norm_ext(kit.get("extension"))

    allowed_st = by.get("structures") or []
    extra = by.get("kitStructuresExtra") or []
    if st == "DTR" and by.get("allowsDtrTOffKits") and loc == "T-Off":
        pass  # LT DTR T-Off kits are intentional (desktop match)
    elif allowed_st and st and st not in allowed_st and st not in extra:
        out.append(f"{kit.get('id')}: structure {st} not in rules for {v}")
    elif st == "DTR" and by.get("allowsDtrTOffKits") and loc != "T-Off":
        out.append(f"{kit.get('id')}: LT DTR kits only at T-Off")

    dead = by.get("deadEndStructures") or []
    if loc == "Dead-end" and st and dead and st not in dead:
        out.append(f"{kit.get('id')}: Dead-end + {st} blocked for {v}")

    # HT multi-pole / DTR must be Sectional (or null on DE)
    is_ht = v in ("33kV", "11kV")
    if is_ht and st and st != "1P" and loc != "Dead-end" and arr and arr != "Sectional":
        out.append(f"{kit.get('id')}: {st} must be Sectional, got {arr}")

    if is_ht and st == "1P" and loc == "Dead-end":
        out.append(f"{kit.get('id')}: HT 1P + Dead-end blocked")

    if loc == "Dead-end" and arr:
        out.append(f"{kit.get('id')}: Dead-end must have null arrangement")

    if v == "33kV" and st == "DTR":
        out.append(f"{kit.get('id')}: 33kV DTR blocked")

    # Conductor family / size hints — 33 no Rabbit 50
    short = str(kit.get("conductorShort") or "")
    if v == "33kV" and "Rabbit" in short:
        out.append(f"{kit.get('id')}: 33kV Rabbit/50 blocked")

    # Pole codes: 33 never 8m
    poles = kit.get("allowedPoleCodes") or []
    if v == "33kV" and "110030141" in poles:
        out.append(f"{kit.get('id')}: 33kV must not allow 8m PCC pole")

    return out


def main() -> int:
    if not RULES.is_file():
        print(f"Missing {RULES}", file=sys.stderr)
        return 1
    if not MATRIX.is_file():
        print(f"Missing {MATRIX}", file=sys.stderr)
        return 1

    rules = json.loads(RULES.read_text(encoding="utf-8"))
    matrix = json.loads(MATRIX.read_text(encoding="utf-8"))
    kits = matrix.get("structureKits") or []
    bad: list[str] = []
    for k in kits:
        if k.get("enabled") is False:
            continue
        bad.extend(violations_for_kit(k, rules))

    if bad:
        print(f"{len(bad)} violation(s):")
        for line in bad[:80]:
            print(" ", line)
        if len(bad) > 80:
            print(f"  … +{len(bad) - 80} more")
        return 1

    print(f"OK — {len(kits)} structure kits match survey-rules")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
