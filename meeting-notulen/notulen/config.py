"""Configuratie voor de pipeline: CLI-argumenten > omgevingsvariabelen > defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .exceptions import ConfigurationError

# Omgevingsvariabelen (allemaal optioneel, behalve de API key bij het samenvatten)
ENV_CLAUDE_MODEL = "NOTULEN_CLAUDE_MODEL"
ENV_WHISPER_MODEL = "NOTULEN_WHISPER_MODEL"
ENV_WHISPER_DEVICE = "NOTULEN_WHISPER_DEVICE"
ENV_LANGUAGE = "NOTULEN_LANGUAGE"
ENV_OUTPUT_DIR = "NOTULEN_OUTPUT_DIR"
ENV_DIARIZATION_MODEL = "NOTULEN_DIARIZATION_MODEL"
ENV_HF_TOKEN = "HUGGINGFACE_TOKEN"
ENV_SUPABASE_URL = "SUPABASE_URL"
ENV_SUPABASE_KEY = "SUPABASE_SERVICE_ROLE_KEY"

DEFAULT_CLAUDE_MODEL = "claude-opus-4-8"
DEFAULT_WHISPER_MODEL = "small"
DEFAULT_WHISPER_DEVICE = "auto"
DEFAULT_MAX_OUTPUT_TOKENS = 16_000
DEFAULT_DIARIZATION_MODEL = "pyannote/speaker-diarization-3.1"

SUPPORTED_AUDIO_SUFFIXES = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".webm", ".mp4"}


def _load_dotenv() -> None:
    """Laad een lokale .env als python-dotenv beschikbaar is (optioneel)."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv()


@dataclass
class PipelineConfig:
    """Alle instellingen voor één pipeline-run."""

    audio_path: Path
    output_path: Optional[Path] = None
    language: Optional[str] = None

    # Transcriptie
    whisper_model: str = DEFAULT_WHISPER_MODEL
    whisper_device: str = DEFAULT_WHISPER_DEVICE

    # Diarization (wie zei wat) — optioneel, vereist requirements-diarization.txt
    diarize: bool = False
    diarization_model: str = DEFAULT_DIARIZATION_MODEL
    hf_token: Optional[str] = None

    # Samenvatting
    claude_model: str = DEFAULT_CLAUDE_MODEL
    max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS

    # Opslag in Supabase — optioneel, naast het markdown-bestand
    store_supabase: bool = False
    supabase_url: Optional[str] = None
    supabase_key: Optional[str] = None

    # Extra context die de gebruiker meegeeft (bv. "leveranciersmeeting met X")
    meeting_context: Optional[str] = None

    @classmethod
    def from_env(cls, audio_path: Path, **overrides) -> "PipelineConfig":
        """Bouw een config uit omgevingsvariabelen, met expliciete overrides erbovenop."""
        _load_dotenv()
        values = {
            "language": os.environ.get(ENV_LANGUAGE),
            "whisper_model": os.environ.get(ENV_WHISPER_MODEL, DEFAULT_WHISPER_MODEL),
            "whisper_device": os.environ.get(ENV_WHISPER_DEVICE, DEFAULT_WHISPER_DEVICE),
            "claude_model": os.environ.get(ENV_CLAUDE_MODEL, DEFAULT_CLAUDE_MODEL),
            "diarization_model": os.environ.get(ENV_DIARIZATION_MODEL, DEFAULT_DIARIZATION_MODEL),
            "hf_token": os.environ.get(ENV_HF_TOKEN),
            "supabase_url": os.environ.get(ENV_SUPABASE_URL),
            "supabase_key": os.environ.get(ENV_SUPABASE_KEY),
        }
        values.update({k: v for k, v in overrides.items() if v is not None})
        return cls(audio_path=audio_path, **values)

    def validate(self) -> None:
        """Controleer de invoer voordat de (trage) pipeline start."""
        if not self.audio_path.exists():
            raise ConfigurationError(f"Audiobestand niet gevonden: {self.audio_path}")
        if not self.audio_path.is_file():
            raise ConfigurationError(f"Geen bestand: {self.audio_path}")
        if self.audio_path.suffix.lower() not in SUPPORTED_AUDIO_SUFFIXES:
            supported = ", ".join(sorted(SUPPORTED_AUDIO_SUFFIXES))
            raise ConfigurationError(
                f"Niet-ondersteund audioformaat '{self.audio_path.suffix}'. "
                f"Ondersteund: {supported}"
            )
        if self.store_supabase and not (self.supabase_url and self.supabase_key):
            raise ConfigurationError(
                "Supabase-opslag vereist SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY "
                "in je omgeving of .env-bestand."
            )

    def resolve_output_path(self) -> Path:
        """Bepaal waar het markdown-bestand komt.

        Expliciet pad wint; anders <NOTULEN_OUTPUT_DIR of map van audio>/<naam>-notulen.md.
        """
        if self.output_path is not None:
            return self.output_path
        output_dir = os.environ.get(ENV_OUTPUT_DIR)
        base_dir = Path(output_dir) if output_dir else self.audio_path.parent
        return base_dir / f"{self.audio_path.stem}-notulen.md"
