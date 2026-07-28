"""
Coverage: every survey-app selectable combination → structure kit in kit-matrix.

Uses the same axes as NetworkCatalog.kt and the same match filters as estimate-match.js
(without requiring Final — “has a link” = any enabled kit exists).
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
matrix = json.loads((ROOT / "kit-matrix.json").read_text(encoding="utf-8"))
kits = [k for k in matrix["structureKits"] if k.get("enabled", True)]
cond_kits = [k for k in matrix["conductorKits"] if k.get("enabled", True)]

LOCATIONS = ["Tangent", "Angular", "Dead-end", "T-Off"]
ARRANGEMENTS = ["In-line", "Sectional"]  # survey labels
EXTENSIONS = ["No ext", "With ext"]
DTR_MOUNTS = ["2P", "4P"]
DTR_CAPS = ["16", "25", "63", "100", "160", "250", "315", "630"]


def arrangement_id(label: str | None) -> str | None:
    if not label:
        return None
    s = str(label)
    if "in" in s.lower() and "line" in s.lower():
        return "InlineArr"
    if "sectional" in s.lower():
        return "Sectional"
    return s


def extension_id(label: str | None) -> str | None:
    if not label:
        return None
    s = str(label).lower()
    if "with" in s and "ext" in s:
        return "WithExt"
    if "no" in s and "ext" in s:
        return "NoExt"
    return label


def is_cable(tag: str) -> bool:
    return tag.upper() in ("ABC", "PVC")


def sized_ids(voltage: str, tag: str) -> list[str]:
    if is_cable(tag):
        return []
    m = {
        ("33kV", "100"): ["ACSR|Dog|100"],
        ("33kV", "150"): ["ACSR|Wolf|150"],
        ("33kV", "200"): ["ACSR|Panther|200"],
        ("11kV", "30"): ["ACSR|Weasel|30"],
        ("11kV", "50"): ["ACSR|Rabbit|50"],
        ("11kV", "100"): ["ACSR|Dog|100"],
        ("LT", "20"): ["ACSR|Squirrel|20"],
        ("LT", "30"): ["ACSR|Weasel|30"],
        ("LT", "50"): ["ACSR|Rabbit|50"],
    }
    return m.get((voltage, tag), [])


def conductor_family(tag: str) -> str | None:
    if not tag:
        return None
    if tag.upper() == "PVC":
        return "PVC"
    return "ABC" if tag.upper() == "ABC" else "ACSR"


def agnostic_ids(voltage: str, tag: str) -> list[str]:
    if not tag:
        return []
    if voltage == "LT":
        if tag.upper() == "PVC":
            return ["LT|ANY|PVC"]
        return ["LT|ANY|ABC"] if tag.upper() == "ABC" else ["LT|ANY|ACSR"]
    if voltage == "11kV":
        if tag.upper() == "PVC":
            return []
        return (
            ["11kV|ANY|ABC", "ABC|HT|3x95"]
            if tag.upper() == "ABC"
            else ["11kV|ANY|ACSR"]
        )
    return []


def derive_wire(voltage: str, conductor: str, structure: str) -> str | None:
    if is_cable(conductor):
        return None
    if voltage == "LT":
        if structure == "2P":
            return "3W"
        if structure == "3P":
            return "4W"
        return "2W"
    return "3W"


def structure_key(voltage: str, structure: str, dtr_mount: str | None) -> str | None:
    if structure == "DTR":
        if not dtr_mount:
            return None
        return dtr_mount if dtr_mount.startswith("DTR") else f"DTR{dtr_mount}"
    if voltage == "LT":
        return "1P"
    return structure


def normalize_kva(raw) -> str | None:
    if raw is None or raw == "":
        return None
    digits = "".join(c for c in str(raw) if c.isdigit())
    return digits or None


def wire_ok(kit: dict, voltage: str, conductor: str, structure: str) -> bool:
    want = derive_wire(voltage, conductor, structure)
    if is_cable(conductor):
        return (
            not kit.get("wireCount")
            or str(kit.get("wireLabel") or "").lower() == "cable"
            or kit.get("conductorFamily") in ("ABC", "PVC")
        )
    if not want:
        return not kit.get("wireCount")
    return kit.get("wireCount") == want


def conductor_ok(kit: dict, voltage: str, conductor: str) -> bool:
    if kit.get("conductorSizeAgnostic"):
        fam = conductor_family(conductor)
        if not fam:
            return False
        cid = kit.get("conductorId") or ""
        return (
            kit.get("conductorFamily") == fam
            or f"|{fam}" in cid
            or cid in agnostic_ids(voltage, conductor)
        )
    sized = sized_ids(voltage, conductor)
    agn = agnostic_ids(voltage, conductor)
    return kit.get("conductorId") in sized or kit.get("conductorId") in agn


def find_structure_kit(asset: dict) -> dict | None:
    voltage = asset["voltage"]
    s_key = structure_key(voltage, asset["structure"], asset.get("dtrMount"))
    if not s_key:
        return None
    location = asset["kitLocation"]
    ext = extension_id(asset["kitExtension"])
    arr_want = None if location == "Dead-end" else arrangement_id(asset.get("kitArrangement"))
    hits = []
    for kit in kits:
        if kit.get("voltage") != voltage:
            continue
        struct_ok = kit.get("structure") == s_key or (
            asset["structure"] == "DTR"
            and kit.get("isDtr")
            and kit.get("dtrMount") == str(asset.get("dtrMount") or "").replace("DTR", "")
        )
        if not struct_ok:
            continue
        if kit.get("location") != location:
            continue
        if str(kit.get("extension") or "") != str(ext or ""):
            continue
        if location == "Dead-end":
            if kit.get("arrangement"):
                continue
        elif kit.get("arrangement") != arr_want:
            continue
        if not wire_ok(kit, voltage, asset["conductor"], asset["structure"]):
            continue
        if not conductor_ok(kit, voltage, asset["conductor"]):
            continue
        if asset["structure"] == "DTR" and kit.get("isDtr") and kit.get("dtrCapacity"):
            if normalize_kva(kit.get("dtrCapacity")) != normalize_kva(asset.get("dtCapacityKva")):
                continue
        hits.append(kit)
    if not hits:
        return None
    return next((k for k in hits if k.get("complete")), hits[0])


def pole_token_for_material(material: str) -> list[str]:
    """Survey material → expected poleTokens on kit."""
    return {
        "8m PCC": ["8M"],
        "9m PCC": ["9M"],
        "Rail": ["RL"],
        "H-Pole": ["T9", "T95", "T11", "WF"],  # tubular / beam family
    }.get(material, [])


def enumerate_survey_combos():
    """Yield survey assets (Proposed) for every selectable combo."""
    configs = [
        ("33kV", ["H-Pole", "Rail", "9m PCC"], ["1P", "2P", "3P", "4P"], ["100", "150", "200"]),
        ("11kV", ["8m PCC", "9m PCC", "H-Pole", "Rail"], ["1P", "2P", "3P", "4P", "DTR"], ["30", "50", "100", "ABC"]),
        ("LT", ["8m PCC"], ["1P", "2P", "3P"], ["30", "50", "ABC", "PVC"]),
    ]
    for voltage, materials, structures, conductors in configs:
        for material in materials:
            for structure in structures:
                # LT + ABC → 1P only
                structs = structures
                if voltage == "LT" and structure != "1P":
                    # still enumerate bare 2P/3P; ABC forced below
                    pass
                for conductor in conductors:
                    if voltage == "LT" and conductor == "ABC" and structure != "1P":
                        continue
                    if voltage == "LT" and conductor == "PVC" and structure != "1P":
                        # PVC treated as cable → 1P path in practice
                        continue
                    for loc in LOCATIONS:
                        # Phone: HT Dead-end never on 1P
                        if (
                            voltage in ("33kV", "11kV")
                            and structure == "1P"
                            and loc == "Dead-end"
                        ):
                            continue
                        arrs = [None] if loc == "Dead-end" else ARRANGEMENTS
                        for arr in arrs:
                            for ext in EXTENSIONS:
                                if structure == "DTR":
                                    for mount in DTR_MOUNTS:
                                        for cap in DTR_CAPS:
                                            yield {
                                                "status": "Proposed",
                                                "voltage": voltage,
                                                "poleMaterial": material,
                                                "structure": structure,
                                                "conductor": conductor,
                                                "kitLocation": loc,
                                                "kitArrangement": arr,
                                                "kitExtension": ext,
                                                "dtrMount": mount,
                                                "dtCapacityKva": cap,
                                                "kitWire": derive_wire(voltage, conductor, structure),
                                            }
                                else:
                                    yield {
                                        "status": "Proposed",
                                        "voltage": voltage,
                                        "poleMaterial": material,
                                        "structure": structure,
                                        "conductor": conductor,
                                        "kitLocation": loc,
                                        "kitArrangement": arr,
                                        "kitExtension": ext,
                                        "kitWire": derive_wire(voltage, conductor, structure),
                                    }


def asset_key(a: dict) -> str:
    bits = [
        a["voltage"],
        a["structure"],
        a["conductor"],
        a["kitLocation"],
        a.get("kitArrangement") or "-",
        a["kitExtension"],
        a.get("dtrMount") or "",
        a.get("dtCapacityKva") or "",
    ]
    return "|".join(bits)


def main():
    # Deduplicate by match axes (material/guarding not in match)
    seen = {}
    for a in enumerate_survey_combos():
        seen[asset_key(a)] = a
    assets = list(seen.values())

    missing = []
    matched = []
    no_pole_variant = []
    by_reason = Counter()

    for a in assets:
        kit = find_structure_kit(a)
        if not kit:
            missing.append(a)
            # classify
            if a["conductor"].upper() == "PVC":
                by_reason["PVC (no kit family)"] += 1
            elif a["structure"] == "1P" and a["kitLocation"] == "Dead-end" and a["voltage"] != "LT":
                by_reason["HT Dead-end 1P (matrix excludes)"] += 1
            elif a["structure"] == "DTR":
                by_reason["DTR combo"] += 1
            else:
                by_reason["other"] += 1
            continue
        matched.append((a, kit))
        toks = pole_token_for_material(a["poleMaterial"])
        kit_toks = {v.get("poleToken") for v in kit.get("poleVariants") or []}
        if toks and not (set(toks) & kit_toks):
            no_pole_variant.append((a, kit, toks, sorted(kit_toks)))

    # Conductor kit coverage for span matching (any kit, not Final)
    cond_missing = []
    for voltage, conductors in [
        ("33kV", ["100", "150", "200"]),
        ("11kV", ["30", "50", "100", "ABC"]),
        ("LT", ["30", "50", "ABC", "PVC"]),
    ]:
        for tag in conductors:
            # structures that affect wire
            structs = ["1P"] if voltage != "LT" or is_cable(tag) else ["1P", "2P", "3P"]
            if voltage != "LT":
                structs = ["1P"]  # HT wire always 3W for span sample
            for st in structs:
                sample = {"voltage": voltage, "conductor": tag, "structure": st, "kitWire": derive_wire(voltage, tag, st)}
                if is_cable(tag):
                    want = "PVC" if tag.upper() == "PVC" else "ABC"
                    fam = [
                        k
                        for k in cond_kits
                        if k.get("voltage") == voltage
                        and (
                            k.get("conductorFamily") == want
                            or want in (k.get("conductorId") or "")
                        )
                    ]
                    if not fam:
                        cond_missing.append(sample)
                else:
                    sized = sized_ids(voltage, tag)
                    wire = derive_wire(voltage, tag, st)
                    hits = [
                        k
                        for k in cond_kits
                        if k.get("voltage") == voltage
                        and k.get("conductorId") in sized
                        and k.get("wireCount") == wire
                    ]
                    if not hits:
                        cond_missing.append(sample)

    print("=== Survey -> Structure kit coverage ===")
    print(f"Unique survey match-combos: {len(assets)}")
    print(f"Matched (any enabled kit):  {len(matched)}")
    print(f"Missing link:               {len(missing)}")
    print(f"Match rate:                 {100*len(matched)/len(assets):.1f}%")
    print()
    print("Missing by reason:")
    for r, n in by_reason.most_common():
        print(f"  {n:5d}  {r}")

    # Sample missing "other"
    others = [a for a in missing if a["conductor"].upper() != "PVC" and not (a["structure"] == "1P" and a["kitLocation"] == "Dead-end" and a["voltage"] != "LT") and a["structure"] != "DTR"]
    print()
    print(f"Sample 'other' gaps ({len(others)}):")
    for a in others[:15]:
        print(" ", asset_key(a))

    # DTR gaps sample
    dtr_miss = [a for a in missing if a["structure"] == "DTR"]
    print(f"\nSample DTR gaps ({len(dtr_miss)}):")
    for a in dtr_miss[:10]:
        print(" ", asset_key(a))

    # Final status
    final_ok = sum(1 for a, k in matched if k.get("complete"))
    print()
    print(f"Matched kits that are Final: {final_ok} / {len(matched)} (BOQ needs Final)")

    print()
    print("=== Pole material <-> poleVariants ===")
    print(f"Combos where material has no matching poleToken on kit: {len(no_pole_variant)}")
    # group by material×voltage
    mat_gaps = Counter()
    for a, kit, want, have in no_pole_variant:
        mat_gaps[(a["voltage"], a["poleMaterial"], tuple(want), tuple(have))] += 1
    for (v, m, want, have), n in mat_gaps.most_common(10):
        print(f"  {n:4d}  {v} {m} want {want} kit has {have}")

    print()
    print("=== Conductor (span) kit coverage ===")
    print(f"Missing conductor-kit links: {len(cond_missing)}")
    for s in cond_missing:
        print(" ", s)

    # Write gap report
    out = ROOT / "_coverage_gaps.json"
    out.write_text(
        json.dumps(
            {
                "total": len(assets),
                "matched": len(matched),
                "missing": [asset_key(a) for a in missing],
                "missingReasons": dict(by_reason),
                "conductorMissing": cond_missing,
                "poleMaterialGaps": len(no_pole_variant),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nWrote {out.name}")


if __name__ == "__main__":
    main()
