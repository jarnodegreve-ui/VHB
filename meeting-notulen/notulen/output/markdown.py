"""Markdown-writer: rendert MeetingMinutes naar een leesbaar .md-bestand."""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from ..exceptions import OutputError
from ..models import MeetingMinutes, Transcript
from .base import OutputWriter

logger = logging.getLogger(__name__)


def _format_duration(seconds: float | None) -> str | None:
    if seconds is None:
        return None
    total = int(seconds)
    hours, rest = divmod(total, 3600)
    minutes, _ = divmod(rest, 60)
    if hours:
        return f"{hours}u{minutes:02d}m"
    return f"{minutes} min"


def render_markdown(
    minutes: MeetingMinutes,
    transcript: Transcript,
    *,
    model: str,
    generated_at: datetime | None = None,
) -> str:
    """Render de notulen als markdown-string (puur, zonder file-IO)."""
    generated_at = generated_at or datetime.now()
    lines: list[str] = [f"# {minutes.title}", ""]

    lines.append(f"**Datum:** {minutes.date or 'onbekend'}  ")
    participants = ", ".join(minutes.participants) if minutes.participants else "onbekend"
    lines.append(f"**Deelnemers:** {participants}  ")
    lines.append(f"**Doel:** {minutes.purpose or 'niet expliciet benoemd'}")
    lines.append("")

    lines.append("## Kernpunten")
    lines.append("")
    if minutes.key_points:
        lines.extend(f"- {point}" for point in minutes.key_points)
    else:
        lines.append("_Geen kernpunten geïdentificeerd._")
    lines.append("")

    lines.append("## Beslissingen")
    lines.append("")
    if minutes.decisions:
        lines.extend(f"- {decision}" for decision in minutes.decisions)
    else:
        lines.append("_Geen expliciete beslissingen genomen._")
    lines.append("")

    lines.append("## Actiepunten")
    lines.append("")
    if minutes.action_items:
        lines.append("| # | Actie | Eigenaar | Deadline |")
        lines.append("|---|-------|----------|----------|")
        for idx, item in enumerate(minutes.action_items, start=1):
            owner = item.owner or "—"
            deadline = item.deadline or "—"
            description = item.description.replace("|", "\\|")
            lines.append(f"| {idx} | {description} | {owner} | {deadline} |")
    else:
        lines.append("_Geen actiepunten geïdentificeerd._")
    lines.append("")

    if minutes.open_questions:
        lines.append("## Open punten")
        lines.append("")
        lines.extend(f"- {question}" for question in minutes.open_questions)
        lines.append("")

    # Metadata-footer zodat altijd traceerbaar is hoe de notulen ontstaan zijn
    lines.append("---")
    lines.append("")
    meta = [
        f"Gegenereerd op {generated_at.strftime('%Y-%m-%d %H:%M')}",
        f"model: {model}",
    ]
    if transcript.source_path is not None:
        meta.append(f"bron: {transcript.source_path.name}")
    duration = _format_duration(transcript.duration_seconds)
    if duration:
        meta.append(f"duur opname: {duration}")
    lines.append(f"_{' · '.join(meta)}_")
    lines.append("")

    return "\n".join(lines)


class MarkdownWriter(OutputWriter):
    """Schrijft de notulen als markdown-bestand naar schijf."""

    def write(
        self,
        minutes: MeetingMinutes,
        transcript: Transcript,
        destination: Path,
        *,
        model: str,
    ) -> Path:
        content = render_markdown(minutes, transcript, model=model)
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(content, encoding="utf-8")
        except OSError as exc:
            raise OutputError(f"Kon notulen niet wegschrijven naar {destination}: {exc}") from exc
        logger.info("Notulen weggeschreven naar %s", destination)
        return destination
