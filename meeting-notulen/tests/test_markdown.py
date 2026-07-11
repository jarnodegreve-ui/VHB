import unittest
from datetime import datetime
from pathlib import Path

from notulen.models import ActionItem, MeetingMinutes, Transcript, TranscriptSegment
from notulen.output.markdown import render_markdown


def _minutes(**overrides) -> MeetingMinutes:
    defaults = dict(
        title="Leveranciersmeeting Acme",
        date="2026-07-10",
        participants=["Jan", "Piet"],
        purpose="Q3-levering afstemmen",
        key_points=["Levertijd is 6 weken"],
        decisions=["Order in twee delen"],
        action_items=[ActionItem("Offerte sturen", owner="Piet", deadline="vrijdag")],
        open_questions=["Prijsindexatie"],
    )
    defaults.update(overrides)
    return MeetingMinutes(**defaults)


def _transcript() -> Transcript:
    return Transcript(
        segments=[TranscriptSegment(0.0, 5.0, "Welkom.")],
        language="nl",
        duration_seconds=1830.0,
        source_path=Path("gesprek.mp3"),
    )


class RenderMarkdownTests(unittest.TestCase):
    def test_contains_all_sections(self):
        md = render_markdown(
            _minutes(), _transcript(), model="claude-opus-4-8",
            generated_at=datetime(2026, 7, 11, 12, 0),
        )
        self.assertIn("# Leveranciersmeeting Acme", md)
        self.assertIn("**Datum:** 2026-07-10", md)
        self.assertIn("**Deelnemers:** Jan, Piet", md)
        self.assertIn("## Kernpunten", md)
        self.assertIn("## Beslissingen", md)
        self.assertIn("| 1 | Offerte sturen | Piet | vrijdag |", md)
        self.assertIn("## Open punten", md)
        self.assertIn("bron: gesprek.mp3", md)
        self.assertIn("duur opname: 30 min", md)

    def test_empty_sections_get_placeholders(self):
        md = render_markdown(
            _minutes(
                date=None, participants=[], purpose=None,
                key_points=[], decisions=[], action_items=[], open_questions=[],
            ),
            _transcript(),
            model="claude-opus-4-8",
        )
        self.assertIn("**Datum:** onbekend", md)
        self.assertIn("**Deelnemers:** onbekend", md)
        self.assertIn("_Geen kernpunten geïdentificeerd._", md)
        self.assertIn("_Geen expliciete beslissingen genomen._", md)
        self.assertIn("_Geen actiepunten geïdentificeerd._", md)
        self.assertNotIn("## Open punten", md)

    def test_pipe_in_action_item_is_escaped(self):
        md = render_markdown(
            _minutes(action_items=[ActionItem("a | b", owner=None, deadline=None)]),
            _transcript(),
            model="m",
        )
        self.assertIn("| 1 | a \\| b | — | — |", md)


if __name__ == "__main__":
    unittest.main()
