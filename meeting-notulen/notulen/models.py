"""Datamodellen die tussen de pipeline-stappen doorgegeven worden."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


@dataclass(frozen=True)
class TranscriptSegment:
    """Eén uitgesproken segment met tijdcodes (in seconden)."""

    start: float
    end: float
    text: str

    @property
    def timestamp(self) -> str:
        """Starttijd als [HH:MM:SS] of [MM:SS] label."""
        total = int(self.start)
        hours, rest = divmod(total, 3600)
        minutes, seconds = divmod(rest, 60)
        if hours:
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return f"{minutes:02d}:{seconds:02d}"


@dataclass
class Transcript:
    """Volledig transcript van een audiobestand."""

    segments: list[TranscriptSegment]
    language: Optional[str] = None
    duration_seconds: Optional[float] = None
    source_path: Optional[Path] = None

    @property
    def text(self) -> str:
        """Plat transcript zonder tijdcodes."""
        return "\n".join(seg.text.strip() for seg in self.segments if seg.text.strip())

    def as_timestamped_text(self) -> str:
        """Transcript met tijdcodes, zoals het naar het taalmodel gaat."""
        lines = []
        for seg in self.segments:
            text = seg.text.strip()
            if text:
                lines.append(f"[{seg.timestamp}] {text}")
        return "\n".join(lines)


@dataclass(frozen=True)
class ActionItem:
    """Actiepunt met (optionele) eigenaar en deadline."""

    description: str
    owner: Optional[str] = None
    deadline: Optional[str] = None


@dataclass
class MeetingMinutes:
    """Gestructureerde notulen zoals afgeleid uit het transcript."""

    title: str
    date: Optional[str]
    participants: list[str]
    purpose: Optional[str]
    key_points: list[str]
    decisions: list[str]
    action_items: list[ActionItem]
    open_questions: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MeetingMinutes":
        """Bouw notulen uit het JSON-object dat het model teruggeeft.

        De sleutels zijn Nederlands omdat het output-schema (zie prompts.py)
        Nederlandstalig is.
        """
        return cls(
            title=data.get("titel") or "Meeting-notulen",
            date=data.get("datum"),
            participants=list(data.get("deelnemers") or []),
            purpose=data.get("doel"),
            key_points=list(data.get("kernpunten") or []),
            decisions=list(data.get("beslissingen") or []),
            action_items=[
                ActionItem(
                    description=item.get("omschrijving", ""),
                    owner=item.get("eigenaar"),
                    deadline=item.get("deadline"),
                )
                for item in (data.get("actiepunten") or [])
                if item.get("omschrijving")
            ],
            open_questions=list(data.get("open_punten") or []),
        )


@dataclass
class PipelineResult:
    """Eindresultaat van een volledige pipeline-run."""

    transcript: Transcript
    minutes: MeetingMinutes
    output_path: Path
    generated_at: datetime
    model: str
