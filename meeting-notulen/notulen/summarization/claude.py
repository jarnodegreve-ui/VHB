"""Samenvatting via de Claude API met structured output.

Het transcript gaat in één (streaming) request naar Claude; het antwoord is
gegarandeerd geldige JSON volgens MINUTES_SCHEMA dankzij structured outputs.
"""

from __future__ import annotations

import datetime
import json
import logging
from typing import Optional

from ..exceptions import SummarizationError
from ..models import MeetingMinutes, Transcript
from ..prompts import MINUTES_SCHEMA, SYSTEM_PROMPT, build_user_prompt
from .base import Summarizer

logger = logging.getLogger(__name__)


class ClaudeSummarizer(Summarizer):
    """Summarizer op basis van de Anthropic SDK (Messages API)."""

    def __init__(
        self,
        model: str = "claude-opus-4-8",
        max_output_tokens: int = 16_000,
        meeting_context: Optional[str] = None,
    ) -> None:
        self.model = model
        self._max_output_tokens = max_output_tokens
        self._meeting_context = meeting_context

    def _create_client(self):
        try:
            import anthropic
        except ImportError as exc:
            raise SummarizationError(
                "De anthropic SDK is niet geïnstalleerd. "
                "Installeer de dependencies met: pip install -r requirements.txt"
            ) from exc
        # Credentials komen uit de omgeving (ANTHROPIC_API_KEY of een
        # `ant auth login`-profiel); we geven bewust geen key mee in code.
        return anthropic.Anthropic()

    def summarize(self, transcript: Transcript) -> MeetingMinutes:
        import anthropic

        client = self._create_client()
        user_prompt = self._build_prompt(transcript)

        logger.info("Notulen genereren met %s ...", self.model)
        try:
            # Streaming voorkomt HTTP-timeouts bij lange transcripten.
            with client.messages.stream(
                model=self.model,
                max_tokens=self._max_output_tokens,
                system=SYSTEM_PROMPT,
                thinking={"type": "adaptive"},
                output_config={"format": {"type": "json_schema", "schema": MINUTES_SCHEMA}},
                messages=[{"role": "user", "content": user_prompt}],
            ) as stream:
                message = stream.get_final_message()
        except anthropic.AuthenticationError as exc:
            raise SummarizationError(
                "Authenticatie bij de Claude API mislukt. "
                "Zet ANTHROPIC_API_KEY in je omgeving of .env-bestand."
            ) from exc
        except anthropic.NotFoundError as exc:
            raise SummarizationError(
                f"Model '{self.model}' niet gevonden. Controleer NOTULEN_CLAUDE_MODEL."
            ) from exc
        except anthropic.RateLimitError as exc:
            raise SummarizationError(
                "Rate limit van de Claude API bereikt. Probeer het zo weer."
            ) from exc
        except anthropic.APIStatusError as exc:
            raise SummarizationError(
                f"Claude API-fout ({exc.status_code}): {exc.message}"
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise SummarizationError(
                f"Kon de Claude API niet bereiken: {exc}"
            ) from exc

        return self._parse_response(message)

    def _build_prompt(self, transcript: Transcript) -> str:
        file_date = None
        if transcript.source_path is not None and transcript.source_path.exists():
            mtime = transcript.source_path.stat().st_mtime
            file_date = datetime.date.fromtimestamp(mtime).isoformat()
        return build_user_prompt(
            transcript.as_timestamped_text(),
            source_name=transcript.source_path.name if transcript.source_path else None,
            file_date=file_date,
            language=transcript.language,
            meeting_context=self._meeting_context,
        )

    def _parse_response(self, message) -> MeetingMinutes:
        if message.stop_reason == "refusal":
            raise SummarizationError(
                "Claude heeft dit verzoek geweigerd (safety refusal)."
            )
        if message.stop_reason == "max_tokens":
            raise SummarizationError(
                "Het antwoord werd afgekapt (max_tokens bereikt). "
                "Verhoog max_output_tokens of gebruik een kortere opname."
            )

        text = "".join(
            block.text for block in message.content if block.type == "text"
        )
        if not text.strip():
            raise SummarizationError("Claude gaf een leeg antwoord terug.")

        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SummarizationError(
                f"Antwoord van Claude was geen geldige JSON: {exc}"
            ) from exc

        logger.info(
            "Notulen gegenereerd (%d input / %d output tokens)",
            message.usage.input_tokens,
            message.usage.output_tokens,
        )
        return MeetingMinutes.from_dict(data)
