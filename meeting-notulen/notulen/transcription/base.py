"""Interface voor transcriptie-backends."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from ..models import Transcript


class Transcriber(ABC):
    """Zet een audiobestand om naar een Transcript."""

    @abstractmethod
    def transcribe(self, audio_path: Path) -> Transcript:
        """Transcribeer het audiobestand.

        Raises:
            TranscriptionError: als de transcriptie mislukt.
        """
