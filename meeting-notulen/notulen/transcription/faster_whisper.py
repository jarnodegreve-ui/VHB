"""Lokale transcriptie via faster-whisper (CTranslate2-implementatie van Whisper)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from ..exceptions import TranscriptionError
from ..models import Transcript, TranscriptSegment
from .base import Transcriber

logger = logging.getLogger(__name__)


class FasterWhisperTranscriber(Transcriber):
    """Transcriber op basis van faster-whisper. Draait volledig lokaal.

    Het model wordt bij de eerste run automatisch gedownload naar de
    HuggingFace-cache (~/.cache/huggingface).
    """

    def __init__(
        self,
        model_size: str = "small",
        device: str = "auto",
        language: Optional[str] = None,
    ) -> None:
        self._model_size = model_size
        self._device = device
        self._language = language
        self._model = None  # lazy: pas laden als er echt getranscribeerd wordt

    def _load_model(self):
        if self._model is not None:
            return self._model
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise TranscriptionError(
                "faster-whisper is niet geïnstalleerd. "
                "Installeer de dependencies met: pip install -r requirements.txt"
            ) from exc

        logger.info("Whisper-model '%s' laden (device=%s)...", self._model_size, self._device)
        try:
            # compute_type int8 houdt het geheugengebruik op CPU beheersbaar;
            # op GPU ("cuda") kiest faster-whisper zelf een passend type.
            compute_type = "int8" if self._device in ("auto", "cpu") else "default"
            self._model = WhisperModel(
                self._model_size, device=self._device, compute_type=compute_type
            )
        except Exception as exc:
            raise TranscriptionError(
                f"Kon Whisper-model '{self._model_size}' niet laden: {exc}"
            ) from exc
        return self._model

    def transcribe(self, audio_path: Path) -> Transcript:
        model = self._load_model()
        logger.info("Transcriberen van %s ...", audio_path.name)
        try:
            segments_iter, info = model.transcribe(
                str(audio_path),
                language=self._language,
                vad_filter=True,  # knip lange stiltes weg
                beam_size=5,
            )
            segments = [
                TranscriptSegment(start=seg.start, end=seg.end, text=seg.text)
                for seg in segments_iter
            ]
        except TranscriptionError:
            raise
        except Exception as exc:
            raise TranscriptionError(f"Transcriptie mislukt: {exc}") from exc

        if not segments:
            raise TranscriptionError(
                "Transcriptie leverde geen tekst op. Bevat de opname spraak?"
            )

        logger.info(
            "Transcriptie klaar: %d segmenten, taal=%s, duur=%.0fs",
            len(segments),
            info.language,
            info.duration,
        )
        return Transcript(
            segments=segments,
            language=info.language,
            duration_seconds=info.duration,
            source_path=audio_path,
        )
