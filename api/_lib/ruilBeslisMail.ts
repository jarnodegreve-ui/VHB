/**
 * De mail aan de twee chauffeurs van een dienstruil zodra de planning beslist
 * (27-11, vraag Jarno: "enkel en alleen wanneer de planning beslist, naar de
 * aanvrager en de collega"). Soort `ruil-beslissing`, uit te zetten in
 * Beheer › Mails.
 *
 * Eén kern voor de twee wegen waarlangs een ruil beslist wordt
 * (`beslisRuilIntern` achter PATCH en de lijstroute POST /api/swaps): beide
 * roepen `mailRuilBeslissing` per stap aan, naast de pushmelding, met dezelfde
 * gegevens. Wie een mail krijgt en met welke zin volgt uit dezelfde bronnen
 * als de push: de ontvangers zijn de aanvrager en de collega behalve wie de
 * actie zelf deed, de zin is die van `ruilBeslisMelding` voor die ontvanger.
 *
 * Wanneer:
 * - alleen als een planner of admin de stap zette (`doorStaf`): de collega die
 *   accepteert of weigert en de aanvrager die intrekt geven geen mail;
 * - alleen bij een beslissing: goedgekeurd, afgewezen of geannuleerd. Was de
 *   ruil al goedgekeurd, dan heet dat laatste "teruggedraaid". De afhandeling
 *   (`completed`) is boekhouding van de planning en gaat stil, zoals de push;
 * - niet voor een handmatige wissel van de planning: daar vroeg geen chauffeur
 *   iets aan, de push "dienst toegewezen" blijft daar de melding.
 *
 * De mail komt ná de beslissing en houdt ze nooit tegen: een fout wordt
 * gelogd, niet doorgegeven.
 *
 * Eén bewust verschil met de push: de lijstroute neemt de ontvangers van de
 * push uit het record van vóór de save, de mail neemt ze uit het record dat
 * geschreven en doorgevoerd is (hetzelfde als waar de tekst op gebouwd is).
 * Zet een admin in dezelfde save een andere collega, dan gaat de mail naar
 * wie nu in de ruil staat, want de feiten in de mail noemen die collega. De
 * app zelf beslist via PATCH, waar dat verschil niet bestaat.
 */
import { sendEmail } from "./email.js";
import { DAG_DMJ, isHandmatigeWissel, normalizeSwapType } from "./helpers.js";
import { bouwRuilBeslissingMail, type RuilUitkomst } from "./mailTeksten.js";
import { recordUrl } from "./meldingen.js";
import { ruilBeslisMelding, type RuilNamen, type RuilPlanningStand } from "./meldingTeksten.js";
import { getShiftById } from "./storage.js";

type RuilRecord = Record<string, any>;

/** Dienst en tegenprestatie zoals een ruilmail ze noemt: één bron voor de
 *  mail bij de aanvraag (admins) en de mail bij de beslissing (chauffeurs).
 *  Datum en dienstnummer staan op het record sinds de shift_info-migratie;
 *  voor een ouder record de planningrij zelf. */
export const ruilMailFeiten = async (ruil: RuilRecord): Promise<{ dienst: string; tegenprestatie: string; overname: boolean }> => {
  const overname = normalizeSwapType(ruil.swapType) === "overname";
  const shift = ruil.shiftDate && ruil.shiftLine ? null : await getShiftById(String(ruil.shiftId ?? ""));
  const dienstDatum = String(ruil.shiftDate ?? shift?.date ?? "");
  const dienstNummer = String(ruil.shiftLine ?? shift?.line ?? "").trim() || "?";
  const terugCode = String(ruil.returnCode ?? "").trim();
  const tegenprestatie = overname
    ? "Geen (overname)"
    : !terugCode || terugCode.toLowerCase() === "vrij"
      ? "Vrije dag"
      : `dienst ${terugCode}${ruil.returnDate ? ` op ${DAG_DMJ(String(ruil.returnDate))}` : ""}`;
  return {
    dienst: `dienst ${dienstNummer}${dienstDatum ? ` op ${DAG_DMJ(dienstDatum)}` : ""}`,
    tegenprestatie,
    overname,
  };
};

/** Welke uitkomst meldt de mail voor deze stap? Null = geen mail. */
export const ruilUitkomstVoorMail = (van: string, naar: string, doorStaf: boolean): RuilUitkomst | null => {
  // Een PATCH van staf met dezelfde status schrijft opnieuw (bewust ongewijzigd
  // in de routes) en stuurt de push nog eens; een mail blijft liggen, dus die
  // gaat alleen bij een echte overgang (tegenlezing 27-11).
  if (!doorStaf || van === naar) return null;
  if (naar === "approved") return "goedgekeurd";
  if (naar !== "rejected" && naar !== "cancelled") return null;
  if (van === "approved") return "teruggedraaid";
  return naar === "rejected" ? "afgewezen" : "geannuleerd";
};

type Gebruiker = { id: unknown; name?: unknown; email?: unknown; isActive?: unknown };

export const mailRuilBeslissing = async (o: {
  /** Het record waarop ook de tekst van de push gebouwd is. */
  ruil: RuilRecord;
  namen: RuilNamen;
  van: string;
  naar: string;
  doorStaf: boolean;
  planning: RuilPlanningStand | null;
  /** Wie de stap zette: krijgt zelf geen mail, zoals bij de push. */
  actorId: string;
  /** Naam van wie besliste, voor het verzendlog. */
  door: string;
  users: readonly Gebruiker[];
}): Promise<void> => {
  try {
    const uitkomst = ruilUitkomstVoorMail(o.van, o.naar, o.doorStaf);
    if (!uitkomst || isHandmatigeWissel(o.ruil)) return;
    const ids = [...new Set([String(o.ruil.requesterId ?? ""), String(o.ruil.targetDriverId ?? "")])]
      .filter((id) => id && id !== o.actorId);
    const ontvangers = ids
      .map((id) => o.users.find((u) => String(u.id) === id))
      .filter((u): u is Gebruiker => !!u && u.isActive !== false && typeof u.email === "string" && u.email.trim() !== "");
    if (ontvangers.length === 0) return;

    const feiten = await ruilMailFeiten(o.ruil);
    const naam = (id: unknown, anders: string) => {
      const n = o.users.find((u) => String(u.id) === String(id ?? ""))?.name;
      return typeof n === "string" && n.trim() ? n : anders;
    };
    const aanvrager = naam(o.ruil.requesterId, "Onbekende aanvrager");
    const collega = o.ruil.targetDriverId ? naam(o.ruil.targetDriverId, "Onbekende collega") : null;
    const doelPad = recordUrl("ruil-verzoeken", o.ruil.id);

    // Elk zijn eigen mail met zijn eigen zin; ze vertrekken samen, zodat een
    // trage verzending die van de andere chauffeur niet ophoudt.
    await Promise.all(ontvangers.map(async (u) => {
      const zin = ruilBeslisMelding({ ruil: o.ruil, namen: o.namen, van: o.van, naar: o.naar, doorStaf: o.doorStaf, planning: o.planning }, u.id).body;
      const { onderwerp, html, text } = bouwRuilBeslissingMail({
        uitkomst,
        ontvanger: naam(u.id, "collega"),
        zin,
        aanvrager,
        collega,
        ...feiten,
        doelPad,
      });
      await sendEmail({ to: [String(u.email).trim()], context: `swap:${o.ruil.id}`, soort: "ruil-beslissing", door: o.door, subject: onderwerp, text, html });
    }));
  } catch (err) {
    console.error("Mail over de beslissing van een dienstruil versturen mislukt.", (err as { message?: unknown })?.message ?? err);
  }
};
