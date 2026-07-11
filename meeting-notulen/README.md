# Meeting-notulen

Command-line tool die een audio-opname van een gesprek (bv. een leveranciersmeeting)
omzet naar gestructureerde notulen in markdown.

**Pipeline:**

```
audio (mp3/m4a/wav/...)
   │
   ▼  1. Transcriptie — lokaal via faster-whisper
transcript met tijdcodes
   │
   ▼  2. Samenvatting — Claude API (structured output)
gestructureerde notulen (datum, deelnemers, doel, kernpunten,
beslissingen, actiepunten met eigenaar & deadline, open punten)
   │
   ▼  3. Output — markdown-bestand
gesprek-notulen.md
```

## Installatie

Vereist Python 3.10+ en [ffmpeg](https://ffmpeg.org/) (nodig voor het decoderen van audio).

```bash
cd meeting-notulen
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env   # en vul je ANTHROPIC_API_KEY in
```

Bij de eerste run downloadt faster-whisper automatisch het gekozen Whisper-model
(default `small`, ±500 MB) naar `~/.cache/huggingface`.

## Gebruik

```bash
python notulen.py gesprek.mp3
```

Het resultaat komt standaard naast de audio te staan als `gesprek-notulen.md`.

Handige opties:

```bash
python notulen.py gesprek.mp3 -o notulen/leverancier-q3.md   # eigen outputpad
python notulen.py gesprek.mp3 -l nl                          # taal forceren (default: autodetectie)
python notulen.py gesprek.mp3 -c "leveranciersmeeting met Acme over Q3-levering"
python notulen.py gesprek.mp3 --whisper-model medium         # nauwkeuriger, trager
python notulen.py gesprek.mp3 --print                        # notulen ook op stdout
python notulen.py --help                                     # alle opties
```

`python -m notulen gesprek.mp3` werkt ook.

### Exit codes

| Code | Betekenis |
|------|-----------|
| 0 | Gelukt |
| 2 | Probleem met het audiobestand |
| 3 | Transcriptie mislukt |
| 4 | Samenvatting (Claude API) mislukt |
| 5 | Wegschrijven mislukt |
| 6 | Configuratiefout (bv. ontbrekende API key) |

## Configuratie

Alle instellingen kunnen via CLI-flags of omgevingsvariabelen (zie `.env.example`):

| Variabele | Default | Omschrijving |
|-----------|---------|--------------|
| `ANTHROPIC_API_KEY` | — | API key voor de Claude API (verplicht) |
| `NOTULEN_CLAUDE_MODEL` | `claude-opus-4-8` | Claude-model voor de samenvatting |
| `NOTULEN_WHISPER_MODEL` | `small` | Whisper-modelgrootte (`tiny`…`large-v3`) |
| `NOTULEN_WHISPER_DEVICE` | `auto` | `auto`, `cpu` of `cuda` |
| `NOTULEN_LANGUAGE` | autodetectie | Taalcode, bv. `nl` |
| `NOTULEN_OUTPUT_DIR` | map van de audio | Standaard outputmap |

**Tip voor Nederlandstalige meetings:** het `small`-model is prima voor duidelijke
opnames; gebruik `medium` of `large-v3` bij achtergrondlawaai of veel jargon.

## Architectuur

```
meeting-notulen/
├── notulen.py                    # entry point (thin wrapper)
└── notulen/
    ├── cli.py                    # argumenten, logging, exit codes
    ├── config.py                 # PipelineConfig (env + CLI)
    ├── pipeline.py               # NotulenPipeline: orkestreert de 3 stappen
    ├── models.py                 # Transcript, MeetingMinutes, ActionItem, ...
    ├── prompts.py                # systeemprompt + JSON-schema voor structured output
    ├── exceptions.py             # fouttypes per pipeline-stap
    ├── transcription/            # stap 1 — Transcriber ABC + faster-whisper backend
    ├── summarization/            # stap 2 — Summarizer ABC + Claude backend
    └── output/                   # stap 3 — OutputWriter ABC + markdown writer
```

Elke stap zit achter een abstracte interface met een factory-registry, zodat
latere fases er als extra backend in te pluggen zijn zonder de pipeline aan
te passen:

- **Diarization (wie zei wat):** een extra `Transcriber`-backend die
  sprekerlabels aan `TranscriptSegment` toevoegt (bv. whisper.cpp of
  pyannote + faster-whisper).
- **Supabase-opslag:** een extra `OutputWriter` die de gestructureerde
  `MeetingMinutes` (het JSON-tussenformaat) naar een database schrijft.
- **Andere modellen:** een extra `Summarizer`-backend, of alleen
  `NOTULEN_CLAUDE_MODEL` aanpassen.

De samenvatting gebruikt **structured outputs** van de Claude API: het antwoord
is gegarandeerd geldige JSON volgens het schema in `prompts.py`, waarna de
markdown deterministisch gerenderd wordt. Het transcript gaat met tijdcodes mee
in één streaming request (het 1M-context window van het model is ruim voldoende
voor meerdere uren gesprek).

## Tests

De unit tests draaien zonder externe dependencies (Whisper en de Claude API
worden gestubd):

```bash
python -m unittest discover -s tests -v
```
