"""Command-line interface: `python notulen.py gesprek.mp3`."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from . import __version__
from .config import (
    DEFAULT_CLAUDE_MODEL,
    DEFAULT_WHISPER_MODEL,
    PipelineConfig,
)
from .exceptions import NotulenError
from .pipeline import NotulenPipeline

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="notulen",
        description=(
            "Zet een audio-opname van een meeting om naar gestructureerde "
            "notulen (markdown) via lokale Whisper-transcriptie en de Claude API."
        ),
    )
    parser.add_argument("audio", type=Path, help="pad naar het audiobestand (mp3/m4a/wav/...)")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="pad voor het markdown-bestand (default: <audionaam>-notulen.md naast de audio)",
    )
    parser.add_argument(
        "-l",
        "--language",
        default=None,
        help="taalcode van de opname, bv. 'nl' of 'en' (default: automatische detectie)",
    )
    parser.add_argument(
        "-c",
        "--context",
        default=None,
        help="extra context voor de samenvatting, bv. 'leveranciersmeeting met Acme over Q3'",
    )
    parser.add_argument(
        "--whisper-model",
        default=None,
        help=f"Whisper-modelgrootte: tiny/base/small/medium/large-v3 (default: {DEFAULT_WHISPER_MODEL})",
    )
    parser.add_argument(
        "--device",
        default=None,
        choices=["auto", "cpu", "cuda"],
        help="device voor de transcriptie (default: auto)",
    )
    parser.add_argument(
        "--claude-model",
        default=None,
        help=f"Claude-model voor de samenvatting (default: {DEFAULT_CLAUDE_MODEL})",
    )
    parser.add_argument(
        "--print",
        dest="print_output",
        action="store_true",
        help="toon de notulen ook op stdout",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="uitgebreide logging")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return parser


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s" if verbose else "%(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )
    if not verbose:
        # Alleen onze eigen voortgang tonen, geen debug van dependencies
        for noisy in ("httpx", "faster_whisper", "anthropic"):
            logging.getLogger(noisy).setLevel(logging.WARNING)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)

    config = PipelineConfig.from_env(
        audio_path=args.audio,
        output_path=args.output,
        language=args.language,
        whisper_model=args.whisper_model,
        whisper_device=args.device,
        claude_model=args.claude_model,
        meeting_context=args.context,
    )

    try:
        result = NotulenPipeline(config).run()
    except NotulenError as exc:
        logger.error("Fout: %s", exc)
        return exc.exit_code
    except KeyboardInterrupt:
        logger.error("Afgebroken.")
        return 130

    logger.info("")
    logger.info("Klaar ✓  Notulen: %s", result.output_path)
    logger.info(
        "  %d deelnemers · %d kernpunten · %d beslissingen · %d actiepunten",
        len(result.minutes.participants),
        len(result.minutes.key_points),
        len(result.minutes.decisions),
        len(result.minutes.action_items),
    )

    if args.print_output:
        print(result.output_path.read_text(encoding="utf-8"))

    return 0
