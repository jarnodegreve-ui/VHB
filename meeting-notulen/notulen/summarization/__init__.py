"""Samenvattings-backends (transcript -> gestructureerde notulen)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable

from ..exceptions import ConfigurationError
from .base import Summarizer

if TYPE_CHECKING:
    from ..config import PipelineConfig


def _create_claude(config: "PipelineConfig") -> Summarizer:
    from .claude import ClaudeSummarizer

    return ClaudeSummarizer(
        model=config.claude_model,
        max_output_tokens=config.max_output_tokens,
        meeting_context=config.meeting_context,
    )


SUMMARIZER_FACTORIES: dict[str, Callable[["PipelineConfig"], Summarizer]] = {
    "claude": _create_claude,
}

DEFAULT_BACKEND = "claude"


def create_summarizer(config: "PipelineConfig", backend: str = DEFAULT_BACKEND) -> Summarizer:
    """Maak een summarizer aan op basis van de backend-naam."""
    try:
        factory = SUMMARIZER_FACTORIES[backend]
    except KeyError:
        available = ", ".join(sorted(SUMMARIZER_FACTORIES))
        raise ConfigurationError(
            f"Onbekende samenvattings-backend '{backend}'. Beschikbaar: {available}"
        ) from None
    return factory(config)


__all__ = ["Summarizer", "create_summarizer", "SUMMARIZER_FACTORIES", "DEFAULT_BACKEND"]
