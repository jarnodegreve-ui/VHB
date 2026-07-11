"""Output-writers (notulen -> bestand of andere bestemming).

Een latere fase kan hier bv. een SupabaseWriter aan toevoegen.
"""

from .base import OutputWriter
from .markdown import MarkdownWriter

__all__ = ["OutputWriter", "MarkdownWriter"]
