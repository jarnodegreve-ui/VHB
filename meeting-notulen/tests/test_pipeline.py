import tempfile
import unittest
from pathlib import Path

from notulen.config import PipelineConfig
from notulen.exceptions import ConfigurationError
from notulen.models import ActionItem, MeetingMinutes, Transcript, TranscriptSegment
from notulen.pipeline import NotulenPipeline
from notulen.summarization.base import Summarizer
from notulen.transcription.base import Transcriber


class StubTranscriber(Transcriber):
    def transcribe(self, audio_path: Path) -> Transcript:
        return Transcript(
            segments=[TranscriptSegment(0.0, 5.0, "Welkom bij de meeting.")],
            language="nl",
            duration_seconds=5.0,
            source_path=audio_path,
        )


class StubSummarizer(Summarizer):
    model = "stub-model"

    def summarize(self, transcript: Transcript) -> MeetingMinutes:
        return MeetingMinutes(
            title="Teststandup",
            date="2026-07-11",
            participants=["Jan"],
            purpose="Testen",
            key_points=["Alles werkt"],
            decisions=[],
            action_items=[ActionItem("Niets doen")],
        )


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmp.name)
        self.audio = self.tmpdir / "gesprek.mp3"
        self.audio.write_bytes(b"fake-audio")

    def tearDown(self):
        self._tmp.cleanup()

    def test_end_to_end_with_stubs(self):
        config = PipelineConfig(audio_path=self.audio)
        result = NotulenPipeline(
            config, transcriber=StubTranscriber(), summarizer=StubSummarizer()
        ).run()

        self.assertEqual(result.output_path, self.tmpdir / "gesprek-notulen.md")
        self.assertTrue(result.output_path.exists())
        content = result.output_path.read_text(encoding="utf-8")
        self.assertIn("# Teststandup", content)
        self.assertIn("model: stub-model", content)

    def test_explicit_output_path_wins(self):
        target = self.tmpdir / "sub" / "eigen-naam.md"
        config = PipelineConfig(audio_path=self.audio, output_path=target)
        result = NotulenPipeline(
            config, transcriber=StubTranscriber(), summarizer=StubSummarizer()
        ).run()
        self.assertEqual(result.output_path, target)
        self.assertTrue(target.exists())

    def test_missing_audio_raises_configuration_error(self):
        config = PipelineConfig(audio_path=self.tmpdir / "bestaat-niet.mp3")
        with self.assertRaises(ConfigurationError):
            NotulenPipeline(
                config, transcriber=StubTranscriber(), summarizer=StubSummarizer()
            ).run()

    def test_unsupported_extension_raises_configuration_error(self):
        bad = self.tmpdir / "notities.txt"
        bad.write_text("geen audio")
        config = PipelineConfig(audio_path=bad)
        with self.assertRaises(ConfigurationError):
            NotulenPipeline(
                config, transcriber=StubTranscriber(), summarizer=StubSummarizer()
            ).run()


if __name__ == "__main__":
    unittest.main()
