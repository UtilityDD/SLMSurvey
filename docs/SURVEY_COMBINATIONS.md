# Survey structure combinations — one-page decision board

Scan top → bottom. Legend: **✓** allowed · **✗** blocked · **★** default · **🔒** locked · **—** N/A

Source of truth: `NetworkCatalog.kt` → then this file. Wizard: `SurveyBubbleWizard.kt`. Desktop matrix: `_gen_catalog.py`.

---

## A. Entry → what is locked

| Trigger | Mode | Voltage | Material | Conductor | Status |
|---------|------|---------|----------|-----------|--------|
| Empty map / new | `NEW_NETWORK` | pick | pick | pick | pick |
| Place & Continue | `CONTINUE_SERIES` | 🔒 tip series | 🔒 series START | 🔒 if HT **1P** (tip conductor) | 🔒 tip |
| Insert on span | `NEAR_LINE` | 🔒 line | pick | pick | pick |
| Branch from pole | `TAPPING_BRANCH` | 🔒 (except from DTR) | pick | pick | pick |
| Long-press pole | Edit | edit | edit | edit | edit |

**Continue rule (33/11):** 1P keeps tip conductor. Change conductor only at **2P/3P/4P** (section). Following 1P inherits that new tip conductor.

---

## B. Voltage catalog (options + ★ default)

| Axis | 33 kV | 11 kV | LT |
|------|-------|-------|-----|
| Material | ★H-Pole · Rail · 9m PCC | ★8m PCC · 9m PCC · H-Pole · Rail | ★8m PCC |
| Conductor | ★100 · 150 · 200 | ★30 · 50 · 100 · ABC | ★30 · 50 · ABC · PVC |
| Type / phase | ★1P · 2P · 3P · 4P | ★1P · 2P · 3P · 4P · DTR | ★1P · 2P · 3P *(phase, not HT type)* |
| DTR | ✗ | On 2P / On 4P · caps 16…250 (+315,630) | ✗ as line type |
| New series Feeder\|SS | required | required | ✗ |

Preset on (optional): often 11 · Proposed · 9m PCC · 1P · 50 · Standard / DTR→LT.

---

## C. Pick order on review card

`Mat → Cond → Type → Loc → Arr → Ext → Guard` → Use this → (DTR mount/kVA) → Place Continue / End

| Field | When default | Default |
|-------|--------------|---------|
| Location | insert / tap / branch | **T-Off** |
| Location | else | tip or **Tangent** |
| Arrangement | HT 1P / LT | **In-line** |
| Arrangement | HT 2P/3P/4P/DTR | **Sectional** |
| Extension | always start | tip or **No-ext** |
| Guarding | when offered | **No** |

---

## D. HT type × location (33 & 11)

| Type | Tangent | Angular | Dead-end | T-Off |
|------|---------|---------|----------|-------|
| 1P | ✓ | ✓ | **✗** | ✓ |
| 2P | ✓ | ✓ | ✓ | ✓ |
| 3P | ✓ | ✓ | ✓ | ✓ |
| 4P | ✓ | ✓ | ✓ | ✓ |
| DTR *(11 only)* | ✓ | ✓ | ✓ | ✓ |

LT: all phases × all locations ✓.

---

## E. HT type × arrangement (Tangent / Angular / T-Off)

| Type | In-line | Sectional | Dead-end arr |
|------|---------|-----------|--------------|
| 1P | ✓ ★ | ✓ | — |
| 2P | ✗ | ✓ ★ | — |
| 3P | ✗ | ✓ ★ | — |
| 4P | ✗ | ✓ ★ | — |
| DTR | ✗ | ✓ ★ | — |

---

## F. HT continue: type × conductor change

| Continuing type | Same tip conductor | May change conductor | Arrangement |
|-----------------|--------------------|----------------------|-------------|
| 1P | 🔒 must | ✗ | In-line ★ / Sectional |
| 2P / 3P / 4P | optional | ✓ (section point) | Sectional ★ |
| DTR | optional | ✓ | Sectional ★ |

---

## G. LT conductor × phase × wire

| Conductor | 1P | 2P | 3P | kitWire |
|-----------|----|----|----|---------|
| 30 / 50 bare | ✓ → 2W | ✓ → 3W | ✓ → 4W | as shown |
| **ABC** | ✗ | ✗ | ✓ only | cable (`null`) |
| **PVC** | ✓ | ✗ | ✓ | cable (`null`) |

Desktop match collapses LT type → kit structure **`1P`** + wire/cable.

---

## H. Material × extension × guarding (phone offer)

| Material | Voltage | With-ext | Guard on No-ext | Guard on With-ext |
|----------|---------|----------|-----------------|-------------------|
| H-Pole | 33/11 | ✓ | ✓ | ✓ |
| Rail | 33/11 | ✓ | ✓ | ✓ |
| 9m PCC | 33/11 | ✓ | ✗ | ✓ |
| 8m PCC | 11 | ✗ | ✗ | — |
| 8m PCC | LT | ✗ | ✗ | — |

Guard Yes → map ×× marks. **Not** in kit match key. Material also **not** in match key.

---

## I. HT wire (auto on place)

| Conductor | kitWire |
|-----------|---------|
| ACSR sized (30/50/100/150/200) | `3W` |
| ABC / PVC | cable (`null`) |

---

## J. Chip grey / force (instant UX)

| If… | Then… |
|-----|--------|
| Loc = Dead-end | Arr cleared; HT 1P type ✗ |
| Type = HT 1P | Dead-end loc ✗ |
| Type = HT 2P/3P/4P/DTR | Arr = Sectional only |
| Mat = 8m PCC or LT | Ext = No-ext only |
| Guard not allowed | Guard chips grey |
| LT ABC | 1P / 2P / 3P (preset may pick 1P ABC) |
| Continue + HT 1P | Cond 🔒 tip |
| Place End + Dead-end | End only |
| Place End + Proposed + Tan/Ang + Dead-end-ok type | Loc may auto → Dead-end |

---

## K. Place End / readiness

| Case | Place End | Estimate ready (Proposed) |
|------|-----------|---------------------------|
| HT 1P | cannot be Dead-end End | need Cond · Loc · Ext · Arr (if not DE) |
| HT 2P/3P/4P/DTR Dead-end | End only | Arr not required |
| Existing | — | treated ready (not BOQ) |
| DTR Proposed | after mount + kVA | mount + kVA required |

---

## L. Conductor chip → desktop sized id

| V | Chip | Kit id |
|---|------|--------|
| 33 | 100 / 150 / 200 | Dog / Wolf / Panther |
| 11 | 30 / 50 / 100 | Weasel / Rabbit / Dog |
| LT | 30 / 50 | Weasel / Rabbit |
| ABC / PVC | — | size-agnostic cable |

Size-agnostic structure kits: **all LT** · plus **11 · 1P · Tangent · In-line**.

---

## M. Desktop matrix must match phone

| Rule | Matrix |
|------|--------|
| HT Dead-end | never 1P |
| HT Arr | 1P = In-line + Sectional; 2P/3P/4P/DTR = Sectional only |
| LT structure id | always `1P` (phone 2P/3P → wire) |
| 33 | no DTR · no Rabbit 50 · no 8m PCC poles |
| 11 DTR | DTR2P / DTR4P × loc × arr × ext × kVA |
| LT DTR | T-Off only |
| Dead-end | `arrangement: null` |
| Ext | matrix may both; phone filters by mat |

Match key: `STR|{V}|{type}|{loc}|{arr or -}|{ext or -}|{kVA?}`

---

## N. Presets

| Kind | Aligns how |
|------|------------|
| Survey preset | local defaults only (no matchKey) |
| Field pack `.slmpreset` | `matchKey` + `capture` from assembly |
| DTR→LT | START 11 DTR → CONTINUE LT 1P + 8m PCC |

---

## Quick check

1. HT 1P ↔ Dead-end mutually ✗  
2. HT 1P Arr: In-line ★ + Sectional ✓  
3. HT 2P/3P/4P/DTR Arr: Sectional only  
4. Continue HT 1P cond = tip  
5. LT ABC / bare → 1P|2P|3P; PVC → 1P|3P  
6. 8m/LT → No-ext; Rail/H-Pole No-ext may Guard  
7. New HT needs Feeder\|SS  
8. Desktop kit-matrix regenerated after rule change  

---

## Related

[`app/README.md`](../app/README.md) · [`sld_editor/README.md`](../sld_editor/README.md) · [`sld_editor/estimate/README.md`](../sld_editor/estimate/README.md) · [`README.md`](../README.md)
