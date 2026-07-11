"""Interface voor output-writers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from ..models import MeetingMinutes, Transcript


class OutputWriter(ABC):
    """Schrijft notulen weg naar een bestemming."""

    @abstractmethod
    def write(
        self,
        minutes: MeetingMinutes,
        transcript: Transcript,
        destination: Path,
        *,
        model: str,
    ) -> Path:
        """Schrijf de notulen weg en geef het uiteindelijke pad terug.

        Raises:
            OutputError: als het wegschrijven mislukt.
        """
