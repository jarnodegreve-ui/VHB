"""Output-writers (notulen -> bestand, database, ...)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .base import OutputWriter
from .markdown import MarkdownWriter

if TYPE_CHECKING:
    from ..config import PipelineConfig


def create_writers(config: "PipelineConfig") -> list[OutputWriter]:
    """Stel de lijst writers samen op basis van de config.

    Markdown is altijd de primaire output; Supabase komt er optioneel bij.
    """
    writers: list[OutputWriter] = [MarkdownWriter(config.resolve_output_path())]
    if config.store_supabase:
        from .supabase import SupabaseWriter

        # validate() garandeert dat url en key gezet zijn
        writers.append(SupabaseWriter(config.supabase_url, config.supabase_key))
    return writers


__all__ = ["OutputWriter", "MarkdownWriter", "create_writers"]
