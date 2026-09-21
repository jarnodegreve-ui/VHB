import { verlofDagen } from "../../../shared/verlofSaldo.js";
import { bezettingPerDag } from "../../../shared/verlofbezettingPerDag.js";
import { KEUZE_ALLE, VERLOF_TYPE_LABEL, verlofStatusLabel, verlofTypeKolom, verlofTypeLabel } from "../../../shared/rapporten/definities/verlof.js";
import { rapportVan } from "../../../shared/rapporten/register.js";
import type { RapportBereik, RapportFilters, RapportKolom, RapportResultaat, RapportRij } from "../../../shared/rapporten/types.js";
import { MAAND_NAMEN, dagVanTijdstip, persoonZoeker, weekdagKort, type RapportGebruiker, type VerlofRij } from "./gedeeld.js";

/**
 * De verlofrapporten naast Verlofsaldo. Pure functies (bron + filters → rijen
 * + bereik). Ziekmeldingen staan in dezelfde tabel maar horen hier nergens
 * bij. Verlofdagen tellen zoals overal in het portaal (`verlofDagen` uit
 * shared/verlofSaldo.ts): maandag tot en met zaterdag, geen zondag, geen
 * wettelijke feestdag en geen extra vrije dag van de beheerder.
 */

const isVerlof = (l: VerlofRij): boolean => l.type !== "ziekte" && Boolean(l.startDate) && Boolean(l.endDate);

/** Eerste en laatste dag waarvoor er (volgens `telt`) verlof geregistreerd staat. */
const bereikVan = (leave: readonly VerlofRij[], telt: (l: VerlofRij) => boolean): RapportBereik => {
  let van: string | null = null;
  let tot: string | null = null;
  for (const l of leave) {
    if (!isVerlof(l) || !telt(l)) continue;
    if (van === null || l.startDate < van) van = l.startDate;
    if (tot === null || l.endDate > tot) tot = l.endDate;
  }
  return van !== null && tot !== null ? { van, tot } : null;
};

// === Verlofaanvragen ===

export type VerlofaanvragenBron = {
  users: readonly RapportGebruiker[];
  leave: readonly VerlofRij[];
  /** Extra vrije dagen van de beheerder (ISO), bovenop de wettelijke feestdagen. */
  extraFeestdagen: ReadonlySet<string>;
};

/**
 * Rapport "Verlofaanvragen": elke aanvraag waarvan de verlofdatums de periode
 * raken (overlap telt, een aanvraag over de periodegrens staat er dus in).
 * "Dagen" = de verlofdagen van de hele aanvraag, het getal dat de planner bij
 * het beoordelen ziet, niet afgekapt op de periode.
 */
export function bouwVerlofaanvragen(bron: VerlofaanvragenBron, filters: RapportFilters): RapportResultaat {
  const van = filters.van ?? "";
  const tot = filters.tot ?? "";
  const type = filters.keuzes.type ?? KEUZE_ALLE;
  const status = filters.keuzes.status ?? KEUZE_ALLE;
  const persoon = persoonZoeker(bron.users);
  const rijen: RapportRij[] = bron.leave
    .filter((l) => isVerlof(l) && l.startDate <= tot && l.endDate >= van)
    .filter((l) => !filters.chauffeur || String(l.userId) === filters.chauffeur)
    .filter((l) => type === KEUZE_ALLE || l.type === type)
    .filter((l) => status === KEUZE_ALLE || l.status === status)
    .map((l) => ({
      id: l.id,
      naam: persoon(l.userId).naam,
      type: verlofTypeLabel(l.type),
      van: l.startDate,
      tot: l.endDate,
      dagen: verlofDagen(l.startDate, l.endDate, bron.extraFeestdagen),
      status: verlofStatusLabel(l.status),
      aangevraagdOp: dagVanTijdstip(l.createdAt),
      // Een aanvraag in behandeling is nog niet beslist, wat er ook in de kolom staat.
      beslistOp: l.status === "pending" ? null : dagVanTijdstip(l.decidedAt),
      opmerking: l.comment?.trim() || null,
    }));
  return { rijen, bereik: bereikVan(bron.leave, () => true) };
}

// === Verlofbezetting per dag ===

export type VerlofbezettingBron = {
  users: readonly RapportGebruiker[];
  leave: readonly VerlofRij[];
  /** De verloflimiet van een dag (`limietVoorDag` met de limieten uit de instellingen). */
  limietVoor: (dagIso: string) => number;
};

/**
 * Rapport "Verlofbezetting per dag": de telling van GET /api/leave/bezetting
 * en van de verlofkalender (`bezettingPerDag`), met de namen erbij. "Afwezig"
 * telt wie in de verloflimiet telt: een flexi of een technieker met verlof
 * staat wel bij de namen, met de reden erbij, maar maakt de dag niet voller.
 */
export function bouwVerlofbezetting(bron: VerlofbezettingBron, filters: RapportFilters): RapportResultaat {
  const persoon = persoonZoeker(bron.users);
  const opNaam = (a: string, b: string) => a.localeCompare(b, "nl", { sensitivity: "base" });
  const alleenBoven = Boolean(filters.vinkjes?.bovenLimiet);
  const rijen: RapportRij[] = bezettingPerDag({ leave: bron.leave, users: bron.users, van: filters.van ?? "", tot: filters.tot ?? "", limietVoor: bron.limietVoor })
    .filter((d) => !alleenBoven || d.aantal > d.limiet)
    .map((d) => {
      const tellend = d.tellend.map((id) => persoon(id).naam).sort(opNaam);
      const nietTellend = d.nietTellend.map((id) => {
        const p = persoon(id);
        return `${p.naam} (${p.gebruiker?.role === "chauffeur" ? "flexi" : p.gebruiker?.role ?? "telt niet mee"}, telt niet mee)`;
      }).sort(opNaam);
      return {
        id: d.datum,
        datum: d.datum,
        dag: weekdagKort(d.datum),
        afwezig: d.aantal,
        limiet: d.limiet,
        bovenLimiet: d.aantal > d.limiet,
        namen: [...tellend, ...nietTellend].join(", ") || null,
      };
    });
  return { rijen, bereik: bereikVan(bron.leave, (l) => l.status === "approved") };
}

// === Verlof per type per maand ===

export type VerlofPerTypeBron = {
  leave: readonly VerlofRij[];
  extraFeestdagen: ReadonlySet<string>;
};

const twee = (n: number): string => String(n).padStart(2, "0");
const laatsteDagVan = (jaar: number, maand: number): string => `${jaar}-${twee(maand)}-${twee(new Date(Date.UTC(jaar, maand, 0)).getUTCDate())}`;

/**
 * Rapport "Verlof per type per maand": goedgekeurde verlofdagen van één jaar.
 * Een aanvraag over een maandgrens telt in elke maand haar eigen dagen, dus de
 * som van de maanden is het jaartotaal (en voor betaald verlof hetzelfde getal
 * als "Opgenomen" in Verlofsaldo). Eén kolom per verloftype dat in het jaar
 * voorkomt: de types die het portaal kent in hun vaste volgorde, een onbekend
 * (ouder) type erachter.
 */
export function bouwVerlofPerType(bron: VerlofPerTypeBron, filters: RapportFilters): RapportResultaat {
  const jaar = filters.jaar ?? new Date().getUTCFullYear();
  const goedgekeurd = bron.leave.filter((l) => isVerlof(l) && l.status === "approved");
  const inJaar = goedgekeurd.filter((l) => l.startDate <= `${jaar}-12-31` && l.endDate >= `${jaar}-01-01`);

  const bekend = Object.keys(VERLOF_TYPE_LABEL);
  const voorkomend = new Set(inJaar.map((l) => l.type));
  const types = [...bekend.filter((t) => voorkomend.has(t)), ...[...voorkomend].filter((t) => !bekend.includes(t)).sort()];

  const rijen: RapportRij[] = MAAND_NAMEN.map((naam, i) => {
    const eerste = `${jaar}-${twee(i + 1)}-01`;
    const laatste = laatsteDagVan(jaar, i + 1);
    const rij: RapportRij = { id: eerste.slice(0, 7), maand: naam, maandSleutel: eerste.slice(0, 7) };
    let totaal = 0;
    for (const type of types) {
      const dagen = inJaar
        .filter((l) => l.type === type && l.startDate <= laatste && l.endDate >= eerste)
        .reduce((som, l) => som + verlofDagen(l.startDate < eerste ? eerste : l.startDate, l.endDate > laatste ? laatste : l.endDate, bron.extraFeestdagen), 0);
      rij[verlofTypeKolom(type).id] = dagen;
      totaal += dagen;
    }
    rij.totaal = totaal;
    return rij;
  });

  // De vaste kolommen uit de definitie (maand vooraan, totaal achteraan) met de types ertussen.
  const vast = rapportVan("verlof-per-type")?.kolommen ?? [];
  const kolommen: RapportKolom[] = [...vast.filter((k) => k.id !== "totaal"), ...types.map(verlofTypeKolom), ...vast.filter((k) => k.id === "totaal")];
  return { rijen, kolommen, bereik: bereikVan(bron.leave, (l) => l.status === "approved") };
}
