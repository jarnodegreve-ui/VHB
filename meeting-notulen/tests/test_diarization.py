import unittest

from notulen.models import Transcript, TranscriptSegment
from notulen.transcription.diarization import SpeakerTurn, assign_speakers


class AssignSpeakersTests(unittest.TestCase):
    def test_assigns_speaker_with_largest_overlap(self):
        segments = [TranscriptSegment(0.0, 4.0, "Goedemorgen allemaal.")]
        turns = [
            SpeakerTurn(0.0, 1.0, "SPEAKER_01"),
            SpeakerTurn(1.0, 4.0, "SPEAKER_00"),
        ]
        result = assign_speakers(segments, turns)
        # SPEAKER_01 spreekt eerst -> SPREKER_1; SPEAKER_00 heeft meer overlap (3s vs 1s)
        self.assertEqual(result[0].speaker, "SPREKER_2")

    def test_relabels_in_order_of_first_appearance(self):
        segments = [
            TranscriptSegment(0.0, 2.0, "Hallo."),
            TranscriptSegment(2.0, 4.0, "Hoi."),
        ]
        turns = [
            SpeakerTurn(0.0, 2.0, "SPEAKER_07"),
            SpeakerTurn(2.0, 4.0, "SPEAKER_02"),
        ]
        result = assign_speakers(segments, turns)
        self.assertEqual(result[0].speaker, "SPREKER_1")
        self.assertEqual(result[1].speaker, "SPREKER_2")

    def test_segment_without_overlap_keeps_none(self):
        segments = [TranscriptSegment(10.0, 12.0, "Losse opmerking.")]
        turns = [SpeakerTurn(0.0, 5.0, "SPEAKER_00")]
        result = assign_speakers(segments, turns)
        self.assertIsNone(result[0].speaker)

    def test_fragmented_turns_of_same_speaker_are_summed(self):
        segments = [TranscriptSegment(0.0, 6.0, "Lang verhaal.")]
        turns = [
            # A spreekt in totaal 3s binnen het segment, B aaneengesloten 2.5s
            SpeakerTurn(0.0, 1.5, "A"),
            SpeakerTurn(2.0, 4.5, "B"),
            SpeakerTurn(4.5, 6.0, "A"),
        ]
        result = assign_speakers(segments, turns)
        self.assertEqual(result[0].speaker, "SPREKER_1")  # A: 3.0s > B: 2.5s


class TranscriptWithSpeakersTests(unittest.TestCase):
    def test_timestamped_text_includes_speaker_labels(self):
        transcript = Transcript(
            segments=[
                TranscriptSegment(0.0, 2.0, "Welkom.", speaker="SPREKER_1"),
                TranscriptSegment(2.0, 4.0, "Dank je.", speaker="SPREKER_2"),
                TranscriptSegment(4.0, 6.0, "Onverstaanbaar stuk."),
            ]
        )
        self.assertTrue(transcript.has_speakers)
        self.assertEqual(
            transcript.as_timestamped_text(),
            "[00:00] SPREKER_1: Welkom.\n"
            "[00:02] SPREKER_2: Dank je.\n"
            "[00:04] Onverstaanbaar stuk.",
        )


if __name__ == "__main__":
    unittest.main()
