"""Core data model for the VHB Planner Phase 1 roster solver.

Frozen dataclasses only — no OR-Tools imports here. Every quantity the solver
touches is precomputed into integer minutes ("Minutes") so the CP-SAT model in
solver.py is pure booleans + linear sums over constants.

Two time layers (see DESIGN.md §2):
- template layer: minutes since midnight of the duty's calendar day, with the
  OV-industry 24+ notation ("25:15" -> 1515) for cross-midnight ends;
- instance layer: true elapsed minutes since the period anchor (midnight of
  day 0, Europe/Brussels), computed via zoneinfo so DST transition nights
  yield legally correct rest durations.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, replace
from enum import StrEnum
from zoneinfo import ZoneInfo

Minutes = int

TZ = ZoneInfo("Europe/Brussels")

DAY_MINUTES = 1440


class DutyCategory(StrEnum):
    """Explicit duty type from the 'Type' column; drives fairness + colors."""

    VROEG = "V"
    LAAT = "L"
    GEBROKEN = "G"
    DAG = "D"
    NACHT = "N"


class AbsenceType(StrEnum):
    VERLOF = "VER"
    ZIEKTE = "ZIE"
    ADV = "ADV"
    FEESTDAG_COMP = "FEE"
    OPLEIDING = "OPL"
    KLEIN_VERLET = "KV"
    ONBETAALD = "OV"


# Paid absences credit contract hours toward the period total (DESIGN.md Q1:
# contracturen/5 per absence day). Only onbetaald verlof credits nothing.
PAID_ABSENCE_TYPES = frozenset(AbsenceType) - {AbsenceType.ONBETAALD}


# ---------------------------------------------------------------------------
# Time helpers (pure, unit-tested)
# ---------------------------------------------------------------------------

def wall_to_datetime(day: dt.date, wall_minutes: Minutes) -> dt.datetime:
    """Wall-clock minutes since midnight of `day` -> aware datetime.

    Supports 24+ notation: wall_minutes >= 1440 rolls into the next day(s).
    On a spring-forward night a non-existent wall time maps forward per
    PEP 495 fold-0 semantics, which is the conservative reading.
    """
    days_over, minute_of_day = divmod(wall_minutes, DAY_MINUTES)
    base = day + dt.timedelta(days=days_over)
    return dt.datetime(
        base.year, base.month, base.day,
        minute_of_day // 60, minute_of_day % 60, tzinfo=TZ,
    )


def period_anchor(start_date: dt.date) -> dt.datetime:
    """Midnight of the period's first day, Europe/Brussels."""
    return dt.datetime(start_date.year, start_date.month, start_date.day, tzinfo=TZ)


def elapsed_minutes(anchor: dt.datetime, moment: dt.datetime) -> Minutes:
    """True elapsed minutes between two aware datetimes (DST-correct)."""
    return int((moment - anchor).total_seconds()) // 60


# ---------------------------------------------------------------------------
# Input-side entities
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class DutySegment:
    start: Minutes  # minutes since midnight, 0..1439
    end: Minutes    # 24+ notation: > 1440 crosses midnight; always > start


@dataclass(frozen=True, slots=True)
class DutyTemplate:
    code: str                          # unique within its DayType
    category: DutyCategory
    segments: tuple[DutySegment, ...]  # 1..3 segments; >1 = gebroken dienst
    driving_time: Minutes              # rijtijd
    vehicle_type: str | None           # None = any
    remark: str = ""

    @property
    def duty_time(self) -> Minutes:
        """Diensttijd = sum of segment durations (contract-hours basis, Q1)."""
        return sum(s.end - s.start for s in self.segments)

    @property
    def spread(self) -> Minutes:
        """Amplitude in wall-clock minutes: start of first -> end of last."""
        return self.segments[-1].end - self.segments[0].start

    @property
    def longest_interruption(self) -> Minutes:
        """Largest continuous coupure between consecutive segments (0 if one)."""
        gaps = [b.start - a.end for a, b in zip(self.segments, self.segments[1:])]
        return max(gaps, default=0)


@dataclass(frozen=True, slots=True)
class DayType:
    code: str                          # e.g. WEEKDAG, ZATERDAG, ZONDAG
    description: str
    counts_as_weekend: bool
    duties: tuple[DutyTemplate, ...]


@dataclass(frozen=True, slots=True)
class CalendarDay:
    date: dt.date
    day_index: int                     # 0-based offset from period start
    day_type_code: str
    week_index: int                    # fixed Mon-Sun week within the period
    is_weekend: bool                   # from DayType.counts_as_weekend


@dataclass(frozen=True, slots=True)
class PlanningPeriod:
    start_date: dt.date
    end_date: dt.date                  # inclusive; derived from Kalender sheet
    days: tuple[CalendarDay, ...]

    @property
    def num_days(self) -> int:
        return len(self.days)

    @property
    def num_weeks(self) -> int:
        """Number of (possibly partial) fixed Mon-Sun weeks in the period."""
        return (self.num_days + 6) // 7

    def week_days(self, week_index: int) -> tuple[CalendarDay, ...]:
        return tuple(d for d in self.days if d.week_index == week_index)

    def is_full_week(self, week_index: int) -> bool:
        return len(self.week_days(week_index)) == 7


@dataclass(frozen=True, slots=True)
class Driver:
    id: int                            # dense 0..n-1, assigned at load
    code: str                          # personeelsnummer (stable Excel key)
    name: str
    contract_minutes_per_week: Minutes
    allowed_vehicle_types: frozenset[str] | None = None   # None = all
    active_from: dt.date | None = None
    active_to: dt.date | None = None
    remark: str = ""

    def is_active(self, on: dt.date) -> bool:
        if self.active_from is not None and on < self.active_from:
            return False
        if self.active_to is not None and on > self.active_to:
            return False
        return True


@dataclass(frozen=True, slots=True)
class Absence:
    driver_code: str
    start_date: dt.date
    end_date: dt.date                  # inclusive
    absence_type: AbsenceType
    remark: str = ""

    def covers(self, on: dt.date) -> bool:
        return self.start_date <= on <= self.end_date


@dataclass(frozen=True, slots=True)
class DriverHistory:
    """Carry-in state at period start (optional Historiek sheet).

    Missing fields = 'fully rested / clean start'; the Rapport sheet flags
    that assumption prominently.
    """

    driver_code: str
    last_duty_end: dt.datetime | None = None         # rest before day 0
    consecutive_workdays_before: int = 0             # for the 6-day rule
    driving_minutes_prev_week: Minutes = 0           # 90h/2-week seed
    driving_minutes_current_week: Minutes = 0        # mid-week starts only
    extended_driving_days_this_week: int = 0
    reduced_daily_rests_used: int = 0
    last_weekly_rest_end: dt.datetime | None = None


# ---------------------------------------------------------------------------
# Solver-side entities
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Duty:
    """Concrete instance = DutyTemplate x CalendarDay.

    Flattened (template fields copied in) so constraints.py needs no
    indirection; the only duty object the solver sees.
    """

    id: int
    code: str
    date: dt.date
    day_index: int
    week_index: int
    start_abs: Minutes                 # true elapsed minutes since anchor
    end_abs: Minutes
    driving_time: Minutes
    working_time: Minutes              # diensttijd (sum of segments, Q1)
    spread: Minutes                    # true elapsed amplitude
    category: DutyCategory
    vehicle_type: str | None
    is_weekend: bool

    @property
    def is_extended_driving(self) -> bool:
        """Consumes one of the 2 weekly 10h driving extensions (EU 561 Art. 6)."""
        return self.driving_time > 540


@dataclass(frozen=True, slots=True)
class Problem:
    """Validated, fully derived input bundle handed to solver.py."""

    period: PlanningPeriod
    drivers: tuple[Driver, ...]
    duties: tuple[Duty, ...]           # sorted by start_abs
    absences: tuple[Absence, ...]
    history: dict[str, DriverHistory]  # driver_code -> history
    # Lookup tables (derived, built by build_problem):
    duties_by_day: dict[int, tuple[int, ...]]          # day_index -> duty ids
    available: dict[tuple[int, int], bool]             # (driver_id, day_index)
    eligible_drivers: dict[int, tuple[int, ...]]       # duty_id -> driver ids
    absence_on: dict[tuple[int, int], AbsenceType]     # (driver_id, day_index)

    def driver_by_code(self, code: str) -> Driver:
        return next(d for d in self.drivers if d.code == code)

    def history_for(self, driver: Driver) -> DriverHistory:
        return self.history.get(driver.code, DriverHistory(driver_code=driver.code))


def instantiate_duties(
    period: PlanningPeriod, day_types: dict[str, DayType]
) -> tuple[Duty, ...]:
    """Expand DutyTemplates over the calendar into concrete Duty instances.

    A midnight-crossing duty belongs to its start date for one-duty-per-day,
    weekly counters and weekend fairness (DESIGN.md §2).
    """
    anchor = period_anchor(period.start_date)
    duties: list[Duty] = []
    for day in period.days:
        day_type = day_types[day.day_type_code]
        for tpl in day_type.duties:
            start_dt = wall_to_datetime(day.date, tpl.segments[0].start)
            end_dt = wall_to_datetime(day.date, tpl.segments[-1].end)
            start_abs = elapsed_minutes(anchor, start_dt)
            end_abs = elapsed_minutes(anchor, end_dt)
            duties.append(
                Duty(
                    id=-1,  # assigned after sorting
                    code=tpl.code,
                    date=day.date,
                    day_index=day.day_index,
                    week_index=day.week_index,
                    start_abs=start_abs,
                    end_abs=end_abs,
                    driving_time=tpl.driving_time,
                    working_time=tpl.duty_time,
                    spread=end_abs - start_abs,
                    category=tpl.category,
                    vehicle_type=tpl.vehicle_type,
                    is_weekend=day.is_weekend,
                )
            )
    duties.sort(key=lambda d: (d.start_abs, d.code))
    return tuple(replace(d, id=i) for i, d in enumerate(duties))


def build_problem(
    period: PlanningPeriod,
    day_types: dict[str, DayType],
    drivers: tuple[Driver, ...],
    absences: tuple[Absence, ...],
    history: dict[str, DriverHistory],
) -> Problem:
    """Derive duty instances, availability and eligibility lookup tables."""
    duties = instantiate_duties(period, day_types)

    duties_by_day: dict[int, list[int]] = {d.day_index: [] for d in period.days}
    for duty in duties:
        duties_by_day[duty.day_index].append(duty.id)

    absence_on: dict[tuple[int, int], AbsenceType] = {}
    available: dict[tuple[int, int], bool] = {}
    for drv in drivers:
        per_date = [a for a in absences if a.driver_code == drv.code]
        for day in period.days:
            absent = next((a for a in per_date if a.covers(day.date)), None)
            if absent is not None:
                absence_on[(drv.id, day.day_index)] = absent.absence_type
            available[(drv.id, day.day_index)] = (
                absent is None and drv.is_active(day.date)
            )

    eligible_drivers: dict[int, tuple[int, ...]] = {}
    for duty in duties:
        ok = []
        for drv in drivers:
            if not available[(drv.id, duty.day_index)]:
                continue
            if duty.vehicle_type is not None and drv.allowed_vehicle_types is not None:
                if duty.vehicle_type not in drv.allowed_vehicle_types:
                    continue
            ok.append(drv.id)
        eligible_drivers[duty.id] = tuple(ok)

    return Problem(
        period=period,
        drivers=drivers,
        duties=duties,
        absences=absences,
        history=history,
        duties_by_day={k: tuple(v) for k, v in duties_by_day.items()},
        available=available,
        eligible_drivers=eligible_drivers,
        absence_on=absence_on,
    )


# ---------------------------------------------------------------------------
# Result-side entities
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class ConstraintTag:
    """Identity of one toggleable constraint group — used both for CP-SAT
    assumption literals and the Dutch infeasibility report."""

    family: str                        # e.g. "eu561.daily_rest"
    driver_code: str | None = None
    week_index: int | None = None
    day_index: int | None = None

    def label(self) -> str:
        parts = [self.family]
        if self.driver_code is not None:
            parts.append(f"chauffeur {self.driver_code}")
        if self.week_index is not None:
            parts.append(f"week {self.week_index + 1}")
        if self.day_index is not None:
            parts.append(f"dag {self.day_index + 1}")
        return ", ".join(parts)


@dataclass(frozen=True, slots=True)
class ValidationMessage:
    code: str                          # Exxx blocking, Wxxx warning
    message: str                       # Dutch, names the duty/driver/date

    @property
    def blocking(self) -> bool:
        return self.code.startswith("E")


@dataclass(frozen=True, slots=True)
class ReportItem:
    level: str                         # FOUT | WAARSCHUWING | INFO
    category: str                      # Bezetting | Regelconflict | ...
    dates: str
    subject: str                       # driver/duty or "—"
    description: str
    suggestion: str = ""


@dataclass(frozen=True, slots=True)
class InfeasibilityReport:
    items: tuple[ReportItem, ...]
    core_families: tuple[str, ...] = ()        # layer 2: minimal core
    relaxations: tuple[str, ...] = ()          # layer 3: single-family fixes


@dataclass(frozen=True, slots=True)
class Assignment:
    duty_id: int
    driver_id: int


@dataclass(frozen=True, slots=True)
class SolveResult:
    status: str                        # OPTIMAAL | HAALBAAR | INFEASIBLE | ONBEKEND
    assignments: tuple[Assignment, ...]
    objective: int | None
    penalty_breakdown: dict[str, int]  # soft family -> penalty
    infeasibility: InfeasibilityReport | None
    wall_time_s: float
    assumptions_used: tuple[str, ...] = ()     # carry-in defaults applied
