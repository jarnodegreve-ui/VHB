"""Prompt en output-schema voor de samenvattings-stap."""

from __future__ import annotations

from typing import Optional

SYSTEM_PROMPT = """\
Je bent een ervaren notulist. Je krijgt het transcript van een zakelijk gesprek
(bijvoorbeeld een leveranciersmeeting) met tijdcodes, en je destilleert daar
gestructureerde notulen uit.

Richtlijnen:
- Schrijf in het Nederlands, zakelijk en beknopt.
- Baseer je uitsluitend op wat er in het transcript staat; verzin geen deelnemers,
  beslissingen of deadlines die niet genoemd worden.
- Neem alleen echte beslissingen op onder "beslissingen" — voorstellen of ideeën
  die nog open liggen horen bij kernpunten of open punten.
- Bij actiepunten: vul eigenaar en deadline alleen in als die expliciet of
  duidelijk impliciet in het gesprek genoemd worden; laat ze anders leeg (null).
- Als de datum van de meeting in het gesprek genoemd wordt, gebruik die.
  Anders mag je de bestandsdatum uit de context gebruiken, of null.
- Herken deelnemers aan hoe ze elkaar aanspreken of zichzelf voorstellen.
  Het transcript heeft geen sprekerlabels, dus wees voorzichtig met toeschrijvingen.
"""

# JSON-schema voor structured output. Nederlandstalige sleutels zodat het
# resultaat direct leesbaar is en 1-op-1 mapt op de markdown-output.
MINUTES_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "titel",
        "datum",
        "deelnemers",
        "doel",
        "kernpunten",
        "beslissingen",
        "actiepunten",
        "open_punten",
    ],
    "properties": {
        "titel": {
            "type": "string",
            "description": "Korte, beschrijvende titel voor de meeting.",
        },
        "datum": {
            "anyOf": [{"type": "string"}, {"type": "null"}],
            "description": "Datum van de meeting (bij voorkeur YYYY-MM-DD), of null.",
        },
        "deelnemers": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Namen (en evt. rol/organisatie) van de deelnemers.",
        },
        "doel": {
            "anyOf": [{"type": "string"}, {"type": "null"}],
            "description": "Doel van het gesprek in één of twee zinnen, of null.",
        },
        "kernpunten": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Belangrijkste besproken punten, in chronologische volgorde.",
        },
        "beslissingen": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Expliciet genomen beslissingen.",
        },
        "actiepunten": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["omschrijving", "eigenaar", "deadline"],
                "properties": {
                    "omschrijving": {"type": "string"},
                    "eigenaar": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "deadline": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                },
            },
        },
        "open_punten": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Onbesliste of doorgeschoven punten voor een volgend gesprek.",
        },
    },
}


def build_user_prompt(
    transcript_text: str,
    *,
    source_name: Optional[str] = None,
    file_date: Optional[str] = None,
    language: Optional[str] = None,
    meeting_context: Optional[str] = None,
) -> str:
    """Stel de gebruikersprompt samen: metadata-context gevolgd door het transcript."""
    context_lines = []
    if source_name:
        context_lines.append(f"- Bestandsnaam: {source_name}")
    if file_date:
        context_lines.append(f"- Bestandsdatum (indicatief, niet per se de meetingdatum): {file_date}")
    if language:
        context_lines.append(f"- Gedetecteerde taal van de opname: {language}")
    if meeting_context:
        context_lines.append(f"- Context van de gebruiker: {meeting_context}")

    parts = []
    if context_lines:
        parts.append("Context over de opname:\n" + "\n".join(context_lines))
    parts.append(
        "Hieronder het transcript met tijdcodes. "
        "Maak hier gestructureerde notulen van volgens het gevraagde formaat.\n\n"
        "<transcript>\n" + transcript_text + "\n</transcript>"
    )
    return "\n\n".join(parts)
