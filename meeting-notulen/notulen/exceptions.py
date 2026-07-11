"""Domein-specifieke fouten voor de notulen-pipeline.

Elke pipeline-stap gooit zijn eigen fouttype, zodat de CLI per stap een
duidelijke melding en exit code kan geven.
"""

from __future__ import annotations


class NotulenError(Exception):
    """Basisfout voor alle pipeline-fouten."""

    exit_code = 1


class AudioFileError(NotulenError):
    """Het audiobestand ontbreekt, is onleesbaar of heeft een niet-ondersteund formaat."""

    exit_code = 2


class TranscriptionError(NotulenError):
    """De transcriptie-stap (Whisper) is mislukt."""

    exit_code = 3


class SummarizationError(NotulenError):
    """De samenvattings-stap (Claude API) is mislukt."""

    exit_code = 4


class OutputError(NotulenError):
    """Het wegschrijven van het resultaat is mislukt."""

    exit_code = 5


class ConfigurationError(NotulenError):
    """Ontbrekende of ongeldige configuratie (bv. geen API key)."""

    exit_code = 6
