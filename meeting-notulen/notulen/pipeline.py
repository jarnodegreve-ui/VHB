"""Orchestratie van de volledige pipeline: audio -> transcript -> notulen -> markdown."""

from __future__ import annotations

import logging
from datetime import datetime

from .config import PipelineConfig
from .models import PipelineResult
from .output import MarkdownWriter, OutputWriter
from .summarization import create_summarizer
from .transcription import create_transcriber

logger = logging.getLogger(__name__)


class NotulenPipeline:
    """Voert de drie pipeline-stappen in volgorde uit.

    De stappen zijn injecteerbaar (voor tests en latere backends); standaard
    worden ze via de factories uit de config opgebouwd.
    """

    def __init__(
        self,
        config: PipelineConfig,
        transcriber=None,
        summarizer=None,
        writer: OutputWriter | None = None,
    ) -> None:
        self.config = config
        self._transcriber = transcriber
        self._summarizer = summarizer
        self._writer = writer or MarkdownWriter()

    def run(self) -> PipelineResult:
        """Draai de volledige pipeline en geef het resultaat terug."""
        self.config.validate()

        transcriber = self._transcriber or create_transcriber(self.config)
        summarizer = self._summarizer or create_summarizer(self.config)

        logger.info("Stap 1/3: transcriptie")
        transcript = transcriber.transcribe(self.config.audio_path)

        logger.info("Stap 2/3: samenvatting")
        minutes = summarizer.summarize(transcript)

        logger.info("Stap 3/3: wegschrijven")
        output_path = self.config.resolve_output_path()
        model = getattr(summarizer, "model", "onbekend")
        final_path = self._writer.write(minutes, transcript, output_path, model=model)

        return PipelineResult(
            transcript=transcript,
            minutes=minutes,
            output_path=final_path,
            generated_at=datetime.now(),
            model=model,
        )
