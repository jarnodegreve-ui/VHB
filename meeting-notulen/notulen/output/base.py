"""Interface voor output-writers."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import MeetingMinutes, Transcript


class OutputWriter(ABC):
    """Schrijft notulen weg naar een bestemming (bestand, database, ...).

    De bestemming zelf (pad, connectie) is constructor-state van de concrete
    writer, zodat de pipeline een lijst writers kan afwerken zonder per
    writer andere argumenten te hoeven kennen.
    """

    @abstractmethod
    def write(self, minutes: MeetingMinutes, transcript: Transcript, *, model: str) -> str:
        """Schrijf de notulen weg en geef een omschrijving van de bestemming terug.

        Raises:
            OutputError: als het wegschrijven mislukt.
        """
