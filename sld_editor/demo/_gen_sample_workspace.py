"""
Regenerate demo survey with GPS-based span lengths that respect app limits
(ContinueSpanGuidance in NetworkCatalog.kt).

Limits used:
- LT ABC: max 40 m
- 11/33 kV · 9m PCC: max 70 m
- 11/33 kV · Rail: max 80 m
- Other LT / H-Pole / 8m: typical field spans (no hard app cap)
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "sample_workspace_33_11_lt.json"

EARTH_R = 6_371_000.0
# Near Asansol, WB
BASE_LAT, BASE_LNG = 23.6850, 86.9510

LT_ABC_MAX = 40.0
HT_9M_MAX = 70.0
HT_RAIL_MAX = 80.0


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def offset_m(lat: float, lng: float, east_m: float, north_m: float) -> tuple[float, float]:
    d_lat = north_m / 111_320.0
    d_lng = east_m / (111_320.0 * math.cos(math.radians(lat)))
    return round(lat + d_lat, 7), round(lng + d_lng, 7)


def max_span(voltage: str, material: str, conductor: str) -> float | None:
    if voltage == "LT":
        return LT_ABC_MAX if conductor.upper() == "ABC" else None
    if voltage in ("11kV", "33kV"):
        if material == "9m PCC":
            return HT_9M_MAX
        if material == "Rail":
            return HT_RAIL_MAX
    return None


def target_span(voltage: str, material: str, conductor: str, i: int) -> float:
    """Typical GPS span under the applicable limit (vary slightly along the line)."""
    cap = max_span(voltage, material, conductor)
    if voltage == "LT":
        if conductor.upper() == "ABC":
            base = 32.0 + (i % 4) * 1.5  # 32–36.5 < 40
        elif conductor.upper() == "PVC":
            base = 28.0 + (i % 3) * 2.0
        else:
            base = 30.0 + (i % 5) * 1.2
    else:
        if material == "Rail":
            base = 55.0 + (i % 5) * 3.5  # 55–69 < 80
        elif material == "9m PCC":
            base = 48.0 + (i % 5) * 3.0  # 48–60 < 70
        elif material == "8m PCC":
            base = 40.0 + (i % 4) * 2.5
        else:  # H-Pole / tubular
            base = 45.0 + (i % 4) * 3.0
    if cap is not None:
        base = min(base, cap - 1.0)
    return round(base, 1)


def fmt_span(m: float) -> str:
    # App stores string metres; one decimal like field GPS round-off
    return f"{m:.1f}"


def main():
    assets = []
    conns = []
    aid = 1
    cid = 1

    def add_pole(**kw):
        nonlocal aid
        a = {
            "id": aid,
            "sequence": kw.get("sequence", aid),
            "latitude": kw["lat"],
            "longitude": kw["lng"],
            "voltage": kw["voltage"],
            "status": kw.get("status", "Proposed"),
            "type": kw.get("type", "Pole"),
            "poleRole": kw.get("poleRole", "CONTINUE"),
            "poleMaterial": kw["poleMaterial"],
            "poleHeightM": kw.get("poleHeightM"),
            "conductor": kw["conductor"],
            "circuit": kw.get("circuit", 1),
            "spanLengthM": kw.get("spanLengthM"),
            "dtCapacityKva": kw.get("dtCapacityKva"),
            "stayType": None,
            "earthingType": None,
            "remarks": kw.get("remarks"),
            "structure": kw["structure"],
            "seriesId": kw["seriesId"],
            "kitLocation": kw.get("kitLocation"),
            "kitArrangement": kw.get("kitArrangement"),
            "kitExtension": kw.get("kitExtension", "No ext"),
            "dtrMount": kw.get("dtrMount"),
            "kitWire": kw.get("kitWire"),
            "guarding": kw.get("guarding", False),
            "deviceLatitude": kw["lat"],
            "deviceLongitude": kw["lng"],
            "deviceAccuracyM": 4.2,
            "deviceFixTimestamp": 1720000000000 + aid * 1000,
            "distanceFromDeviceM": 3.1,
            "isMockLocation": False,
            "locationVerified": True,
            "satsUsedInFix": 14,
            "satsVisible": 18,
            "avgSnrDb": 32.0,
        }
        assets.append(a)
        aid += 1
        return a

    def link(frm: dict, to: dict, voltage: str):
        nonlocal cid
        dist = haversine_m(frm["latitude"], frm["longitude"], to["latitude"], to["longitude"])
        span = fmt_span(dist)
        to["spanLengthM"] = span
        conns.append(
            {
                "id": cid,
                "fromAssetId": frm["id"],
                "toAssetId": to["id"],
                "voltage": voltage,
                "status": "Proposed",
                "spanLengthM": span,
            }
        )
        cid += 1

    def place_chain(specs: list[dict], start_lat, start_lng, bearing_deg: float, series_id: int):
        """Place poles along a bearing; each step uses target_span for that pole's mat/cond."""
        rad = math.radians(bearing_deg)
        east_u, north_u = math.sin(rad), math.cos(rad)
        poles = []
        lat, lng = start_lat, start_lng
        for i, spec in enumerate(specs):
            if i > 0:
                prev = specs[i - 1]
                # Span governed by destination pole material/conductor (app continue tip → new)
                span = target_span(
                    spec["voltage"],
                    spec["poleMaterial"],
                    spec["conductor"],
                    i,
                )
                lat, lng = offset_m(lat, lng, east_u * span, north_u * span)
            p = add_pole(
                lat=lat,
                lng=lng,
                seriesId=series_id,
                poleRole="START" if i == 0 else ("END" if i == len(specs) - 1 else "CONTINUE"),
                **{k: v for k, v in spec.items() if k != "lat"},
            )
            poles.append(p)
        for i in range(len(poles) - 1):
            link(poles[i], poles[i + 1], poles[i + 1]["voltage"])
        return poles

    # ——— 33kV feeder (15) — heading NE ———
    s33 = [
        dict(voltage="33kV", poleMaterial="9m PCC", structure="1P", conductor="100", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=1, remarks="33kV SS take-off"),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="1P", conductor="100", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=2),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="1P", conductor="100", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=3),
        dict(voltage="33kV", poleMaterial="Rail", structure="2P", conductor="100", kitLocation="Angular", kitArrangement="In-line", kitWire="3W", kitExtension="With ext", guarding=True, sequence=4, remarks="road angle"),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="1P", conductor="100", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=5),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="1P", conductor="150", kitLocation="Tangent", kitArrangement="Sectional", kitWire="3W", sequence=6),
        dict(voltage="33kV", poleMaterial="H-Pole", structure="2P", conductor="150", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=7),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="1P", conductor="150", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=8),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="3P", conductor="150", kitLocation="Angular", kitArrangement="Sectional", kitWire="3W", sequence=9),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="1P", conductor="200", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=10),
        dict(voltage="33kV", poleMaterial="Rail", structure="2P", conductor="200", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=11),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="4P", conductor="200", kitLocation="T-Off", kitArrangement="In-line", kitWire="3W", sequence=12, remarks="future spur stub"),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="1P", conductor="200", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=13),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="2P", conductor="200", kitLocation="Angular", kitArrangement="In-line", kitWire="3W", sequence=14),
        dict(voltage="33kV", poleMaterial="9m PCC", structure="2P", conductor="200", kitLocation="Dead-end", kitArrangement=None, kitWire="3W", sequence=15, remarks="33kV feeder end"),
    ]
    place_chain(s33, BASE_LAT, BASE_LNG, bearing_deg=35.0, series_id=1)

    # ——— 11kV with DTRs — parallel corridor south ———
    s11 = [
        dict(voltage="11kV", poleMaterial="9m PCC", structure="1P", conductor="50", kitLocation="T-Off", kitArrangement="In-line", kitWire="3W", sequence=20, remarks="11kV from 33/11 SS"),
        dict(voltage="11kV", poleMaterial="9m PCC", structure="1P", conductor="50", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=21),
        dict(voltage="11kV", poleMaterial="8m PCC", structure="1P", conductor="50", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=22),
        dict(voltage="11kV", poleMaterial="9m PCC", structure="2P", conductor="50", kitLocation="Angular", kitArrangement="In-line", kitWire="3W", sequence=23),
        dict(voltage="11kV", poleMaterial="9m PCC", structure="DTR", type="DT", conductor="50", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", dtrMount="2P", dtCapacityKva="100", sequence=24, remarks="DTR 100 kVA"),
        dict(voltage="11kV", poleMaterial="9m PCC", structure="1P", conductor="100", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=25),
        dict(voltage="11kV", poleMaterial="Rail", structure="2P", conductor="100", kitLocation="Tangent", kitArrangement="Sectional", kitWire="3W", sequence=26),
        dict(voltage="11kV", poleMaterial="9m PCC", structure="DTR", type="DT", conductor="100", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", dtrMount="4P", dtCapacityKva="250", sequence=27, remarks="DTR 250 kVA — LT take-off here"),
        dict(voltage="11kV", poleMaterial="9m PCC", structure="1P", conductor="100", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=28),
        dict(voltage="11kV", poleMaterial="H-Pole", structure="3P", conductor="30", kitLocation="Angular", kitArrangement="Sectional", kitWire="3W", sequence=29),
        dict(voltage="11kV", poleMaterial="9m PCC", structure="DTR", type="DT", conductor="30", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", dtrMount="2P", dtCapacityKva="63", sequence=30, remarks="DTR 63 kVA"),
        dict(voltage="11kV", poleMaterial="9m PCC", structure="2P", conductor="30", kitLocation="Dead-end", kitArrangement=None, kitWire="3W", sequence=31),
    ]
    poles11 = place_chain(s11, BASE_LAT - 0.0012, BASE_LNG + 0.0003, bearing_deg=50.0, series_id=2)
    dtr250 = next(p for p in poles11 if p.get("dtCapacityKva") == "250")

    # ——— LT from DTR 250 — branch east ———
    s_lt = [
        dict(voltage="LT", poleMaterial="8m PCC", structure="1P", conductor="50", kitLocation="T-Off", kitArrangement="In-line", kitWire="2W", sequence=40, remarks="LT take-off from DTR 250 kVA"),
        dict(voltage="LT", poleMaterial="8m PCC", structure="1P", conductor="50", kitLocation="Tangent", kitArrangement="In-line", kitWire="2W", sequence=41),
        dict(voltage="LT", poleMaterial="8m PCC", structure="2P", conductor="50", kitLocation="Tangent", kitArrangement="In-line", kitWire="3W", sequence=42),
        dict(voltage="LT", poleMaterial="8m PCC", structure="3P", conductor="30", kitLocation="Angular", kitArrangement="In-line", kitWire="4W", sequence=43),
        dict(voltage="LT", poleMaterial="8m PCC", structure="1P", conductor="ABC", kitLocation="Tangent", kitArrangement="In-line", kitWire=None, sequence=44, remarks="ABC stretch"),
        dict(voltage="LT", poleMaterial="8m PCC", structure="1P", conductor="PVC", kitLocation="Tangent", kitArrangement="In-line", kitWire=None, sequence=45, remarks="PVC service stretch"),
        dict(voltage="LT", poleMaterial="8m PCC", structure="1P", conductor="30", kitLocation="Tangent", kitArrangement="Sectional", kitWire="2W", kitExtension="With ext", guarding=True, sequence=46),
        dict(voltage="LT", poleMaterial="8m PCC", structure="1P", conductor="30", kitLocation="Dead-end", kitArrangement=None, kitWire="2W", sequence=47),
    ]
    # First LT pole ~12 m east of DTR (short service tap — under any limit)
    lt0_lat, lt0_lng = offset_m(dtr250["latitude"], dtr250["longitude"], 12.0, 2.0)
    poles_lt = place_chain(s_lt, lt0_lat, lt0_lng, bearing_deg=95.0, series_id=3)
    # Cross-voltage link DTR → LT start (GPS span)
    link(dtr250, poles_lt[0], "LT")

    # Validate limits
    by_id = {a["id"]: a for a in assets}
    violations = []
    for c in conns:
        frm, to = by_id[c["fromAssetId"]], by_id[c["toAssetId"]]
        gps = haversine_m(frm["latitude"], frm["longitude"], to["latitude"], to["longitude"])
        stored = float(c["spanLengthM"])
        if abs(gps - stored) > 0.35:
            violations.append(f"mismatch gps={gps:.2f} stored={stored} {frm['sequence']}→{to['sequence']}")
        cap = max_span(to["voltage"], to["poleMaterial"], to["conductor"] or "")
        if cap is not None and gps > cap + 0.5:
            violations.append(
                f"OVER LIMIT {gps:.1f}>{cap} {to['voltage']} {to['poleMaterial']} {to['conductor']} seq {to['sequence']}"
            )

    root = {
        "surveyId": 9001,
        "title": "Sample demo · 33kV feeder + 11kV with DTRs + LT from DTR",
        "linemanName": "Demo Surveyor",
        "linemanMobile": "9000000001",
        "createdAt": 1720000000000,
        "updatedAt": 1720003600000,
        "isLiveAtSite": False,
        "gisAccuracy": {
            "grade": "A",
            "poleCount": len(assets),
            "verifiedCount": len(assets),
            "verifiedPercent": 100.0,
            "avgAccuracyM": 4.2,
            "minAccuracyM": 3.0,
            "maxAccuracyM": 6.0,
            "avgDistanceFromDeviceM": 3.1,
            "avgSatsUsed": 14.0,
            "avgSnrDb": 32.0,
            "mockCount": 0,
        },
        "assets": assets,
        "connections": conns,
        "seriesMeta": [
            {"seriesId": 1, "feederName": "33kV Demo Feeder F1", "sourceSubstation": "Demo 132/33 kV SS"},
            {"seriesId": 2, "feederName": "11kV Demo Feeder F2", "sourceSubstation": "Demo 33/11 kV SS"},
            {"seriesId": 3, "feederName": "LT from DTR-250", "sourceSubstation": "DTR 250 kVA (seq 27)"},
        ],
        "_sampleNote": (
            "Synthetic phone-style workspace. Span lengths = GPS haversine between poles, "
            "placed under ContinueSpanGuidance limits (LT ABC ≤40 m; HT 9m PCC ≤70 m; HT Rail ≤80 m)."
        ),
    }

    OUT.write_text(json.dumps(root, indent=2), encoding="utf-8")
    spans = [float(c["spanLengthM"]) for c in conns]
    print(f"wrote {OUT.name}: assets={len(assets)} conns={len(conns)}")
    print(f"span m: min={min(spans):.1f} max={max(spans):.1f} avg={sum(spans)/len(spans):.1f}")
    if violations:
        print("VIOLATIONS:")
        for v in violations:
            print(" ", v)
        raise SystemExit(1)
    print("OK — all spans match GPS and respect app limits")


if __name__ == "__main__":
    main()
