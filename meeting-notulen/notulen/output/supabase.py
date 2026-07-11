"""Supabase-writer: slaat notulen gestructureerd op via de PostgREST API.

Schrijft naar de tabellen `notulen` en `notulen_actiepunten` — zie
supabase/notulen_schema.sql voor het schema. Authenticatie gebeurt met de
service-role key (server-side tool), die RLS omzeilt; de tabellen hebben
RLS aan zonder policies zodat de anon key er niet bij kan.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from ..exceptions import OutputError
from ..models import MeetingMinutes, Transcript
from .base import OutputWriter

logger = logging.getLogger(__name__)

MEETINGS_TABLE = "notulen"
ACTION_ITEMS_TABLE = "notulen_actiepunten"


class SupabaseWriter(OutputWriter):
    """Schrijft notulen + actiepunten naar Supabase (PostgREST REST API)."""

    def __init__(
        self,
        url: str,
        service_role_key: str,
        *,
        timeout: float = 30.0,
        transport: Optional[Any] = None,  # injecteerbaar voor tests (httpx.MockTransport)
    ) -> None:
        self._base_url = url.rstrip("/")
        self._key = service_role_key
        self._timeout = timeout
        self._transport = transport

    def _client(self):
        try:
            import httpx
        except ImportError as exc:
            raise OutputError(
                "httpx is niet geïnstalleerd. "
                "Installeer de dependencies met: pip install -r requirements.txt"
            ) from exc
        return httpx.Client(
            base_url=f"{self._base_url}/rest/v1",
            headers={
                "apikey": self._key,
                "Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json",
            },
            timeout=self._timeout,
            transport=self._transport,
        )

    def write(self, minutes: MeetingMinutes, transcript: Transcript, *, model: str) -> str:
        import httpx

        meeting_row = self._build_meeting_row(minutes, transcript, model)
        logger.info("Notulen opslaan in Supabase ...")
        try:
            with self._client() as client:
                meeting_id = self._insert_meeting(client, meeting_row)
                self._insert_action_items(client, meeting_id, minutes)
        except OutputError:
            raise
        except httpx.HTTPError as exc:
            raise OutputError(f"Kon Supabase niet bereiken: {exc}") from exc

        destination = f"supabase:{MEETINGS_TABLE}/{meeting_id}"
        logger.info("Notulen opgeslagen in Supabase (%s)", destination)
        return destination

    def _insert_meeting(self, client, row: dict) -> str:
        response = client.post(
            f"/{MEETINGS_TABLE}",
            json=row,
            headers={"Prefer": "return=representation"},
        )
        self._raise_for_status(response, MEETINGS_TABLE)
        data = response.json()
        if not data or "id" not in data[0]:
            raise OutputError("Supabase gaf geen id terug voor de nieuwe notulen-rij.")
        return data[0]["id"]

    def _insert_action_items(self, client, meeting_id: str, minutes: MeetingMinutes) -> None:
        if not minutes.action_items:
            return
        rows = [
            {
                "notulen_id": meeting_id,
                "volgorde": idx,
                "omschrijving": item.description,
                "eigenaar": item.owner,
                "deadline": item.deadline,
            }
            for idx, item in enumerate(minutes.action_items, start=1)
        ]
        response = client.post(f"/{ACTION_ITEMS_TABLE}", json=rows)
        self._raise_for_status(response, ACTION_ITEMS_TABLE)

    @staticmethod
    def _build_meeting_row(
        minutes: MeetingMinutes, transcript: Transcript, model: str
    ) -> dict:
        return {
            "titel": minutes.title,
            "datum": minutes.date,
            "doel": minutes.purpose,
            "deelnemers": minutes.participants,
            "kernpunten": minutes.key_points,
            "beslissingen": minutes.decisions,
            "open_punten": minutes.open_questions,
            "transcript": transcript.as_timestamped_text(),
            "taal": transcript.language,
            "duur_seconden": transcript.duration_seconds,
            "bronbestand": transcript.source_path.name if transcript.source_path else None,
            "model": model,
        }

    @staticmethod
    def _raise_for_status(response, table: str) -> None:
        if response.status_code >= 400:
            detail = response.text[:300]
            hint = ""
            if response.status_code == 404 or "does not exist" in detail:
                hint = (
                    " Bestaat de tabel al? Voer supabase/notulen_schema.sql uit "
                    "in de Supabase SQL-editor."
                )
            raise OutputError(
                f"Supabase-insert in '{table}' mislukt ({response.status_code}): {detail}{hint}"
            )
