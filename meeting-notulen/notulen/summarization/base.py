"""Interface voor samenvattings-backends."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import MeetingMinutes, Transcript


class Summarizer(ABC):
    """Destilleert gestructureerde notulen uit een transcript."""

    @abstractmethod
    def summarize(self, transcript: Transcript) -> MeetingMinutes:
        """Vat het transcript samen tot notulen.

        Raises:
            SummarizationError: als de samenvatting mislukt.
        """
