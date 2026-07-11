import unittest
from pathlib import Path

from notulen.models import MeetingMinutes, Transcript, TranscriptSegment


class TranscriptSegmentTests(unittest.TestCase):
    def test_timestamp_under_an_hour(self):
        seg = TranscriptSegment(start=65.4, end=70.0, text="hallo")
        self.assertEqual(seg.timestamp, "01:05")

    def test_timestamp_over_an_hour(self):
        seg = TranscriptSegment(start=3725.0, end=3730.0, text="hallo")
        self.assertEqual(seg.timestamp, "01:02:05")


class TranscriptTests(unittest.TestCase):
    def test_timestamped_text_skips_empty_segments(self):
        transcript = Transcript(
            segments=[
                TranscriptSegment(0.0, 2.0, " Welkom allemaal. "),
                TranscriptSegment(2.0, 3.0, "   "),
                TranscriptSegment(3.0, 6.0, "Laten we beginnen."),
            ]
        )
        self.assertEqual(
            transcript.as_timestamped_text(),
            "[00:00] Welkom allemaal.\n[00:03] Laten we beginnen.",
        )


class MeetingMinutesTests(unittest.TestCase):
    def test_from_dict_full(self):
        minutes = MeetingMinutes.from_dict(
            {
                "titel": "Q3-levering Acme",
                "datum": "2026-07-10",
                "deelnemers": ["Jan (inkoop)", "Piet (Acme)"],
                "doel": "Leverafspraken Q3 vastleggen",
                "kernpunten": ["Levertijd is 6 weken"],
                "beslissingen": ["Order wordt gesplitst in twee leveringen"],
                "actiepunten": [
                    {"omschrijving": "Offerte sturen", "eigenaar": "Piet", "deadline": "vrijdag"},
                    {"omschrijving": "Intern afstemmen", "eigenaar": None, "deadline": None},
                ],
                "open_punten": ["Prijsindexatie 2027"],
            }
        )
        self.assertEqual(minutes.title, "Q3-levering Acme")
        self.assertEqual(len(minutes.action_items), 2)
        self.assertEqual(minutes.action_items[0].owner, "Piet")
        self.assertIsNone(minutes.action_items[1].deadline)

    def test_from_dict_handles_missing_and_null_fields(self):
        minutes = MeetingMinutes.from_dict({"titel": None, "datum": None})
        self.assertEqual(minutes.title, "Meeting-notulen")
        self.assertEqual(minutes.participants, [])
        self.assertEqual(minutes.action_items, [])

    def test_from_dict_skips_action_items_without_description(self):
        minutes = MeetingMinutes.from_dict(
            {"titel": "x", "actiepunten": [{"omschrijving": "", "eigenaar": "Jan"}]}
        )
        self.assertEqual(minutes.action_items, [])


if __name__ == "__main__":
    unittest.main()
