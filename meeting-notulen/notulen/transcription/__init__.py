"""Transcriptie-backends.

Nieuwe backends (bv. whisper.cpp) registreer je in TRANSCRIBER_FACTORIES;
de import gebeurt lazy zodat een ontbrekende dependency van backend A
backend B niet blokkeert.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable

from ..exceptions import ConfigurationError
from .base import Transcriber

if TYPE_CHECKING:
    from ..config import PipelineConfig


def _create_faster_whisper(config: "PipelineConfig") -> Transcriber:
    from .faster_whisper import FasterWhisperTranscriber

    return FasterWhisperTranscriber(
        model_size=config.whisper_model,
        device=config.whisper_device,
        language=config.language,
    )


TRANSCRIBER_FACTORIES: dict[str, Callable[["PipelineConfig"], Transcriber]] = {
    "faster-whisper": _create_faster_whisper,
}

DEFAULT_BACKEND = "faster-whisper"


def create_transcriber(config: "PipelineConfig", backend: str = DEFAULT_BACKEND) -> Transcriber:
    """Maak een transcriber aan; met config.diarize komt er een diarization-laag omheen."""
    try:
        factory = TRANSCRIBER_FACTORIES[backend]
    except KeyError:
        available = ", ".join(sorted(TRANSCRIBER_FACTORIES))
        raise ConfigurationError(
            f"Onbekende transcriptie-backend '{backend}'. Beschikbaar: {available}"
        ) from None
    transcriber = factory(config)

    if config.diarize:
        from .diarization import PyannoteDiarizedTranscriber

        transcriber = PyannoteDiarizedTranscriber(
            base=transcriber,
            hf_token=config.hf_token,
            model_name=config.diarization_model,
            device=config.whisper_device if config.whisper_device != "auto" else "cpu",
        )
    return transcriber


__all__ = ["Transcriber", "create_transcriber", "TRANSCRIBER_FACTORIES", "DEFAULT_BACKEND"]
