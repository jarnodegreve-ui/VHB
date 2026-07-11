"""Orchestratie van de volledige pipeline: audio -> transcript -> notulen -> output."""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from .config import PipelineConfig
from .models import PipelineResult
from .output import MarkdownWriter, OutputWriter, create_writers
from .summarization import create_summarizer
from .transcription import create_transcriber

logger = logging.getLogger(__name__)


class NotulenPipeline:
    """Voert de pipeline-stappen in volgorde uit.

    De stappen zijn injecteerbaar (voor tests en latere backends); standaard
    worden ze via de factories uit de config opgebouwd.
    """

    def __init__(
        self,
        config: PipelineConfig,
        transcriber=None,
        summarizer=None,
        writers: list[OutputWriter] | None = None,
    ) -> None:
        self.config = config
        self._transcriber = transcriber
        self._summarizer = summarizer
        self._writers = writers

    def run(self) -> PipelineResult:
        """Draai de volledige pipeline en geef het resultaat terug."""
        self.config.validate()

        transcriber = self._transcriber or create_transcriber(self.config)
        summarizer = self._summarizer or create_summarizer(self.config)
        writers = self._writers if self._writers is not None else create_writers(self.config)

        logger.info("Stap 1/3: transcriptie")
        transcript = transcriber.transcribe(self.config.audio_path)

        logger.info("Stap 2/3: samenvatting")
        minutes = summarizer.summarize(transcript)

        logger.info("Stap 3/3: wegschrijven (%d bestemming(en))", len(writers))
        model = getattr(summarizer, "model", "onbekend")
        destinations = [
            writer.write(minutes, transcript, model=model) for writer in writers
        ]

        # Het markdown-pad blijft de primaire output voor de eindrapportage
        markdown_paths = [w.destination for w in writers if isinstance(w, MarkdownWriter)]
        output_path = markdown_paths[0] if markdown_paths else Path(destinations[0])

        return PipelineResult(
            transcript=transcript,
            minutes=minutes,
            output_path=output_path,
            generated_at=datetime.now(),
            model=model,
            destinations=destinations,
        )
