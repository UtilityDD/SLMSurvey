"""Explore Mat/Lab for seeding — run once to inspect codes."""
import json
import re
from pathlib import Path

rb = json.loads(
    (Path(__file__).parent / "ratebook.json").read_text(encoding="utf-8")
)
items = rb["materials"] + rb["labour"]


def show(pat):
    print("===", pat, "===")
    for m in items:
        if re.search(pat, m["description"], re.I):
            print(m["code"], "|", m["description"][:95], "|", m["unit"])
    print()


for p in [
    r"P C C POLE|PCC POLE :|TUBULAR POLE|RAIL POLE",
    r"CHANNEL|ANGLE|FLAT",
    r"INSULATOR",
    r"STAY",
    r"EARTH",
    r"AERIAL BUNCHED|ANCHORING|SUSPENSION CLAMP|IPC",
    r"BRACKET|TOP ADAPTOR|CLAMP FOR .*PCC",
    r"^L0|ERECTION OF|EARTHING|STAY SET|FIXING OF PIN|FIXING OF DISC|EXTENSION OF",
]:
    show(p)
