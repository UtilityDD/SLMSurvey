"""
Pre-seed structure / conductor / guarding kits with Mat + Lab lines.

Rules (user + utility practice):
- Poles per structure (1P/2P/3P/4P); DTR on 2P/4P includes transformer
- MS channel / angle / flat — size by voltage & conductor class
- Pin vs disc insulators by voltage; disc for sectional, 2P/3P/4P, DTR
- Stays for all Angular, and for 2P/3P/4P/DTR
- Earthing on structures
- ABC uses clamp / IPC family instead of bare-conductor pin/disc set
- With ext → pole extension labour
Quantities are starting estimates — fully editable in the UI.
"""
from __future__ import annotations


def line(code: str, qty: float, typ: str | None = None) -> dict:
    t = typ or ("labour" if str(code).upper().startswith("L") else "material")
    return {"code": code, "type": t, "qty": round(float(qty), 4)}


def poles_for(structure: str) -> int:
    if structure == "1P":
        return 1
    if structure in ("2P", "DTR2P"):
        return 2
    if structure == "3P":
        return 3
    if structure in ("4P", "DTR4P"):
        return 4
    return 1


def mount_structure(structure: str) -> str:
    """Underlying pole count family for DTR mounts."""
    if structure == "DTR2P":
        return "2P"
    if structure == "DTR4P":
        return "4P"
    return structure


def needs_stay(kit: dict) -> bool:
    loc = kit.get("location") or kit.get("position")
    st = mount_structure(kit.get("structure") or "")
    if loc == "Angular":
        return True
    if st in ("2P", "3P", "4P"):
        return True
    if kit.get("isDtr"):
        return True
    return False


def needs_disc(kit: dict) -> bool:
    """Disc for sectional arrangement, multi-pole, and DTR."""
    arr = kit.get("arrangement")
    st = mount_structure(kit.get("structure") or "")
    if arr == "Sectional":
        return True
    if st in ("2P", "3P", "4P"):
        return True
    if kit.get("isDtr"):
        return True
    return False


def conductor_class(kit: dict) -> str:
    """light / medium / heavy for steel sizing."""
    short = (kit.get("conductorShort") or "").lower()
    fam = kit.get("conductorFamily") or ""
    if fam == "ABC":
        return "abc"
    if any(x in short for x in ("squirrel", "weasel", "rabbit", "30", "50", "20")):
        return "light"
    if "dog" in short or "100" in short:
        return "medium"
    if any(x in short for x in ("wolf", "panther", "150", "200")):
        return "heavy"
    return "medium"


def steel_codes(voltage: str, cclass: str) -> tuple[str, str, str]:
    """Return (channel, angle, flat) Mat codes."""
    # Channel 75x40, Angle 50/65, Flat 50/65/75
    ch75, ch100 = "102010611", "102010911"
    ang50, ang65 = "101011011", "101011311"
    flat50, flat65, flat65x8, flat75 = "103011211", "103011511", "103011611", "103011911"

    if voltage == "LT" or cclass == "light":
        return ch75, ang50, flat50
    if voltage == "33kV" or cclass == "heavy":
        return ch100, ang65, flat65x8
    # 11kV medium / default
    if cclass == "medium":
        return ch75, ang65, flat65
    return ch75, ang65, flat65


def steel_qty_mt(poles: int, cclass: str) -> tuple[float, float, float]:
    """Placeholder MT quantities — user will refine."""
    base = 0.025 * poles
    if cclass == "heavy":
        base *= 1.4
    elif cclass == "light" or cclass == "abc":
        base *= 0.85
    return round(base, 3), round(base * 0.7, 3), round(base * 0.5, 3)


def stay_qty(kit: dict) -> int:
    st = mount_structure(kit.get("structure") or "")
    loc = kit.get("location") or kit.get("position")
    if kit.get("isDtr"):
        return 4 if st == "4P" else 3
    if st == "4P":
        return 4
    if st == "3P":
        return 3
    if st == "2P":
        return 2
    # 1P angular
    if loc == "Angular":
        return 2
    return 1


def pin_disc_qty(kit: dict, kind: str) -> int:
    """Insulator counts — rough starting values by wires/poles."""
    poles = poles_for(kit.get("structure") or "1P")
    wires = {"2W": 2, "3W": 3, "4W": 4}.get(kit.get("wireCount") or "3W", 3)
    if kit.get("conductorFamily") == "ABC":
        return poles  # clamps later
    if kind == "pin":
        # tangent-style: roughly 1 pin set per phase on SP
        return max(wires, 1) if poles == 1 else poles * max(wires - 1, 1)
    # disc — strain/sectional/multi-pole
    return poles * 2 if poles >= 2 else max(wires, 2)


def default_pole_code(kit: dict) -> str:
    allowed = kit.get("allowedPoleCodes") or []
    voltage = kit.get("voltage")
    if voltage == "LT" and "110030141" in allowed:
        return "110030141"  # 8m PCC
    if "110030241" in allowed:
        return "110030241"  # 9m PCC preferred default
    return allowed[0] if allowed else "110030241"


def erection_labour(kit: dict) -> list[dict]:
    voltage = kit.get("voltage")
    st = mount_structure(kit.get("structure") or "")
    lines = []
    if voltage == "LT":
        lines.append(line("L0007", 1))  # SP 8m LT
    elif st == "1P":
        lines.append(line("L0005", 1))  # SP 9m HT
    elif st == "2P":
        lines.append(line("L0008", 1))  # DP 9m
    elif st == "3P":
        lines.append(line("L0010", 1))  # TP 9m
    elif st == "4P":
        lines.append(line("L0011", 1))  # 4P 9m
    return lines


def seed_structure_kit(kit: dict) -> list[dict]:
    voltage = kit.get("voltage") or "11kV"
    structure = kit.get("structure") or "1P"
    poles = poles_for(structure)
    cclass = conductor_class(kit)
    fam = kit.get("conductorFamily") or "ACSR"
    lines: list[dict] = []

    # --- Poles ---
    pole = default_pole_code(kit)
    lines.append(line(pole, poles))

    # --- Steel ---
    ch, ang, flat = steel_codes(voltage, cclass)
    q_ch, q_ang, q_flat = steel_qty_mt(poles, cclass)
    lines.append(line(ch, q_ch))
    lines.append(line(ang, q_ang))
    lines.append(line(flat, q_flat))

    # --- Clamps / brackets (PCC) ---
    if pole.startswith("1100301"):  # PCC
        if pole == "110030141":
            lines.append(line("505034941", poles))  # clamp 8m
            if voltage == "11kV":
                lines.append(line("113020641", max(1, poles // 2 or 1)))  # V bracket 8m
                lines.append(line("113021241", 1))  # top adaptor 8m
        else:
            lines.append(line("505035041", poles))  # clamp 9m
            if voltage == "11kV":
                lines.append(line("113020741", max(1, poles // 2 or 1)))
                lines.append(line("113021341", 1))
            elif voltage == "33kV":
                lines.append(line("113020941", max(1, poles // 2 or 1)))
                lines.append(line("113021541", 1))

    # --- Insulators / ABC hardware ---
    if fam == "ABC":
        # Suspension on tangent-ish; anchoring on dead-end / sectional
        loc = kit.get("location") or kit.get("position")
        arr = kit.get("arrangement")
        if loc == "Dead-end" or arr == "Sectional":
            lines.append(line("505030341", poles))  # anchoring clamp
            lines.append(line("L0055", poles))
        else:
            lines.append(line("L0056", poles))  # suspension clamp labour
        lines.append(line("L0057", max(2, poles)))  # IPC
        if voltage == "LT":
            lines.append(line("508040441", poles * 2))  # shackle LT
            lines.append(line("L0042", poles * 2))
    else:
        if voltage == "LT":
            lines.append(line("508040441", pin_disc_qty(kit, "pin")))
            lines.append(line("L0042", pin_disc_qty(kit, "pin")))
            if needs_disc(kit):
                # LT still uses shackles heavily; keep extra shackles for strain
                lines.append(line("508040341", pin_disc_qty(kit, "disc")))
        elif voltage == "11kV":
            if needs_disc(kit):
                dq = pin_disc_qty(kit, "disc")
                lines.append(line("508030541", dq))  # 11kV disc
                lines.append(line("L0021", dq))
            else:
                pq = pin_disc_qty(kit, "pin")
                lines.append(line("508011141", pq))  # 11kV pin
                lines.append(line("L0020", pq))
            # ACSR hardware fittings by size (from seedFittingCodes if present)
            for code in kit.get("seedFittingCodes") or []:
                if str(code).startswith("50401"):
                    lines.append(line(code, 1))
        elif voltage == "33kV":
            if needs_disc(kit):
                dq = pin_disc_qty(kit, "disc")
                lines.append(line("508030641", dq))
                lines.append(line("L0088", dq))
            else:
                pq = pin_disc_qty(kit, "pin")
                lines.append(line("508011041", pq))
                lines.append(line("L0087", pq))
            for code in kit.get("seedFittingCodes") or []:
                if str(code).startswith("50401"):
                    lines.append(line(code, 1))

    # --- Stay ---
    if needs_stay(kit):
        sq = stay_qty(kit)
        if voltage == "LT":
            lines.append(line("504130332", sq))  # LT stay set
            lines.append(line("503050611", round(0.02 * sq, 3)))  # stay wire
            lines.append(line("508040741", sq))  # guy insulator LT
            lines.append(line("L0018", sq))
        else:
            lines.append(line("504130432", sq))  # HT stay set
            lines.append(line("503050911", round(0.025 * sq, 3)))
            lines.append(line("508040841", sq))  # guy insulator HT
            lines.append(line("L0017", sq))

    # --- Earthing ---
    earth_n = poles if kit.get("isDtr") or poles >= 2 else 1
    lines.append(line("504110541", earth_n))  # earth spike
    lines.append(line("L0019", earth_n))
    if kit.get("isDtr"):
        lines.append(line("L0069", 1))  # DTR neutral earthing

    # --- DTR material + labour from kit seeds ---
    if kit.get("isDtr"):
        if kit.get("dtrMatCode"):
            lines.append(line(kit["dtrMatCode"], 1))
        for code in kit.get("seedFittingCodes") or []:
            if str(code).upper().startswith("L") and code not in {x["code"] for x in lines}:
                lines.append(line(code, 1))

    # --- Erection ---
    lines.extend(erection_labour(kit))

    # --- Extension ---
    if kit.get("hasExtension"):
        lines.append(line("L0016", poles))  # extension up to 3m

    # Deduplicate codes by summing qty
    merged: dict[str, dict] = {}
    for ln in lines:
        code = ln["code"]
        if code in merged:
            merged[code]["qty"] = round(merged[code]["qty"] + ln["qty"], 4)
        else:
            merged[code] = dict(ln)
    return list(merged.values())


def seed_conductor_kit(kit: dict) -> list[dict]:
    lines = []
    if kit.get("seedMatCode"):
        lines.append(line(kit["seedMatCode"], 1))  # per km
    voltage = kit.get("voltage")
    wire = kit.get("wireCount")
    short = (kit.get("conductorShort") or "").lower()
    fam = kit.get("conductorFamily")

    if fam == "ABC":
        if "3x50" in (kit.get("conductorId") or "").lower() or "3×50" in short or "50" in short:
            lines.append(line("L0054", 1000))  # labour is per MTR in sheet — 1000 m = 1 km
        else:
            lines.append(line("L0053", 1000))
        return lines

    # ACSR stringing labour (per KM in Lab sheet)
    if voltage == "LT":
        if wire == "2W":
            lines.append(line("L0032", 1))
        elif wire == "4W":
            lines.append(line("L0031", 1))
        else:
            lines.append(line("L0030", 1))
    else:
        # HT mostly 3-wire
        if "dog" in short or "100" in short:
            lines.append(line("L0089", 1))
        elif "rabbit" in short or "50" in short:
            lines.append(line("L0029", 1))
        elif "weasel" in short or "30" in short:
            lines.append(line("L0030", 1))
        elif "panther" in short or "200" in short:
            lines.append(line("L0094", 1))
        else:
            lines.append(line("L0029", 1))
    return lines


def seed_guarding_kit(kit: dict) -> list[dict]:
    # GI wire 4mm + 5mm starter qty per km (MT placeholders)
    lines = [
        line("503010711", 0.15),
        line("503010811", 0.1),
        line("L0049", 20),  # cross lessing / related — editable
    ]
    return lines


def apply_seeds(matrix: dict) -> dict:
    for kit in matrix.get("structureKits") or []:
        kit["lines"] = seed_structure_kit(kit)
        kit["complete"] = False
        kit["seeded"] = True
    for kit in matrix.get("conductorKits") or []:
        kit["lines"] = seed_conductor_kit(kit)
        kit["complete"] = False
        kit["seeded"] = True
    for kit in matrix.get("addonKits") or []:
        if kit.get("addonType") == "Guarding":
            kit["lines"] = seed_guarding_kit(kit)
            kit["complete"] = False
            kit["seeded"] = True
    matrix["seedVersion"] = 1
    matrix["seedNote"] = (
        "Pre-seeded from Mat/Lab + domain rules. "
        "Review quantities; add/remove/edit freely in the Assembly Builder."
    )
    return matrix
