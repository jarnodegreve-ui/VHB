# Meeting-notulen

Command-line tool die een audio-opname van een gesprek (bv. een leveranciersmeeting)
omzet naar gestructureerde notulen in markdown, optioneel met sprekerlabels en
opslag in Supabase.

**Pipeline:**

```
audio (mp3/m4a/wav/...)
   │
   ▼  1. Transcriptie — lokaal via faster-whisper
   │     └─ optioneel: sprekerlabels via pyannote (--diarize)
transcript met tijdcodes (en sprekers)
   │
   ▼  2. Samenvatting — Claude API (structured output)
gestructureerde notulen (datum, deelnemers, doel, kernpunten,
beslissingen, actiepunten met eigenaar & deadline, open punten)
   │
   ▼  3. Output — markdown-bestand
   │     └─ optioneel: gestructureerde opslag in Supabase (--supabase)
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
python notulen.py gesprek.mp3 --diarize                      # sprekerlabels (zie hieronder)
python notulen.py gesprek.mp3 --supabase                     # ook opslaan in Supabase
python notulen.py gesprek.mp3 --print                        # notulen ook op stdout
python notulen.py --help                                     # alle opties
```

`python -m notulen gesprek.mp3` werkt ook.

### Sprekerlabels (`--diarize`)

Voegt automatische sprekerlabels (SPREKER_1, SPREKER_2, ...) toe aan het
transcript via [pyannote.audio](https://github.com/pyannote/pyannote-audio).
Claude koppelt die labels waar mogelijk aan echte namen uit het gesprek, wat
de toeschrijving van actiepunten en beslissingen een stuk betrouwbaarder maakt.

Eenmalige setup:

1. `pip install -r requirements-diarization.txt` (let op: trekt PyTorch binnen, ~2 GB)
2. Accepteer de modelvoorwaarden op
   [huggingface.co/pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
3. Zet `HUGGINGFACE_TOKEN=hf_...` in je `.env`

### Supabase-opslag (`--supabase`)

Slaat de notulen naast het markdown-bestand ook gestructureerd op in Supabase
(tabellen `notulen` en `notulen_actiepunten`, inclusief het volledige
transcript), zodat latere fases erop kunnen zoeken of er een frontend op
kunnen bouwen.

Eenmalige setup:

1. Voer [`supabase/notulen_schema.sql`](supabase/notulen_schema.sql) uit in de
   SQL-editor van je Supabase-project
2. Zet `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` in je `.env`

De tabellen hebben row level security aan zonder policies: alleen de
service-role key (server-side) kan erbij. Voeg zelf policies toe zodra een
frontend leesrechten nodig heeft.

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
| `HUGGINGFACE_TOKEN` | — | Token voor het (gated) diarization-model |
| `NOTULEN_DIARIZATION_MODEL` | `pyannote/speaker-diarization-3.1` | Diarization-model |
| `SUPABASE_URL` | — | Project-URL voor `--supabase` |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service-role key voor `--supabase` |

**Tip voor Nederlandstalige meetings:** het `small`-model is prima voor duidelijke
opnames; gebruik `medium` of `large-v3` bij achtergrondlawaai of veel jargon.

## Architectuur

```
meeting-notulen/
├── notulen.py                    # entry point (thin wrapper)
├── supabase/
│   └── notulen_schema.sql        # tabellen voor --supabase (eenmalig uitvoeren)
└── notulen/
    ├── cli.py                    # argumenten, logging, exit codes
    ├── config.py                 # PipelineConfig (env + CLI)
    ├── pipeline.py               # NotulenPipeline: orkestreert de 3 stappen
    ├── models.py                 # Transcript, MeetingMinutes, ActionItem, ...
    ├── prompts.py                # systeemprompt + JSON-schema voor structured output
    ├── exceptions.py             # fouttypes per pipeline-stap
    ├── transcription/            # stap 1 — Transcriber ABC
    │   ├── faster_whisper.py     #   basis-backend (lokaal Whisper)
    │   └── diarization.py        #   pyannote-laag om een basis-transcriber heen
    ├── summarization/            # stap 2 — Summarizer ABC + Claude backend
    └── output/                   # stap 3 — OutputWriter ABC
        ├── markdown.py           #   primaire output: .md-bestand
        └── supabase.py           #   optioneel: PostgREST-inserts in Supabase
```

Elke stap zit achter een abstracte interface met een factory, zodat nieuwe
backends in te pluggen zijn zonder de pipeline aan te passen. Diarization is
een decorator om de basis-transcriber heen; output is een lijst writers
(markdown altijd, Supabase optioneel). Een andere samenvattings-backend
toevoegen kan via `SUMMARIZER_FACTORIES`, of pas gewoon
`NOTULEN_CLAUDE_MODEL` aan.

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
