import json
import unittest
from pathlib import Path

import httpx

from notulen.exceptions import OutputError
from notulen.models import ActionItem, MeetingMinutes, Transcript, TranscriptSegment
from notulen.output.supabase import SupabaseWriter


def _minutes() -> MeetingMinutes:
    return MeetingMinutes(
        title="Leveranciersmeeting Acme",
        date="2026-07-10",
        participants=["Jan", "Piet"],
        purpose="Q3-levering afstemmen",
        key_points=["Levertijd is 6 weken"],
        decisions=["Order in twee delen"],
        action_items=[
            ActionItem("Offerte sturen", owner="Piet", deadline="vrijdag"),
            ActionItem("Intern afstemmen"),
        ],
        open_questions=["Prijsindexatie"],
    )


def _transcript() -> Transcript:
    return Transcript(
        segments=[TranscriptSegment(0.0, 5.0, "Welkom.", speaker="SPREKER_1")],
        language="nl",
        duration_seconds=1830.0,
        source_path=Path("gesprek.mp3"),
    )


class SupabaseWriterTests(unittest.TestCase):
    def test_inserts_meeting_and_action_items(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("/notulen"):
                return httpx.Response(201, json=[{"id": "uuid-123"}])
            if request.url.path.endswith("/notulen_actiepunten"):
                return httpx.Response(201, json=[])
            return httpx.Response(404)

        writer = SupabaseWriter(
            "https://demo.supabase.co",
            "service-key",
            transport=httpx.MockTransport(handler),
        )
        destination = writer.write(_minutes(), _transcript(), model="test-model")

        self.assertEqual(destination, "supabase:notulen/uuid-123")
        self.assertEqual(len(requests), 2)

        meeting_payload = json.loads(requests[0].content)
        self.assertEqual(meeting_payload["titel"], "Leveranciersmeeting Acme")
        self.assertEqual(meeting_payload["deelnemers"], ["Jan", "Piet"])
        self.assertIn("SPREKER_1: Welkom.", meeting_payload["transcript"])
        self.assertEqual(requests[0].headers["apikey"], "service-key")
        self.assertEqual(requests[0].headers["authorization"], "Bearer service-key")

        items_payload = json.loads(requests[1].content)
        self.assertEqual(len(items_payload), 2)
        self.assertEqual(items_payload[0]["notulen_id"], "uuid-123")
        self.assertEqual(items_payload[0]["volgorde"], 1)
        self.assertEqual(items_payload[0]["eigenaar"], "Piet")
        self.assertIsNone(items_payload[1]["eigenaar"])

    def test_no_action_items_means_single_request(self):
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(201, json=[{"id": "uuid-456"}])

        writer = SupabaseWriter(
            "https://demo.supabase.co",
            "service-key",
            transport=httpx.MockTransport(handler),
        )
        minutes = _minutes()
        minutes.action_items = []
        writer.write(minutes, _transcript(), model="test-model")
        self.assertEqual(len(requests), 1)

    def test_http_error_becomes_output_error_with_schema_hint(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, text='relation "public.notulen" does not exist')

        writer = SupabaseWriter(
            "https://demo.supabase.co",
            "service-key",
            transport=httpx.MockTransport(handler),
        )
        with self.assertRaises(OutputError) as ctx:
            writer.write(_minutes(), _transcript(), model="test-model")
        self.assertIn("notulen_schema.sql", str(ctx.exception))

    def test_connection_error_becomes_output_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("dns failure")

        writer = SupabaseWriter(
            "https://demo.supabase.co",
            "service-key",
            transport=httpx.MockTransport(handler),
        )
        with self.assertRaises(OutputError):
            writer.write(_minutes(), _transcript(), model="test-model")


if __name__ == "__main__":
    unittest.main()
