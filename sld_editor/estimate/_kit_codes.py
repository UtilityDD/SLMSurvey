"""
Short alphanumeric structure-kit codes for Assembly Builder.

Keep long pipe `id` as the technical key (matching / publish).
`code` is human-facing and includes pole type as a first-class token.

Example: 33-1P-TAN-INL-9M-DOG-3W-NX
"""
from __future__ import annotations

# Mat sheet pole code → (token, label). Tokens stay short for outdoor/board use.
POLE_META: dict[str, tuple[str, str]] = {
    "110030141": ("8M", "8m PCC"),
    "110030241": ("9M", "9m PCC"),
    "110010341": ("T9", "Tubular 9m"),
    "110011541": ("T95", "Tubular 9.5m"),
    "110010741": ("T11", "Tubular 11m"),
    "110020711": ("RL", "Rail"),
    "110051211": ("WF", "Wide flange 13m"),
}

# Android H-Pole ≈ steel tubular / beam — prefer these when matching later.
H_POLE_TOKENS = ("T9", "T95", "T11", "WF")


def pole_token(pole_code: str | None) -> str:
    if not pole_code:
        return "POL"
    meta = POLE_META.get(str(pole_code))
    return meta[0] if meta else "POL"


def pole_label(pole_code: str | None) -> str:
    if not pole_code:
        return "Pole"
    meta = POLE_META.get(str(pole_code))
    return meta[1] if meta else str(pole_code)


def mount_structure(structure: str | None) -> str:
    st = structure or ""
    if st == "DTR2P":
        return "2P"
    if st == "DTR4P":
        return "4P"
    return st


def poles_qty(structure: str | None) -> int:
    st = mount_structure(structure)
    return {"1P": 1, "2P": 2, "3P": 3, "4P": 4}.get(st, 1)


# Known erection labour codes used when swapping pole variants in the UI.
ERECTION_LABOUR_CODES = frozenset(
    {
        "L0005",
        "L0006",
        "L0007",
        "L0008",
        "L0009",
        "L0010",
        "L0011",
        "L0084",
        "L0085",
        "L0086",
        "L0091",
        "L0092",
        "L0093",
    }
)


def erection_labour_codes(kit: dict, pole_code: str | None = None) -> list[str]:
    """Ratebook labour codes for erecting this structure with the given pole."""
    voltage = kit.get("voltage") or ""
    st = mount_structure(kit.get("structure") or "")
    pc = pole_code or kit.get("poleCode") or default_pole_code(kit)
    tok = pole_token(pc)

    # Rail / wide-flange → dedicated rail/H-beam erection items
    if tok in ("RL", "WF"):
        return {
            "1P": ["L0084"],
            "2P": ["L0085"],
            "3P": ["L0085"],
            "4P": ["L0086"],
        }.get(st, ["L0084"])

    if tok == "8M":
        if voltage == "LT" and st == "1P":
            return ["L0007"]
        return {
            "1P": ["L0006"],  # SP 8m HT
            "2P": ["L0009"],  # DP 8m
            "3P": ["L0010"],  # no dedicated 8m TP — nearest
            "4P": ["L0091"],  # 4P 8m PCC
        }.get(st, ["L0006"])

    # 9m PCC + tubular steel → 9m erection family
    if voltage == "LT" and st == "1P":
        return ["L0007"]
    return {
        "1P": ["L0005"],
        "2P": ["L0008"],
        "3P": ["L0010"],
        "4P": ["L0011"],
    }.get(st, ["L0005"])


def default_pole_code(kit: dict) -> str:
    allowed = kit.get("allowedPoleCodes") or []
    voltage = kit.get("voltage")
    if voltage == "LT" and "110030141" in allowed:
        return "110030141"
    if "110030241" in allowed:
        return "110030241"
    if allowed:
        return allowed[0]
    return "110030241"


def voltage_token(voltage: str | None) -> str:
    return {"33kV": "33", "11kV": "11", "LT": "LT"}.get(voltage or "", voltage or "V")


def structure_token(kit: dict) -> str:
    st = kit.get("structure") or ""
    if st.startswith("DTR"):
        mount = kit.get("dtrMount") or st.replace("DTR", "") or "2P"
        return f"D{mount[0]}" if mount else "D2"  # D2 / D4
    return st or "1P"


def location_token(location: str | None) -> str:
    return {
        "Tangent": "TAN",
        "Angular": "ANG",
        "Dead-end": "DE",
        "T-Off": "TOF",
    }.get(location or "", "LOC")


def arrangement_token(arrangement: str | None) -> str | None:
    if not arrangement:
        return None
    return {"InlineArr": "INL", "Sectional": "SEC"}.get(arrangement, "ARR")


def conductor_token(kit: dict) -> str:
    if kit.get("conductorSizeAgnostic"):
        fam = kit.get("conductorFamily") or ""
        if fam == "ABC":
            return "ABC"
        if fam == "PVC":
            return "PVC"
        return "ACSR"
    cid = (kit.get("conductorId") or "").upper()
    short = (kit.get("conductorShort") or "").upper().replace(" ", "")
    blob = f"{cid}|{short}"
    for needle, token in (
        ("SQUIRREL", "SQR"),
        ("WEASEL", "WEA"),
        ("RABBIT", "RAB"),
        ("DOG", "DOG"),
        ("WOLF", "WLF"),
        ("PANTHER", "PTH"),
        ("ABC", "ABC"),
        ("PVC", "PVC"),
    ):
        if needle in blob:
            return token
    fam = kit.get("conductorFamily") or "COND"
    return fam[:4].upper()


def wire_token(kit: dict) -> str:
    fam = kit.get("conductorFamily") or ""
    if fam in ("ABC", "PVC") or kit.get("wireLabel") == "cable" or not kit.get("wireCount"):
        if fam in ("ABC", "PVC") or kit.get("wireLabel") == "cable":
            return "CAB"
    wc = kit.get("wireCount")
    if wc in ("2W", "3W", "4W"):
        return wc
    return "3W"


def extension_token(kit: dict) -> str:
    return "WX" if kit.get("hasExtension") or kit.get("extension") == "WithExt" else "NX"


def family_key(kit: dict) -> str:
    """Group key for board families: voltage|structure (e.g. 33|1P)."""
    return f"{voltage_token(kit.get('voltage'))}|{structure_token(kit)}"


def build_structure_code(kit: dict, pole_code: str | None = None) -> str:
    """
    Build short code. Pole is required for a complete variant code.
    Dead-end omits arrangement. DTR appends capacity when present.
    """
    pole = pole_code or kit.get("poleCode") or default_pole_code(kit)
    parts = [
        voltage_token(kit.get("voltage")),
        structure_token(kit),
        location_token(kit.get("location") or kit.get("position")),
    ]
    arr = arrangement_token(kit.get("arrangement"))
    if arr:
        parts.append(arr)
    parts.append(pole_token(pole))
    parts.append(conductor_token(kit))
    parts.append(wire_token(kit))
    parts.append(extension_token(kit))
    dtr = kit.get("dtrCapacity")
    if dtr:
        # 16kVA → 16
        parts.append(str(dtr).replace("kVA", "").replace("-", "")[:6])
    return "-".join(parts)


def attach_structure_codes(kit: dict) -> None:
    """Stamp code, familyKey, pole fields, and poleVariants onto a structure kit."""
    if kit.get("family") != "structure":
        return
    allowed = list(kit.get("allowedPoleCodes") or [])
    pole = kit.get("poleCode") or default_pole_code(kit)
    if pole not in allowed and allowed:
        # Prefer stamped/default even if list empty edge case
        pass
    kit["poleCode"] = pole
    kit["poleToken"] = pole_token(pole)
    kit["poleLabel"] = pole_label(pole)
    kit["familyKey"] = family_key(kit)
    kit["code"] = build_structure_code(kit, pole)

    variants = []
    seen = set()
    for pc in allowed or [pole]:
        if pc in seen:
            continue
        seen.add(pc)
        variants.append(
            {
                "poleCode": pc,
                "matCode": pc,
                "poleToken": pole_token(pc),
                "poleLabel": pole_label(pc),
                "code": build_structure_code(kit, pc),
                "labourCodes": erection_labour_codes(kit, pc),
                "isDefault": pc == pole,
            }
        )
    kit["poleVariants"] = variants
