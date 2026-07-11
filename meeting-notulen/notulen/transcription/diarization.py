"""Diarization-laag: voegt sprekerlabels toe aan een bestaand transcript.

Werkt als decorator om een basis-Transcriber heen: eerst transcriberen
(faster-whisper), daarna spreker-detectie (pyannote.audio) en de twee
resultaten samenvoegen op basis van tijdsoverlap.

Vereist de extra dependencies uit requirements-diarization.txt en een
HuggingFace-token (het pyannote-model is gated; accepteer eenmalig de
voorwaarden op https://huggingface.co/pyannote/speaker-diarization-3.1).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Optional, Sequence

from ..exceptions import TranscriptionError
from ..models import Transcript, TranscriptSegment
from .base import Transcriber

logger = logging.getLogger(__name__)

DEFAULT_DIARIZATION_MODEL = "pyannote/speaker-diarization-3.1"


@dataclass(frozen=True)
class SpeakerTurn:
    """Eén spreekbeurt zoals pyannote die detecteert (tijden in seconden)."""

    start: float
    end: float
    speaker: str


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    """Tijdsoverlap tussen twee intervallen, in seconden (0 als disjunct)."""
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def assign_speakers(
    segments: Sequence[TranscriptSegment],
    turns: Sequence[SpeakerTurn],
    *,
    label_prefix: str = "SPREKER_",
) -> list[TranscriptSegment]:
    """Ken aan elk transcript-segment de spreker toe met de grootste tijdsoverlap.

    Pyannote-labels (SPEAKER_00, ...) worden hernummerd naar leesbare labels
    (SPREKER_1, ...) in volgorde van eerste optreden. Segmenten zonder enige
    overlap houden speaker=None.
    """
    # Stabiele hernummering: eerste keer dat een spreker aan het woord is bepaalt het nummer
    relabel: dict[str, str] = {}
    for turn in sorted(turns, key=lambda t: t.start):
        if turn.speaker not in relabel:
            relabel[turn.speaker] = f"{label_prefix}{len(relabel) + 1}"

    result: list[TranscriptSegment] = []
    for seg in segments:
        totals: dict[str, float] = {}
        for turn in turns:
            duration = _overlap(seg.start, seg.end, turn.start, turn.end)
            if duration > 0:
                totals[turn.speaker] = totals.get(turn.speaker, 0.0) + duration
        if totals:
            best = max(totals, key=lambda spk: totals[spk])
            result.append(replace(seg, speaker=relabel[best]))
        else:
            result.append(seg)
    return result


class PyannoteDiarizedTranscriber(Transcriber):
    """Decorator die sprekerlabels toevoegt aan het resultaat van een basis-transcriber."""

    def __init__(
        self,
        base: Transcriber,
        hf_token: Optional[str],
        model_name: str = DEFAULT_DIARIZATION_MODEL,
        device: str = "auto",
    ) -> None:
        self._base = base
        self._hf_token = hf_token
        self._model_name = model_name
        self._device = device
        self._pipeline = None  # lazy

    def _load_pipeline(self):
        if self._pipeline is not None:
            return self._pipeline
        if not self._hf_token:
            raise TranscriptionError(
                "Diarization vereist een HuggingFace-token. "
                "Zet HUGGINGFACE_TOKEN in je omgeving of .env-bestand en accepteer "
                f"de modelvoorwaarden op https://huggingface.co/{self._model_name}"
            )
        try:
            from pyannote.audio import Pipeline
        except ImportError as exc:
            raise TranscriptionError(
                "pyannote.audio is niet geïnstalleerd. Installeer de extra "
                "dependencies met: pip install -r requirements-diarization.txt"
            ) from exc

        logger.info("Diarization-model '%s' laden...", self._model_name)
        try:
            pipeline = Pipeline.from_pretrained(self._model_name, use_auth_token=self._hf_token)
            if pipeline is None:
                raise TranscriptionError(
                    f"Kon diarization-model '{self._model_name}' niet laden. "
                    "Controleer je HuggingFace-token en of je de modelvoorwaarden "
                    "geaccepteerd hebt."
                )
            if self._device == "cuda":
                import torch

                pipeline.to(torch.device("cuda"))
        except TranscriptionError:
            raise
        except Exception as exc:
            raise TranscriptionError(f"Diarization-model laden mislukt: {exc}") from exc
        self._pipeline = pipeline
        return pipeline

    def _detect_turns(self, audio_path: Path) -> list[SpeakerTurn]:
        pipeline = self._load_pipeline()
        logger.info("Sprekers detecteren in %s ...", audio_path.name)
        try:
            diarization = pipeline(str(audio_path))
            turns = [
                SpeakerTurn(start=turn.start, end=turn.end, speaker=speaker)
                for turn, _, speaker in diarization.itertracks(yield_label=True)
            ]
        except Exception as exc:
            raise TranscriptionError(f"Diarization mislukt: {exc}") from exc
        logger.info(
            "Diarization klaar: %d spreekbeurten, %d sprekers",
            len(turns),
            len({t.speaker for t in turns}),
        )
        return turns

    def transcribe(self, audio_path: Path) -> Transcript:
        transcript = self._base.transcribe(audio_path)
        turns = self._detect_turns(audio_path)
        if not turns:
            logger.warning("Geen sprekers gedetecteerd; transcript blijft zonder labels.")
            return transcript
        transcript.segments = assign_speakers(transcript.segments, turns)
        return transcript
