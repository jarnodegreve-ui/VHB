"""Configuration loading for the VHB Planner.

Constraint toggles, legal parameters and soft-constraint weights live in a
TOML file (git-diffable, comments can cite legal sources — DESIGN.md §6).
Every solver constraint family is keyed by the same dotted name everywhere:
TOML key, CLI --disable flag, ConstraintTag.family and the Dutch report.

The full effective config is echoed into the output Rapport sheet.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field, fields, replace
from pathlib import Path

from models import Minutes


@dataclass(frozen=True, slots=True)
class SolverSection:
    max_time_s: float = 60.0
    workers: int = 8
    relaxation_pass: bool = True       # layer-3 infeasibility diagnosis
    relaxation_time_s: float = 10.0    # per single-family re-solve


@dataclass(frozen=True, slots=True)
class EU561Section:
    # H1 — daily driving (validator >10h; solver counts 9-10h extensions)
    max_daily_driving: bool = True
    daily_driving_max: Minutes = 540
    extended_daily_driving_max: Minutes = 600
    extended_days_per_week: int = 2
    # H2 — daily rest between duties
    daily_rest: bool = True
    daily_rest_min: Minutes = 660
    reduced_daily_rest_min: Minutes = 540
    reduced_daily_rests_per_week: int = 3
    strict_24h_window: bool = True     # spread > 13h forces a reduced-rest credit
    # H3 — weekly rest
    weekly_rest: bool = True
    weekly_rest_min: Minutes = 2700
    weekly_rest_mode: str = "gap"      # "gap" (exact) | "two_days_off" (debug)
    allow_reduced_weekly_rest: bool = False
    reduced_weekly_rest_min: Minutes = 1440
    # H5/H6 — driving caps
    weekly_driving_cap: bool = True
    weekly_driving_max: Minutes = 3360
    biweekly_driving_cap: bool = True
    biweekly_driving_max: Minutes = 5400
    # Art. 8(6) 144h rule — post-solve report check in Phase 1 (DESIGN.md §4)
    report_gap_between_weekly_rests: bool = True
    max_gap_between_weekly_rests: Minutes = 8640


@dataclass(frozen=True, slots=True)
class CAOSection:
    # H7 — amplitude (input validation; values confirmed Q3)
    max_amplitude: bool = True
    amplitude_max: Minutes = 840
    amplitude_max_interrupted: Minutes = 960
    min_interruption_for_extension: Minutes = 240
    # H8 — consecutive working days (rolling)
    max_consecutive_days: bool = True
    consecutive_days_max: int = 6
    # H10 — contract hours, period-average semantics (confirmed Q1)
    contract_hours: bool = True
    contract_tolerance_period: Minutes = 0
    paid_absence_credit: bool = True   # paid absence day = contract/5 credit
    absence_credit_divisor: int = 5


@dataclass(frozen=True, slots=True)
class KB2005Section:
    # H11 — working time (basis = diensttijd, confirmed Q1)
    daily_working_time: bool = True
    daily_working_max: Minutes = 720   # 12h geregeld vervoer (KB 10-08-2005)
    weekly_working_time: bool = True
    weekly_working_max: Minutes = 3000


@dataclass(frozen=True, slots=True)
class SoftSection:
    fair_early: int = 3
    fair_late: int = 3
    fair_broken: int = 3
    fair_night: int = 3
    fair_weekend: int = 5
    hours_balance: int = 4
    early_after_late: int = 2
    early_after_late_graded: bool = False   # graded penalty for gap in [11h,13h)


@dataclass(frozen=True, slots=True)
class ValidateSection:
    duty_break_slack: str = "warning"  # "warning" | "error" | "off"


@dataclass(frozen=True, slots=True)
class Config:
    solver: SolverSection = field(default_factory=SolverSection)
    eu561: EU561Section = field(default_factory=EU561Section)
    cao: CAOSection = field(default_factory=CAOSection)
    kb2005: KB2005Section = field(default_factory=KB2005Section)
    soft: SoftSection = field(default_factory=SoftSection)
    validate: ValidateSection = field(default_factory=ValidateSection)

    # Solver constraint families that can carry an assumption literal and be
    # individually disabled. Order = relaxation-pass order.
    FAMILIES = (
        "dekking",                     # every duty assigned (exactly-one)
        "eu561.max_daily_driving",
        "eu561.daily_rest",
        "eu561.weekly_rest",
        "eu561.weekly_driving_cap",
        "eu561.biweekly_driving_cap",
        "cao.max_consecutive_days",
        "cao.contract_hours",
        "kb2005.weekly_working_time",
    )

    def family_enabled(self, family: str) -> bool:
        if family == "dekking":
            return True
        section_name, key = family.split(".", 1)
        return bool(getattr(getattr(self, section_name), key))

    def with_family_disabled(self, family: str) -> "Config":
        section_name, key = family.split(".", 1)
        section = getattr(self, section_name)
        return replace(self, **{section_name: replace(section, **{key: False})})

    def as_flat_dict(self) -> dict[str, object]:
        """Dotted-key snapshot for the Rapport sheet audit trail."""
        out: dict[str, object] = {}
        for section_field in fields(self):
            section = getattr(self, section_field.name)
            for f in fields(section):
                out[f"{section_field.name}.{f.name}"] = getattr(section, f.name)
        return out


_SECTIONS = {
    "solver": SolverSection,
    "eu561": EU561Section,
    "cao": CAOSection,
    "kb2005": KB2005Section,
    "soft": SoftSection,
    "validate": ValidateSection,
}


def load_config(path: Path | None) -> tuple[Config, list[str]]:
    """Load config.toml; unknown keys produce warnings, not errors.

    Returns (config, warnings). A missing file yields all defaults.
    """
    warnings: list[str] = []
    if path is None or not path.exists():
        if path is not None:
            warnings.append(f"Configbestand '{path}' niet gevonden — standaardwaarden gebruikt.")
        return Config(), warnings

    raw = tomllib.loads(path.read_text(encoding="utf-8"))
    kwargs: dict[str, object] = {}
    for name, cls in _SECTIONS.items():
        section_raw = raw.pop(name, {})
        if not isinstance(section_raw, dict):
            warnings.append(f"Config: sectie [{name}] is geen tabel — genegeerd.")
            section_raw = {}
        known = {f.name: f for f in fields(cls)}
        clean: dict[str, object] = {}
        for key, value in section_raw.items():
            if key not in known:
                warnings.append(f"Config: onbekende sleutel '{name}.{key}' genegeerd.")
                continue
            clean[key] = value
        kwargs[name] = cls(**clean)
    for leftover in raw:
        warnings.append(f"Config: onbekende sectie [{leftover}] genegeerd.")
    return Config(**kwargs), warnings
