# VHB Planner — Phase 1 Design

**Status: v0.2 — Q1–Q3 answered by the owner (2026-06-12): contract hours run on diensttijd with period-average semantics; gebroken diensten have max 3 segments; amplitude 14u/16u. Remaining before solver code: data-model sign-off + Q4/Q5 confirmation in §10.**

Produced by a three-way design panel (solver-first, compliance-first, Excel/IO-first) plus an adversarial gap review. Where the designs disagreed, the resolution is noted inline. Interpretations and constants are aligned with the owner's Shiftglide compliance checker (`~/Shiftglide/src/rules/eu-561.ts`, `kb-2005-08-10.ts`) so both tools agree out of the box.

---

## 1. Architecture

Self-contained Python 3.12 project under `rostering/` (no coupling to the surrounding TypeScript repo):

```
rostering/
  models.py            # frozen dataclasses, no OR-Tools imports
  constraints.py       # constraint builders, each tagged + toggleable
  solver.py            # CP-SAT model assembly, solve, infeasibility diagnosis
  excel_io.py          # load + validate input workbook, write output workbook
  main.py              # CLI entry point
  genereer_voorbeeld.py # sample input generator
  config.toml          # constraint toggles, parameters, soft weights
  tests/               # unit tests (rest-time calculations first)
  data/                # voorbeeld_invoer.xlsx
  output/              # rooster_<begin>_<einde>.xlsx
```

**Core principle:** every quantity the solver touches is a precomputed integer constant. All domain interpretation (time parsing, classifications, gap arithmetic, DST) happens at load time in plain Python where it is unit-testable. The CP-SAT model is pure booleans + linear sums over constants.

**Second principle (from the compliance analysis):** because duties are pre-designed and assigned whole (one duty per driver per day), every purely intra-day rule (amplitude, breaks, per-duty driving cap) collapses to **input-time validation**; only cross-day and aggregation rules are genuine solver constraints.

## 2. Time representation

- **Template layer:** duty times as integer minutes since midnight of the duty's calendar day. Cross-midnight uses OV-industry 24+ notation: `"25:15"` = 01:15 next day (parsed as 1515).
- **Instance layer:** one `Duty` per (template × calendar date), with `start_abs`/`end_abs` as **true elapsed minutes since period start**, computed via `zoneinfo("Europe/Brussels")` so DST transition nights yield legally correct rest durations (a naive 1440-min day would make a 9h reduced rest really 8h on the March transition).
- Daily rest between any two duties is then a single integer subtraction — correct across midnight, days off, and midnight-crossing duties.
- A midnight-crossing duty **belongs to its start date** for one-duty-per-day, weekly counters, and weekend fairness.
- "Week" = fixed Monday–Sunday (EU 561 Art. 4(i)) throughout.

## 3. Data model (`models.py`)

All dataclasses `@dataclass(frozen=True, slots=True)`. `Minutes = int` alias. Excel uses string codes; the solver uses dense integer ids assigned at load.

```python
Minutes = int

class DutyCategory(StrEnum):
    VROEG = "V"; LAAT = "L"; GEBROKEN = "G"; DAG = "D"; NACHT = "N"

class AbsenceType(StrEnum):
    VERLOF = "VER"; ZIEKTE = "ZIE"; ADV = "ADV"; FEESTDAG_COMP = "FEE"
    OPLEIDING = "OPL"; KLEIN_VERLET = "KV"; ONBETAALD = "OV"

@dataclass(frozen=True, slots=True)
class DutySegment:
    start: Minutes                 # minutes since midnight, 0..1439
    end: Minutes                   # 24+ notation: > 1440 crosses midnight

@dataclass(frozen=True, slots=True)
class DutyTemplate:
    code: str                      # unique within its DayType
    category: DutyCategory         # explicit Type column (drives fairness + colors)
    segments: tuple[DutySegment, ...]  # 1..3 segments; >1 = gebroken dienst (Q2: max 3)
    driving_time: Minutes          # rijtijd
    vehicle_type: str | None       # None = any
    # derived at load: spread (amplitude = start of first segment → end of last),
    # duty_time (diensttijd = sum of segment durations — the confirmed
    # working-time basis, Q1), longest_interruption (largest continuous gap
    # between consecutive segments; ≥ 4h unlocks the 16h amplitude, Q3)

@dataclass(frozen=True, slots=True)
class DayType:
    code: str                      # e.g. WEEKDAG, ZATERDAG, ZONDAG
    description: str
    counts_as_weekend: bool        # feeds weekend-fairness counter
    duties: tuple[DutyTemplate, ...]

@dataclass(frozen=True, slots=True)
class CalendarDay:
    date: dt.date
    day_index: int                 # 0-based offset from period start
    day_type_code: str
    week_index: int                # fixed Mon–Sun week number within the period
    is_weekend: bool               # from DayType.counts_as_weekend

@dataclass(frozen=True, slots=True)
class PlanningPeriod:
    start_date: dt.date
    end_date: dt.date              # inclusive; derived from the Kalender sheet
    days: tuple[CalendarDay, ...]  # contiguity validated at load

@dataclass(frozen=True, slots=True)
class Driver:
    id: int                        # dense 0..n-1
    code: str                      # personeelsnummer (stable Excel key)
    name: str
    contract_minutes_per_week: Minutes
    allowed_vehicle_types: frozenset[str] | None   # None = all
    active_from: dt.date | None    # outside range = treated as absent
    active_to: dt.date | None

@dataclass(frozen=True, slots=True)
class Absence:
    driver_code: str
    start_date: dt.date
    end_date: dt.date              # inclusive
    absence_type: AbsenceType
    # paid/contract-hour credit per type follows the rule table chosen in Q1

@dataclass(frozen=True, slots=True)
class DriverHistory:
    """Carry-in state at period start (optional Historiek sheet).
    Missing fields = 'fully rested / clean start', prominently flagged
    as an assumption in the Rapport sheet."""
    driver_code: str
    last_duty_end: dt.datetime | None = None        # rest before day 1
    consecutive_workdays_before: int = 0            # for the 6-day rule
    driving_minutes_prev_week: Minutes = 0          # 90h/2-week pairs week 1
                                                    # with the pre-period week
    driving_minutes_current_week: Minutes = 0       # only for mid-week starts
    extended_driving_days_this_week: int = 0        # 10h extensions used
    reduced_daily_rests_used: int = 0               # since last weekly rest
    last_weekly_rest_end: dt.datetime | None = None # 144h rule seed

@dataclass(frozen=True, slots=True)
class Duty:
    """Concrete instance = DutyTemplate x CalendarDay; the only duty object
    the solver sees. Flattened: constraints.py needs no indirection."""
    id: int
    code: str
    date: dt.date
    day_index: int
    week_index: int
    start_abs: Minutes             # true elapsed minutes since period start
    end_abs: Minutes               # (zoneinfo Europe/Brussels)
    driving_time: Minutes
    working_time: Minutes          # = diensttijd, sum of segment durations (Q1)
    spread: Minutes                # amplitude
    category: DutyCategory
    vehicle_type: str | None
    is_weekend: bool
    is_extended_driving: bool      # driving_time > 540 (consumes a 10h slot)

@dataclass(frozen=True, slots=True)
class Problem:
    """Validated, fully derived input bundle handed to solver.py, built by a
    factory that also produces lookup tables: duties_by_day, availability per
    (driver, day), eligible drivers per duty (availability ∧ qualification)."""
    period: PlanningPeriod
    drivers: tuple[Driver, ...]
    duties: tuple[Duty, ...]
    absences: tuple[Absence, ...]
    history: tuple[DriverHistory, ...]
    config: Config
```

Result side (returned by `solver.py`, consumed by `excel_io.py`):

```python
@dataclass(frozen=True, slots=True)
class ConstraintTag:
    """Identity of one toggleable constraint group — used both for CP-SAT
    assumption literals and for the Dutch infeasibility report."""
    family: str                    # e.g. "eu_daily_rest", "cao_max_amplitude"
    driver_code: str | None = None
    week_index: int | None = None
    day_index: int | None = None

@dataclass(frozen=True, slots=True)
class Assignment:
    duty_id: int
    driver_id: int

@dataclass(frozen=True, slots=True)
class SolveResult:
    status: str                    # OPTIMAAL | HAALBAAR | INFEASIBLE | TIJDSLIMIET
    assignments: tuple[Assignment, ...]
    objective: int | None
    penalty_breakdown: dict[str, int]     # per soft-constraint family
    infeasibility: InfeasibilityReport | None
    wall_time_s: float
```

## 4. Hard constraints — interpretation matrix

| # | Rule | Mechanism | Carry-in needed |
|---|------|-----------|-----------------|
| H1 | Max 9h driving/day, 10h max 2×/week | Validator: reject duty `rijtijd > 10:00`, flag > 9:00. Solver: per driver per fixed week, count(assigned extended duties) ≤ 2 | `extended_driving_days_this_week` |
| H2 | Daily rest ≥ 11h, reducible to 9h max 3× | Solver: gap between consecutive worked days ≥ 540; gap in [540, 660) = reduced, counted ≤ 3 **per fixed week** in Phase 1 (EU-letter "between weekly rests" mode as config enum later — same input data). Optional strict 24h-window toggle: duty spread > 13h forces a reduced-rest credit even when the calendar gap ≥ 11h | `last_duty_end`, `reduced_daily_rests_used` |
| H3 | Weekly rest ≥ 45h continuous | Solver: every fixed Mon–Sun week contains a qualifying duty-free gap ≥ 2700 min; a straddling gap counts in exactly **one** week (Art. 8(9) attribution variable). Optional Art. 8(6) rule: next weekly rest starts ≤ 144h after the previous one ended. Reduced weekly rest (24h + compensation) **OFF by default** — compensation within 3 weeks is untrackable in a 2-week horizon; if enabled it is only recorded as debt in the report. Note: one calendar day off does NOT guarantee 45h (end 23:30 + start 04:00 day-after-next = 28.5h) — modeled on true gaps, never "a day off" | `last_weekly_rest_end` |
| H4 | Break 45 min after 4.5h driving | **Never a solver constraint** — break placement lives inside the pre-designed duty. Validator (warning): if `rijtijd > 4:30` then non-driving slack `duty_time − rijtijd ≥ 45 min` (a gebroken-dienst coupure supplies slack automatically). True placement compliance is assumed designed-in by De Lijn |  |
| H5 | Max 56h driving/week | Solver: Σ rijtijd per driver per fixed week ≤ 3360 | `driving_minutes_current_week` (mid-week start) |
| H6 | Max 90h driving/2 weeks | Solver: every pair of **adjacent fixed weeks** ≤ 5400 — incl. (pre-period week, week 1), so this needs carry-in even with a clean Monday start | `driving_minutes_prev_week` |
| H7 | Amplitude limit (CAO/KB 10-08-2005) | Validator: spread ≤ 14:00, or ≤ 16:00 when the duty's longest continuous interruption ≥ 4h (confirmed Q3, identical to Shiftglide constants) |  |
| H8 | Max 6 consecutive working days | Solver: rolling — in every 7-consecutive-date window ≤ 6 assigned days. Default: absence days break the run | `consecutive_workdays_before` |
| H9 | One duty per driver per day | Structural: exactly-one over eligible drivers per duty; ≤ 1 duty per driver per date; 0 on absent dates (eligibility pruning — absent (driver, day) variables are never created) |  |
| H10 | Contract hours, no structural exceedance | **Period-average semantics (confirmed Q1):** hard cap Σ diensttijd over the whole period ≤ contract × weeks (+ configurable tolerance, default 0:00); individual weeks may deviate, steered by a soft weekly-deviation penalty (§5) |  |
| H11 | KB 10-08-2005 working time: ≤ 10h/day (12h geregeld vervoer?), ≤ 50h/week | Daily: validator on duty_time. Weekly: solver Σ diensttijd ≤ 3000 (basis confirmed Q1) |  |

Absences are **eligibility pruning**, not constraints — so they can never appear in an infeasibility core; absence-driven shortages are caught by deterministic pre-solve checks instead (§8 layer 1).

## 5. Soft constraints (weighted penalties)

| Term | Definition |
|------|-----------|
| Fair early/late/gebroken/nacht | Spread of per-driver counts of duties per `DutyCategory` (explicit Type column — no threshold guessing), pro rata contract hours |
| Fair weekend | Same, over duties on days with `counts_as_weekend` (Saturday and Sunday also tracked separately in the output) |
| Hours balance | Minimize deviation between assigned diensttijd and contract hours per driver: per-week deviation penalty (weeks may deviate but should not drift needlessly) + period-total deviation pro rata contract |
| Early-after-late | Penalty when (category L or N on day d) ∧ (category V on day d+1) ∧ the gap is legal (≥ 11h). Config alternative: graded penalty for legal-but-tight gaps in [11h, 13h) |

Weights live in `config.toml` (`[soft]` section); the penalty breakdown per family and per driver is written to the output so the planner sees *why* the solver chose a roster.

## 6. Configuration — `config.toml`

TOML file, not an Excel sheet (git-diffable for infeasibility debugging, comments can cite legal sources, no Excel time-coercion). The **full effective config snapshot is echoed into the output `Rapport` sheet** as audit trail. The planning period is *not* config — it is derived from the Kalender sheet.

```toml
[solver]
max_time_s = 60

[eu561]
max_daily_driving = true          # H1; params: 540 / 600 / 2 per week
daily_rest = true                 # H2; 660 / 540 / 3 reduced
strict_24h_window = true          # H2 subtlety, toggleable
weekly_rest = true                # H3; 2700
max_gap_between_weekly_rests = true   # 144h, Art. 8(6)
allow_reduced_weekly_rest = false # H3, off by default
weekly_driving_cap = true         # H5; 3360
biweekly_driving_cap = true       # H6; 5400

[cao]
max_amplitude = true              # H7; 840 / 960 with >= 4h interruption (Q3)
max_consecutive_days = true       # H8; 6
contract_hours = true             # H10; period-average (Q1)
contract_tolerance_period = 0     # extra minutes allowed on the period total

[kb2005]
daily_working_time = true         # H11; cap on diensttijd per duty (value TBD: 10h or 12h geregeld vervoer)
weekly_working_time = true        # 3000, on diensttijd

[soft]
fair_early = 3
fair_late = 3
fair_weekend = 5
hours_balance = 4
early_after_late = 2

[validate]
duty_break_slack = "warning"      # H4
```

Every solver constraint family registers a `ConstraintTag` and an assumption literal keyed by the same family name used in TOML keys, CLI flags, and the report — one namespace everywhere.

## 7. Excel INPUT workbook

Sheets: `Dagtypes`, `Kalender`, `Diensten`, `Chauffeurs`, `Afwezigheden`, `Voertuigtypes`, `Historiek` (optional). Loader matches columns **by header name** (case-insensitive), not position. Times as text `"HH:MM"` (24+ notation for cross-midnight) or native Excel time; dates `dd/mm/jjjj`; booleans `J`/`N`. The loader collects **all** errors before aborting (`Exxx` blocking, `Wxxx` warning) — console + `invoerfouten.txt`.

**`Dagtypes`** — `Code | Omschrijving | Telt als weekend (J/N)`

**`Kalender`** — one row per date; the only place the dagtype mapping and the period live: `Datum | Dagtype | Opmerking`. Errors: missing date in range, unknown dagtype, duplicate date.

**`Diensten`** — one row per duty per dagtype; gebroken diensten as one row with up to three segments (Q2: max 3), assigned as one indivisible unit:

| Dagtype | Dienstcode | Type | Begin 1 | Einde 1 | Begin 2 | Einde 2 | Begin 3 | Einde 3 | Rijtijd | Voertuigtype | Opmerking |
|---|---|---|---|---|---|---|---|---|---|---|---|
| WEEKDAG | V01 | V | 04:58 | 13:12 | | | | | 6:50 | GELEED | Vroege stadslijn |
| WEEKDAG | G01 | G | 06:42 | 09:48 | 15:28 | 18:52 | | | 5:35 | | Gebroken, spitsen |
| WEEKDAG | S01 | G | 07:05 | 09:02 | 11:50 | 13:10 | 15:40 | 17:25 | 4:05 | | Schoolrit, 3 delen |
| ZATERDAG | N51 | N | 18:10 | 26:05 | | | | | 6:30 | | Einde 02:05 (+1) |

`Diensttijd` (sum of segments — the contract-hours basis, Q1) and `Amplitude` are computed by the loader, never entered. Key validations: end before start (→ point to 24+ notation), segments out of order or overlapping, a later segment filled while an earlier one is blank, rijtijd > diensttijd, rijtijd > 10:00 (blocking) / > 9:00 (info: extended), duplicate code within dagtype, unknown voertuigtype, amplitude above limit (14:00, or 16:00 when the longest coupure ≥ 4:00), break-slack warning.

**`Chauffeurs`** — `Chauffeur-ID | Naam | Contracturen/week | Voertuigtypes | Actief van | Actief tot | Opmerking`. Voertuigtypes comma-separated; blank = all.

**`Afwezigheden`** — `Chauffeur-ID | Van | Tot | Reden | Opmerking`; reason codes VER/ZIE/ADV/FEE/OPL/KV/OV; overlapping ranges merged with warning.

**`Voertuigtypes`** — `Code | Omschrijving`; master list backing the qualification validations.

**`Historiek`** (optional) — one row per driver with the `DriverHistory` fields (Einde laatste dienst, Aaneengesloten werkdagen, Rijtijd vorige week, …). Blank/missing = fully rested, flagged in `Rapport`.

**Pre-solve sanity checks** (deterministic, before CP-SAT): per-date coverage (duties vs available drivers), qualification coverage per duty, weekly capacity vs contract capacity — each with a concrete Dutch message naming date/driver/duty.

## 8. Excel OUTPUT workbook — `rooster_<begin>_<einde>.xlsx`

Always written, even on infeasibility (then only `Rapport` + `Infeasibiliteit` + `Legenda`).

- **Week sheets** (one per fixed Mon–Sun week): drivers as rows, dates as columns; cell = dienstcode, absence code, or `RUST`. Row 2 = dagtype per date. Fill colors by Type (V geel, L blauw, G oranje, D groen, N paars, afwezig grijs). Right-hand columns: `Uren | Contract | Saldo | Rijtijd`. Frozen panes.
- **`Urenoverzicht`**: per driver per week uren/saldo + totals; saldo beyond tolerance highlighted.
- **`Rusttijden`**: one row per consecutive duty pair (einde, begin, rust, status `OK` / `OK (krap)` / `VERKORT (9–11u)` with week counters), plus per-week blocks: langste rust vs 45:00, dagen 10u rijtijd x/2, rijtijd week x/56:00, rijtijd 2 weken x/90:00. **Doubles as the unit-test oracle for rest-time calculations.**
- **`Eerlijkheid`**: per driver counts (# vroeg/laat/gebroken/nacht/zaterdag/zondag/weekend), hours vs pro-rata average, soft-penalty contribution per driver.
- **`Rapport`**: solver status, rekentijd, objective, penalty breakdown, **full effective-config snapshot**, carry-in assumptions used, input file + timestamp.
- **`Legenda`**: every code, color and status term.

## 9. Infeasibility report

Sheet `Infeasibiliteit` + identical plain-text mirror `infeasibiliteit.txt` + console summary. Three layers rendered into one table (`Niveau | Categorie | Datum(s) | Chauffeur/Dienst | Omschrijving | Suggestie`):

1. **Pre-solve checks** — deterministic, names the date/driver/duty (catches most "mysterious infeasible" cases, including all absence-driven shortages).
2. **CP-SAT assumption cores** — every toggleable constraint group carries an assumption literal; the minimal core is mapped to Dutch sentences ("De combinatie van deze regels maakt de planning onmogelijk: …"). Two-stage granularity: family-level core first, then re-solve within the core for driver/week-level tags.
3. **Relaxation pass** — re-solve with one constraint group disabled at a time: "De planning wordt wél haalbaar als 'cao.max_consecutive_days' wordt uitgeschakeld. Knelpunt: chauffeurs C01, C03, C09 …".

## 10. Question status

**Answered by the owner (2026-06-12):**

- **Q1 — Contract-hours semantics: DIENSTTIJD, period-average.** Diensttijd (sum of segment durations) is the working-time basis for the contract balance, the Saldo columns, and the KB 50u weekly cap. "No structural exceedance" = the period total is capped (contract × weeks + tolerance, default 0); individual weeks may deviate and are steered softly. No saldo carry-in needed. *Still open (minor): how many hours a paid absence day credits toward the period total — assumed contracturen/5 until corrected.*
- **Q2 — Gebroken diensten: YES, max 3 segments.** One Excel row (Begin/Einde 1–3), assigned as one indivisible unit; coupure unpaid (not in diensttijd).
- **Q3 — Amplitude: 14u standard / 16u when longest coupure ≥ 4u.** Fixed limits, pure input validation — identical to the Shiftglide constants.

**Remaining (defaults are designed in; confirm or correct):**

- **Q4 — Period boundaries & history.** Default: periods start on Monday; the optional Historiek sheet supplies carry-in per driver, blank = fully rested (flagged in Rapport). Minimum useful field: rijtijd vorige week (needed for 90h/2-weeks even with a clean Monday start).
- **Q5 — Structural exceptions.** Defaults: one-duty-per-day is absolute; no reserve/standby duties; no pinned fixed assignments in Phase 1.

### Working assumptions (flag if wrong)

1. Reduced **weekly** rest stays off by default (45h only) — H3.
2. Reduced **daily** rest counted per fixed week in Phase 1; EU-letter mode (between weekly rests) added later as config enum — same input data.
3. Absence days break a consecutive-workday run (the driver is not working).
4. A midnight-crossing duty belongs to its start date everywhere.
5. Break compliance (H4) is the duty designer's responsibility; we validate slack only.
6. Duty codes are unique within a dagtype (may repeat across dagtypes).
7. DST handled at load via Europe/Brussels; solver sees true elapsed minutes.

## 11. Sample dataset (`genereer_voorbeeld.py`)

2 full Mon–Sun weeks (ma 06/07/2026 – zo 19/07/2026), 3 dagtypes (WEEKDAG ×10, ZATERDAG ×2, ZONDAG ×2), ~15 realistic duties (vroege ~05:00–13:30, late ~14:00–22:51, gebroken with spitsen incl. one 3-segment school run, one nacht 18:10–26:05, weekend variants), 12 drivers with mixed contracts (38u/30u/20u) and mixed vehicle qualifications, a handful of absences (VER, ZIE, ADV). Feasible but non-trivial: utilization deliberately ~85–90%, asserted on diensttijd (the confirmed working-time basis) against contract capacity net of absences.
