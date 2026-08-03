"""One-shot generator: Mat/Lab CSV -> ratebook.json + kit-matrix.json."""
from __future__ import annotations

import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAT_PATH = Path(os.environ["TEMP"]) / "slm_mat.csv"
LAB_PATH = Path(os.environ["TEMP"]) / "slm_lab.csv"

# Conductor options used for both structure fittings kits and per-km conductor kits.
# HT structure kits vary fittings by conductor size (e.g. Rabbit 50 vs Dog 100 on a DP).
# LT structure kits do NOT — same fittings for any size; only 2/3/4 wire (or cable) matters.
CONDUCTOR_DEFS = [
    {
        "id": "ACSR|Squirrel|20",
        "family": "ACSR",
        "short": "Squirrel 20",
        "name": "ACSR Squirrel (20 sqmm)",
        "voltageHints": ["LT"],
        "matCode": "502010321",
        # Hardware / fittings commonly paired with this size (from Mat sheet)
        "seedFittingCodes": ["504010132"],
    },
    {
        "id": "ACSR|Weasel|30",
        "family": "ACSR",
        "short": "Weasel 30",
        "name": "ACSR Weasel (30 sqmm)",
        "voltageHints": ["LT", "11kV"],
        "matCode": "502010621",
        "seedFittingCodes": ["504010132"],
    },
    {
        "id": "ACSR|Rabbit|50",
        "family": "ACSR",
        "short": "Rabbit 50",
        "name": "ACSR Rabbit (50 sqmm)",
        "voltageHints": ["LT", "11kV"],
        "matCode": "502010921",
        "seedFittingCodes": ["504010132"],
    },
    {
        "id": "ACSR|Dog|100",
        "family": "ACSR",
        "short": "Dog 100",
        "name": "ACSR Dog (100 sqmm)",
        "voltageHints": ["11kV", "33kV"],
        "matCode": "502011221",
        "seedFittingCodes": ["504010232", "505011141"],
    },
    {
        "id": "ACSR|Wolf|150",
        "family": "ACSR",
        "short": "Wolf 150",
        "name": "ACSR Wolf (150 sqmm)",
        "voltageHints": ["33kV"],
        "matCode": "502011521",
        "seedFittingCodes": ["504010332", "504010432"],
    },
    {
        "id": "ACSR|Panther|200",
        "family": "ACSR",
        "short": "Panther 200",
        "name": "ACSR Panther (200 sqmm)",
        "voltageHints": ["33kV"],
        "matCode": "502011821",
        "seedFittingCodes": ["504010532", "504010632"],
    },
    {
        "id": "ABC|LT|3x50",
        "family": "ABC",
        "short": "LT ABC 3×50",
        "name": "LT Aerial Bunched 3Cx50+1Cx16+1Cx35",
        "voltageHints": ["LT"],
        "matCode": "501030421",
        "seedFittingCodes": [],
    },
    {
        "id": "ABC|LT|3x70",
        "family": "ABC",
        "short": "LT ABC 3×70",
        "name": "LT Aerial Bunched 3Cx70+1Cx16+1Cx50",
        "voltageHints": ["LT"],
        "matCode": "501030521",
        "seedFittingCodes": [],
    },
    {
        "id": "ABC|HT|3x95",
        "family": "ABC",
        "short": "HT ABC 3×95",
        "name": "HT Aerial Bunched 11kV 3Cx95+1Cx70",
        "voltageHints": ["11kV"],
        "matCode": "501031121",
        "seedFittingCodes": [],
    },
    # LT PVC 1.1 kV — phone tags "PVC"; size chosen on conductor kits (Mat list).
    {
        "id": "PVC|LT|2x4",
        "family": "PVC",
        "short": "PVC 2×4",
        "name": "PVC 1.1kV 2Cx4 sqmm",
        "voltageHints": ["LT"],
        "matCode": "501012921",
        "seedFittingCodes": [],
    },
    {
        "id": "PVC|LT|2x6",
        "family": "PVC",
        "short": "PVC 2×6",
        "name": "PVC 1.1kV 2Cx6 sqmm",
        "voltageHints": ["LT"],
        "matCode": "501013021",
        "seedFittingCodes": [],
    },
    {
        "id": "PVC|LT|4x10",
        "family": "PVC",
        "short": "PVC 4×10",
        "name": "PVC 1.1kV 4Cx10 sqmm",
        "voltageHints": ["LT"],
        "matCode": "501017421",
        "seedFittingCodes": [],
    },
    {
        "id": "PVC|LT|4x25",
        "family": "PVC",
        "short": "PVC 4×25",
        "name": "PVC 1.1kV 4Cx25 sqmm",
        "voltageHints": ["LT"],
        "matCode": "501017821",
        "seedFittingCodes": [],
    },
    {
        "id": "PVC|LT|4x50",
        "family": "PVC",
        "short": "PVC 4×50",
        "name": "PVC 1.1kV 4Cx50 sqmm",
        "voltageHints": ["LT"],
        "matCode": "501017921",
        "seedFittingCodes": [],
    },
    {
        "id": "PVC|LT|4x120",
        "family": "PVC",
        "short": "PVC 4×120",
        "name": "PVC 1.1kV 4Cx120 sqmm",
        "voltageHints": ["LT"],
        "matCode": "501018121",
        "seedFittingCodes": [],
    },
    {
        "id": "PVC|LT|4x185",
        "family": "PVC",
        "short": "PVC 4×185",
        "name": "PVC 1.1kV 4Cx185 sqmm",
        "voltageHints": ["LT"],
        "matCode": "501018221",
        "seedFittingCodes": [],
    },
    {
        "id": "PVC|LT|4x300",
        "family": "PVC",
        "short": "PVC 4×300",
        "name": "PVC 1.1kV 4Cx300 sqmm",
        "voltageHints": ["LT"],
        "matCode": "501018321",
        "seedFittingCodes": [],
    },
]

# DTR capacities from Mat sheet (11kV distribution). Mounted on 2P (DP) or 4P only.
DTR_CAPACITIES = [
    {"id": "16kVA", "label": "16 kVA", "matCode": "301011041", "labourCodes": ["L0012"]},
    {"id": "25kVA", "label": "25 kVA", "matCode": "301018141", "labourCodes": ["L0013"]},
    {"id": "63kVA", "label": "63 kVA", "matCode": "301018241", "labourCodes": ["L0014"]},
    {"id": "100kVA", "label": "100 kVA", "matCode": "301018341", "labourCodes": ["L0015"]},
    {"id": "160kVA", "label": "160 kVA", "matCode": "3010113741", "labourCodes": []},
    {"id": "250kVA", "label": "250 kVA outdoor", "matCode": "301019641", "labourCodes": ["L0117"]},
    {"id": "315kVA-OD", "label": "315 kVA outdoor", "matCode": "301019141", "labourCodes": ["L0117"]},
    {"id": "315kVA-ID", "label": "315 kVA indoor", "matCode": "301019041", "labourCodes": ["L0117"]},
    {"id": "630kVA-OD-OIL", "label": "630 kVA outdoor oil", "matCode": "301019341", "labourCodes": []},
    {"id": "315kVA-DRY-OD", "label": "315 kVA dry outdoor", "matCode": "301019741", "labourCodes": []},
    {"id": "630kVA-DRY-OD", "label": "630 kVA dry outdoor", "matCode": "301019541", "labourCodes": []},
    {"id": "630kVA-DRY-ID", "label": "630 kVA dry indoor", "matCode": "301019441", "labourCodes": []},
]
DTR_MOUNTS = [
    {"id": "2P", "label": "DTR on 2P"},
    {"id": "4P", "label": "DTR on 4P"},
]

# Pole materials from Mat list (user picks per kit).
POLE_8M_PCC = "110030141"  # P C C POLE : 8M LONG — LT only; not for 33kV
POLE_OPTIONS = [
    {"code": "110030141", "label": "8m PCC"},
    {"code": "110030241", "label": "9m PCC"},
    {"code": "110010341", "label": "Steel tubular 9m"},
    {"code": "110011541", "label": "Steel tubular 9.5m"},
    {"code": "110010741", "label": "Steel tubular 11m"},
    {"code": "110020711", "label": "Rail pole 11–13m"},
    {"code": "110051211", "label": "Wide flange beam 13m"},
]


def parse_rate(s):
    if s is None:
        return None
    t = str(s).strip().replace(",", "")
    if not t:
        return None
    try:
        return round(float(t), 2)
    except ValueError:
        return None


def load_materials():
    items = []
    if not MAT_PATH.exists():
        # Keep existing ratebook if CSV missing
        existing = ROOT / "ratebook.json"
        if existing.exists():
            data = json.loads(existing.read_text(encoding="utf-8"))
            return data.get("materials", [])
        return []
    with MAT_PATH.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = (row.get("Materials Code") or "").strip()
            desc = (row.get("Description") or "").strip()
            if not code or not desc:
                continue
            origin = ""
            for v in row.values():
                if str(v).strip() in ("Central", "Local"):
                    origin = str(v).strip()
                    break
            items.append(
                {
                    "code": code,
                    "description": desc,
                    "unit": (row.get("Unit") or "").strip(),
                    "rate": parse_rate(row.get("Rate(Rs)")),
                    "origin": origin,
                    "type": "material",
                }
            )
    return items


def load_labour():
    items = []
    if not LAB_PATH.exists():
        existing = ROOT / "ratebook.json"
        if existing.exists():
            data = json.loads(existing.read_text(encoding="utf-8"))
            return data.get("labour", [])
        return []
    with LAB_PATH.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            code = (row.get("Labour Code") or "").strip()
            desc = (row.get("Description") or "").strip()
            if not code or not desc:
                continue
            items.append(
                {
                    "code": code,
                    "description": desc,
                    "unit": (row.get("Unit") or "").strip(),
                    "rate": parse_rate(row.get("Rate (Rs)")),
                    "origin": "",
                    "type": "labour",
                }
            )
    return items


def conductors_for_voltage(voltage: str):
    return [c for c in CONDUCTOR_DEFS if voltage in c["voltageHints"]]


def wire_options_for(voltage: str, conductor_family: str):
    """
    HT (11kV/33kV): ACSR is always 3-wire; ABC/cable has no multi-wire choice.
    LT: ACSR may be 2 / 3 / 4 wire; ABC/PVC are cable.
    """
    if conductor_family in ("ABC", "PVC"):
        return [{"id": None, "label": "cable"}]
    if voltage in ("33kV", "11kV"):
        return [{"id": "3W", "label": "3 wire"}]
    # LT bare conductor
    return [
        {"id": "2W", "label": "2 wire"},
        {"id": "3W", "label": "3 wire"},
        {"id": "4W", "label": "4 wire"},
    ]


def lt_structure_variants():
    """
    LT structure kits: one row per wire system (or cable), not per conductor size.
    Conductor size still appears on conductor (per-km) kits.
    """
    return size_agnostic_structure_variants("LT")


def size_agnostic_structure_variants(voltage: str):
    """One ACSR (any size) + ABC/PVC cable rows for the voltage's wire options."""
    variants = []
    for w in wire_options_for(voltage, "ACSR"):
        variants.append(
            {
                "id": f"{voltage}|ANY|ACSR",
                "family": "ACSR",
                "short": "",
                "name": f"Any {voltage} ACSR size",
                "seedFittingCodes": ["504010132"],
                "wire": w,
                "sizeAgnostic": True,
            }
        )
    for fam in ("ABC", "PVC"):
        if not any(
            c["family"] == fam and voltage in c["voltageHints"] for c in CONDUCTOR_DEFS
        ):
            continue
        for w in wire_options_for(voltage, fam):
            variants.append(
                {
                    "id": f"{voltage}|ANY|{fam}",
                    "family": fam,
                    "short": "",
                    "name": f"Any {voltage} {fam} size",
                    "seedFittingCodes": [],
                    "wire": w,
                    "sizeAgnostic": True,
                }
            )
    return variants


def is_size_agnostic_structure(
    voltage: str, structure_id: str, location_id: str, arrangement_id
) -> bool:
    """
    Structure fittings identical for any conductor size.
    - All LT structures
    - 11kV · 1P · Tangent · In-line arr. only
    """
    if voltage == "LT":
        return True
    if (
        voltage == "11kV"
        and structure_id == "1P"
        and location_id == "Tangent"
        and arrangement_id == "InlineArr"
    ):
        return True
    return False


def structure_conductor_variants(
    voltage: str,
    structure_id: str = "",
    location_id: str = "",
    arrangement_id=None,
):
    """Yield conductor×wire rows used to expand structure kits."""
    if is_size_agnostic_structure(voltage, structure_id, location_id, arrangement_id):
        return size_agnostic_structure_variants(voltage)
    out = []
    for c in conductors_for_voltage(voltage):
        for w in wire_options_for(voltage, c["family"]):
            out.append(
                {
                    "id": c["id"],
                    "family": c["family"],
                    "short": c["short"],
                    "name": c["name"],
                    "seedFittingCodes": list(c.get("seedFittingCodes") or []),
                    "wire": w,
                    "sizeAgnostic": False,
                }
            )
    return out


def allowed_pole_codes(voltage: str):
    """Poles selectable for this voltage from Mat list."""
    codes = [p["code"] for p in POLE_OPTIONS]
    if voltage == "LT":
        return [POLE_8M_PCC]
    if voltage == "33kV":
        # 33kV: choose from Mat poles except 8m PCC
        return [c for c in codes if c != POLE_8M_PCC]
    # 11kV: allow all for now (user may refine later)
    return codes


def build_matrix():
    voltages = ["33kV", "11kV", "LT"]
    structures = [
        {"id": "1P", "label": "1P"},
        {"id": "2P", "label": "2P"},
        {"id": "3P", "label": "3P"},
        {"id": "4P", "label": "4P"},
        {"id": "DTR", "label": "DTR"},
    ]
    # Practical rules (user domain tips):
    # LT: 8m SP only for line poles — no DP/TP/4P on normal locations.
    # 33kV: no DTR on normal locations; no Rabbit 50; poles from Mat except 8m PCC.
    # T-Off = take-off from existing network (start of new feeder).
    structures_by_voltage = {
        "33kV": ["1P", "2P", "3P", "4P"],
        # DTR is not a standalone structure — it mounts on 2P or 4P (see DTR kits below)
        "11kV": ["1P", "2P", "3P", "4P"],
        "LT": ["1P"],
    }
    # T-Off structure limits (user rules)
    structures_for_toff = {
        "LT": ["1P"],  # pole T-Off; DTR T-Off is separate
        "11kV": ["1P", "2P", "3P", "4P"],
        "33kV": ["1P", "2P", "3P", "4P"],
    }
    locations = [
        {"id": "Tangent", "label": "Tangent"},  # straight run (was misnamed In-line)
        {"id": "Angular", "label": "Angular"},
        {"id": "Dead-end", "label": "Dead-end"},
        {"id": "T-Off", "label": "T-Off"},  # take-off from existing network
    ]
    # Arrangement:
    # - Dead-end has none.
    # - 33/11kV 2P/3P/4P and DTR are always Sectional.
    # - HT 1P defaults In-line but may also be Sectional.
    # - LT retains both because P1 is the canonical kit structure for LT phase/wire variants.
    arrangements_tangent_angular = [
        {"id": "InlineArr", "label": "In-line arr."},
        {"id": "Sectional", "label": "Sectional"},
    ]
    # Guarding / raised clearance: every structure kit exists with or without extension
    extensions = [
        {"id": "NoExt", "label": "No ext", "hasExtension": False},
        {"id": "WithExt", "label": "With ext", "hasExtension": True},
    ]
    structure_by_id = {s["id"]: s for s in structures}

    def arrangements_for(voltage: str, structure_id: str, location_id: str):
        if location_id == "Dead-end":
            return [{"id": None, "label": None}]
        if voltage in ("33kV", "11kV") and structure_id != "1P":
            return [{"id": "Sectional", "label": "Sectional"}]
        return arrangements_tangent_angular

    def structures_allowed(voltage: str, location_id: str):
        if location_id == "T-Off":
            return structures_for_toff[voltage]
        return structures_by_voltage[voltage]

    structure_kits = []
    for v in voltages:
        poles = allowed_pole_codes(v)
        for loc in locations:
            for sid in structures_allowed(v, loc["id"]):
                s = structure_by_id[sid]
                # HT dead-end is never a single pole
                if v in ("33kV", "11kV") and loc["id"] == "Dead-end" and sid == "1P":
                    continue
                for arr in arrangements_for(v, sid, loc["id"]):
                    for c in structure_conductor_variants(
                        v, s["id"], loc["id"], arr["id"]
                    ):
                        for ext in extensions:
                            w = c["wire"]
                            if v == "LT":
                                    notes = (
                                        "LT practice: 8m PCC SP only. "
                                        "Structure fittings are the same for any conductor size — "
                                        "pick size on the Conductor kit (per km)."
                                    )
                                    pole_hint = "8m PCC"
                            elif v == "33kV":
                                    notes = (
                                        "33kV: no DTR, no Rabbit 50. "
                                        "Pick pole from Mat list (not 8m PCC). "
                                        "ACSR is 3-wire only (or cable)."
                                    )
                                    pole_hint = "from Mat (excl. 8m PCC)"
                            elif v == "11kV":
                                    notes = "11kV: ACSR is 3-wire only (or cable)."
                                    pole_hint = None
                            else:
                                    notes = ""
                                    pole_hint = None
                            if loc["id"] == "T-Off":
                                    if v == "LT":
                                        notes = (
                                            "LT T-Off: start of new network from existing network "
                                            "(existing or new SP; In-line/Sectional; With/No ext). "
                                            "For take-off at DTR use the LT DTR T-Off kits. "
                                            "Any conductor size — size is on Conductor kit."
                                        )
                                    elif v == "11kV":
                                        notes = (
                                            "11kV T-Off: start of new network from existing network "
                                            "(SP/DP/TP/4P existing or new; In-line/Sectional; With/No ext). "
                                            "For take-off at DTR use the 11kV DTR T-Off kits."
                                        )
                                    elif v == "33kV":
                                        notes = (
                                            "33kV T-Off: start of new network from existing network "
                                            "(1P/2P/3P/4P; In-line/Sectional; With/No ext)."
                                        )
                            if c.get("sizeAgnostic") and v == "11kV" and loc["id"] == "Tangent":
                                    notes = (
                                        "11kV 1P Tangent In-line: structure fittings are the same "
                                        "for any conductor size — pick size on the Conductor kit (per km). "
                                        "ACSR is 3-wire only (or cable)."
                                    )
                            if v in ("33kV", "11kV") and loc["id"] == "Dead-end":
                                    notes = (
                                        (notes + " " if notes else "")
                                        + "Dead-end is never 1P on HT."
                                    ).strip()
                            if loc["id"] != "Dead-end" and arr["label"]:
                                    notes = (
                                        (notes + " " if notes else "")
                                        + f"Location {loc['label']}; arrangement {arr['label']}."
                                    ).strip()
                            if ext["hasExtension"]:
                                    notes = (
                                        (notes + " " if notes else "")
                                        + "Include pole extension + guarding hardware for this structure. "
                                        "GI wire etc. by guarded length is under Guarding add-ons."
                                    ).strip()
                            else:
                                    notes = (
                                        (notes + " " if notes else "")
                                        + "Standard structure without extension."
                                    ).strip()

                            wire_id = w["id"]
                            wire_label = w["label"]
                            wire_part = wire_id if wire_id else "cable"
                            if arr["id"]:
                                    kit_id = (
                                        f"STR|{v}|{s['id']}|{loc['id']}|{arr['id']}|"
                                        f"{c['id']}|{wire_part}|{ext['id']}"
                                    )
                            else:
                                    kit_id = (
                                        f"STR|{v}|{s['id']}|{loc['id']}|"
                                        f"{c['id']}|{wire_part}|{ext['id']}"
                                    )

                            structure_kits.append(
                                    {
                                        "id": kit_id,
                                        "family": "structure",
                                        "voltage": v,
                                        "structure": s["id"],
                                        "structureLabel": s["label"],
                                        "location": loc["id"],
                                        "locationLabel": loc["label"],
                                        "position": loc["id"],  # legacy alias
                                        "arrangement": arr["id"],
                                        "arrangementLabel": arr["label"],
                                        "conductorFamily": c["family"],
                                        "conductorId": c["id"],
                                        "conductorShort": c["short"],
                                        "conductorName": c["name"],
                                        "conductorSizeAgnostic": bool(c.get("sizeAgnostic")),
                                        "wireCount": wire_id,
                                        "wireLabel": wire_label,
                                        "extension": ext["id"],
                                        "extensionLabel": ext["label"],
                                        "hasExtension": ext["hasExtension"],
                                        "poleHeightHint": pole_hint,
                                        "allowedPoleCodes": poles,
                                        "qtyBasis": "per_structure",
                                        "seedFittingCodes": list(c.get("seedFittingCodes") or []),
                                        "enabled": True,
                                        "complete": False,
                                        "lines": [],
                                        "notes": notes,
                                    }
                                )

    # 11kV DTR kits (incl. T-Off): transformer on 2P (DP) or 4P mount
    v = "11kV"
    poles = allowed_pole_codes(v)
    for mount in DTR_MOUNTS:
        for loc in locations:
            for arr in arrangements_for(v, "DTR", loc["id"]):
                for c in conductors_for_voltage(v):
                    for w in wire_options_for(v, c["family"]):
                        for ext in extensions:
                            for dtr in DTR_CAPACITIES:
                                wire_id = w["id"]
                                wire_label = w["label"]
                                wire_part = wire_id if wire_id else "cable"
                                if arr["id"]:
                                    kit_id = (
                                        f"STR|{v}|DTR|{mount['id']}|{loc['id']}|{arr['id']}|"
                                        f"{c['id']}|{wire_part}|{ext['id']}|{dtr['id']}"
                                    )
                                else:
                                    kit_id = (
                                        f"STR|{v}|DTR|{mount['id']}|{loc['id']}|"
                                        f"{c['id']}|{wire_part}|{ext['id']}|{dtr['id']}"
                                    )
                                seeds = list(c.get("seedFittingCodes") or [])
                                seeds.append(dtr["matCode"])
                                seeds.extend(dtr.get("labourCodes") or [])
                                notes = (
                                    f"11kV DTR {dtr['label']} on {mount['id']} mount. "
                                    "ACSR is 3-wire only (or cable). "
                                    "Seed includes DTR material"
                                    + (" + erection labour." if dtr.get("labourCodes") else ".")
                                )
                                if loc["id"] == "T-Off":
                                    notes += (
                                        " T-Off: new feeder starts from this DTR "
                                        "(take-off from existing network)."
                                    )
                                if loc["id"] != "Dead-end" and arr["label"]:
                                    notes += f" Location {loc['label']}; arrangement {arr['label']}."
                                if ext["hasExtension"]:
                                    notes += " With pole extension / guarding hardware."
                                structure_kits.append(
                                    {
                                        "id": kit_id,
                                        "family": "structure",
                                        "voltage": v,
                                        "structure": f"DTR{mount['id']}",
                                        "structureLabel": mount["label"],
                                        "dtrMount": mount["id"],
                                        "dtrCapacity": dtr["id"],
                                        "dtrCapacityLabel": dtr["label"],
                                        "dtrMatCode": dtr["matCode"],
                                        "isDtr": True,
                                        "location": loc["id"],
                                        "locationLabel": loc["label"],
                                        "position": loc["id"],
                                        "arrangement": arr["id"],
                                        "arrangementLabel": arr["label"],
                                        "conductorFamily": c["family"],
                                        "conductorId": c["id"],
                                        "conductorShort": c["short"],
                                        "conductorName": c["name"],
                                        "wireCount": wire_id,
                                        "wireLabel": wire_label,
                                        "extension": ext["id"],
                                        "extensionLabel": ext["label"],
                                        "hasExtension": ext["hasExtension"],
                                        "poleHeightHint": "from Mat (DTR mount)",
                                        "allowedPoleCodes": poles,
                                        "qtyBasis": "per_structure",
                                        "seedFittingCodes": seeds,
                                        "enabled": True,
                                        "complete": False,
                                        "lines": [],
                                        "notes": notes,
                                    }
                                )

    # LT DTR T-Off only: take-off of new LT network from a DTR (size-agnostic)
    v = "LT"
    poles = allowed_pole_codes(v)
    for mount in DTR_MOUNTS:
        for arr in arrangements_for(v, "DTR", "T-Off"):
            for c in size_agnostic_structure_variants(v):
                for ext in extensions:
                    w = c["wire"]
                    wire_id = w["id"]
                    wire_label = w["label"]
                    wire_part = wire_id if wire_id else "cable"
                    kit_id = (
                        f"STR|{v}|DTR|{mount['id']}|T-Off|{arr['id']}|"
                        f"{c['id']}|{wire_part}|{ext['id']}"
                    )
                    notes = (
                        f"LT T-Off from DTR on {mount['id']} mount. "
                        "Start of new LT network from existing DTR. "
                        "Any conductor size — size is on Conductor kit. "
                        f"Arrangement {arr['label']}."
                    )
                    if ext["hasExtension"]:
                        notes += " With pole extension / guarding hardware."
                    structure_kits.append(
                        {
                            "id": kit_id,
                            "family": "structure",
                            "voltage": v,
                            "structure": f"DTR{mount['id']}",
                            "structureLabel": f"DTR on {mount['id']} (T-Off)",
                            "dtrMount": mount["id"],
                            "isDtr": True,
                            "location": "T-Off",
                            "locationLabel": "T-Off",
                            "position": "T-Off",
                            "arrangement": arr["id"],
                            "arrangementLabel": arr["label"],
                            "conductorFamily": c["family"],
                            "conductorId": c["id"],
                            "conductorShort": c["short"],
                            "conductorName": c["name"],
                            "conductorSizeAgnostic": True,
                            "wireCount": wire_id,
                            "wireLabel": wire_label,
                            "extension": ext["id"],
                            "extensionLabel": ext["label"],
                            "hasExtension": ext["hasExtension"],
                            "poleHeightHint": "8m PCC / DTR mount",
                            "allowedPoleCodes": poles,
                            "qtyBasis": "per_structure",
                            "seedFittingCodes": list(c.get("seedFittingCodes") or []),
                            "enabled": True,
                            "complete": False,
                            "lines": [],
                            "notes": notes,
                        }
                    )

    conductor_kits = []
    for c in CONDUCTOR_DEFS:
        for vh in c["voltageHints"]:
            for w in wire_options_for(vh, c["family"]):
                if c["family"] == "ACSR":
                    conductor_kits.append(
                        {
                            "id": f"CON|{vh}|{c['id']}|{w['id']}",
                            "family": "conductor",
                            "voltage": vh,
                            "conductorFamily": c["family"],
                            "conductorId": c["id"],
                            "conductorShort": c["short"],
                            "conductorName": c["name"],
                            "wireCount": w["id"],
                            "wireLabel": w["label"],
                            "qtyBasis": "per_km",
                            "seedMatCode": c["matCode"],
                            "enabled": True,
                            "complete": False,
                            "lines": [],
                            "notes": (
                                "HT ACSR is 3-wire only."
                                if vh in ("33kV", "11kV")
                                else "LT may be 2 / 3 / 4 wire."
                            ),
                        }
                    )
                else:
                    conductor_kits.append(
                        {
                            "id": f"CON|{vh}|{c['id']}",
                            "family": "conductor",
                            "voltage": vh,
                            "conductorFamily": c["family"],
                            "conductorId": c["id"],
                            "conductorShort": c["short"],
                            "conductorName": c["name"],
                            "wireCount": None,
                            "wireLabel": "cable",
                            "qtyBasis": "per_km",
                            "seedMatCode": c["matCode"],
                            "enabled": True,
                            "complete": False,
                            "lines": [],
                            "notes": "Aerial bunched / cable run.",
                        }
                    )

    # Guarding add-ons (GI wire etc. by guarded run length). Structure extension stays in structure kits.
    GUARD_SEED_GI = ["503010711", "503010811"]  # G.I. WIRE 4mm / 5mm from Mat
    addon_kits = []
    for v in voltages:
        addon_kits.append(
            {
                "id": f"ADD|Guarding|{v}",
                "family": "addon",
                "voltage": v,
                "addonType": "Guarding",
                "label": "Guarding",
                "hint": "GI wire / stay wire etc. by guarded length",
                "structure": None,
                "structureLabel": None,
                "qtyBasis": "per_km",
                "seedFittingCodes": list(GUARD_SEED_GI),
                "enabled": True,
                "complete": False,
                "lines": [],
                "notes": (
                    "Guarding add-on per km of guarded run. "
                    "Structure extension + guarding hardware belong in the structure kit (With ext)."
                ),
            }
        )

    return {
        "version": 13,
        "qtyBasisLabels": {
            "per_structure": "Per 1 proposed structure (with or without extension)",
            "per_km": "Per 1 km (conductor, stringing, or guarding run)",
        },
        "structureKits": structure_kits,
        "conductorKits": conductor_kits,
        "addonKits": addon_kits,
        # User-created kits live in Assembly Builder / publish payload.
        # Regenerating this file must not invent customs; keep an empty slot.
        "customKits": [],
        "domainRules": {
            "33kV": {
                "structures": ["1P", "2P", "3P", "4P"],
                "excludeConductors": ["ACSR|Rabbit|50"],
                "excludeStructures": ["DTR"],
                "deadEndNever": ["1P"],
                "tOffOnly": ["1P", "2P", "3P", "4P"],
                "wireOptions": ["3W"],
                "cableOk": True,
                "allowedPoleCodes": allowed_pole_codes("33kV"),
                "excludedPoleCodes": [POLE_8M_PCC],
                "note": "33kV: no DTR, no Rabbit 50, dead-end never 1P, T-Off 1P/2P/3P/4P, ACSR 3-wire or cable only.",
            },
            "11kV": {
                "structures": ["1P", "2P", "3P", "4P", "DTR2P", "DTR4P"],
                "deadEndNever": ["1P"],
                "wireOptions": ["3W"],
                "cableOk": True,
                "dtrMounts": ["2P", "4P"],
                "dtrCapacities": [d["id"] for d in DTR_CAPACITIES],
                "allowedPoleCodes": allowed_pole_codes("11kV"),
                "note": "11kV: poles include Rail; dead-end never 1P; T-Off SP/DP/TP/4P or DTR; ACSR 3-wire or cable; DTR on 2P or 4P with sheet capacities.",
            },
            "LT": {
                "structures": ["1P", "DTR2P", "DTR4P"],
                "poleHeight": "8m",
                "wireOptions": ["2W", "3W", "4W"],
                "cableOk": True,
                "allowedPoleCodes": [POLE_8M_PCC],
                "note": "LT: 8m SP for line poles; T-Off SP or from DTR; structure kits by 2/3/4 wire or cable (any conductor size); size is on Conductor kits.",
            },
        },
        "poleOptions": POLE_OPTIONS,
        "notes": (
            "HT structure kits usually include conductor size because hardware fittings differ. "
            "Exceptions (size-agnostic structure kits): all LT; and 11kV · 1P · Tangent · In-line arr. "
            "Conductor kits cover wire/cable + stringing per km (still by size). "
            "LT: 8m SP only for line poles. "
            "Location: Tangent / Angular / Dead-end / T-Off. "
            "T-Off = take-off where new network starts from existing network. "
            "LT T-Off: SP (existing or new) In-line/Sectional × ext, or from DTR. "
            "11kV T-Off: SP/DP/TP/4P (existing or new) or DTR. "
            "33kV T-Off: 1P/2P/3P/4P. "
            "For 33/11kV, 2P/3P/4P and DTR are Sectional-only; 1P defaults In-line "
            "but may also be Sectional; Dead-end has no arrangement split. "
            "33kV: no DTR on normal locations; no Rabbit 50; pole from Mat except 8m PCC. "
            "11kV: poles include Rail (and PCC / H-pole / tubular). "
            "11kV/33kV: dead-end is never single pole (1P); 33kV dead-end 2P/3P/4P; "
            "11kV dead-end also allows DTR. "
            "11kV/33kV: ACSR always 3-wire or cable; LT ACSR may be 2/3/4 wire; LT PVC is cable. "
            "DTR is 11kV on all locations (incl. T-Off); LT DTR kits are T-Off only. "
            "Guarding/extension is part of the structure kit (With ext / No ext). "
            "Guarding add-ons are for GI wire etc. by guarded run length (per km)."
        ),
        "dtrCapacities": DTR_CAPACITIES,
    }


def main():
    materials = load_materials()
    labour = load_labour()
    # Preserve existing ratebook if CSV not present and load returned empty somehow
    ratebook_path = ROOT / "ratebook.json"
    if not materials and ratebook_path.exists():
        old = json.loads(ratebook_path.read_text(encoding="utf-8"))
        materials = old.get("materials", [])
        labour = labour or old.get("labour", [])

    ratebook = {
        "version": "FY-import",
        "source": "Google Sheet Mat + Lab tabs",
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "materials": materials,
        "labour": labour,
    }
    if materials:
        ratebook_path.write_text(json.dumps(ratebook, indent=2), encoding="utf-8")

    matrix = build_matrix()
    from _seed_rules import apply_seeds

    matrix = apply_seeds(matrix)
    (ROOT / "kit-matrix.json").write_text(json.dumps(matrix, indent=2), encoding="utf-8")

    seeded_lines = sum(len(k.get("lines") or []) for k in matrix["structureKits"])
    print(
        f"materials={len(materials)} labour={len(labour)} "
        f"structure={len(matrix['structureKits'])} "
        f"conductor={len(matrix['conductorKits'])} "
        f"addon={len(matrix['addonKits'])} "
        f"structureLineItems={seeded_lines} "
        f"seedVersion={matrix.get('seedVersion')}"
    )


if __name__ == "__main__":
    main()
