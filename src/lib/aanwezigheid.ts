import { isoDate } from './datum';

/**
 * Aanwezigheid: van sessies naar een tijdbalk per persoon per dag.
 *
 * De server levert aaneengesloten sessies ("Jesus Mendez had het portaal open
 * van 06:05 tot 06:40"). Een sessie kan over middernacht heen lopen, en het
 * scherm toont één dag tegelijk, dus knippen we hier op de lokale dagrand.
 * Lokaal is Belgisch: het portaal wordt in België gebruikt en de server stuurt
 * ISO-tijdstippen met zone, dus `new Date(...)` levert vanzelf de juiste
 * plaatselijke tijd.
 */

export type AanwezigheidSessie = {
  userId: string;
  naam: string;
  rol: string;
  /** ISO-tijdstip waarop de sessie begon. */
  van: string;
  /** ISO-tijdstip van het laatste teken van leven. */
  tot: string;
};

/** Eén blok op de tijdbalk: minuten sinds middernacht, binnen één dag. */
export type Periode = { vanMin: number; totMin: number; vanIso: string; totIso: string };

export type DagBalk = { userId: string; naam: string; rol: string; periodes: Periode[]; totaalMin: number };

const MIN_PER_DAG = 24 * 60;

const minutenInDag = (d: Date) => d.getHours() * 60 + d.getMinutes();
const middernachtNa = (d: Date) => {
  const uit = new Date(d);
  uit.setHours(0, 0, 0, 0);
  uit.setDate(uit.getDate() + 1);
  return uit;
};

/**
 * Sessies knippen op de dagrand. Levert per kalenderdag de stukken die op die
 * dag vallen. Een sessie van 23:40 tot 00:20 wordt dus twee stukken.
 *
 * Ongeldige invoer (onparseerbare datum, eind vóór begin) valt stil weg: dit
 * voedt een overzicht, geen boekhouding, en één rare rij mag het scherm niet
 * laten ontploffen.
 */
export const knipPerDag = (sessies: AanwezigheidSessie[]): Map<string, Array<AanwezigheidSessie & Periode>> => {
  const perDag = new Map<string, Array<AanwezigheidSessie & Periode>>();
  for (const s of sessies) {
    const begin = new Date(s.van);
    const eind = new Date(s.tot);
    if (Number.isNaN(begin.getTime()) || Number.isNaN(eind.getTime())) continue;
    if (eind.getTime() < begin.getTime()) continue;
    let cursor = begin;
    // Harde bovengrens: een sessie hoort nooit over meer dan een handvol
    // dagen te lopen, maar een kapotte rij mag geen oneindige lus worden.
    for (let stap = 0; stap < 40; stap += 1) {
      const dagGrens = middernachtNa(cursor);
      const stukEind = eind.getTime() < dagGrens.getTime() ? eind : dagGrens;
      const dag = isoDate(cursor);
      const vanMin = minutenInDag(cursor);
      // Loopt het stuk tot de dagrand, dan is dat 24:00 en niet 00:00.
      const totMin = stukEind.getTime() === dagGrens.getTime() ? MIN_PER_DAG : minutenInDag(stukEind);
      const lijst = perDag.get(dag) ?? [];
      lijst.push({ ...s, vanMin, totMin, vanIso: cursor.toISOString(), totIso: stukEind.toISOString() });
      perDag.set(dag, lijst);
      if (stukEind.getTime() >= eind.getTime()) break;
      cursor = dagGrens;
    }
  }
  return perDag;
};

/**
 * De tijdbalken van één dag: per persoon zijn periodes, langst aanwezig
 * bovenaan zodat wie er het meest was ook het eerst opvalt. Bij gelijke duur
 * alfabetisch, zodat de volgorde niet danst tussen verversingen.
 */
export const balkenVoorDag = (sessies: AanwezigheidSessie[], dag: string): DagBalk[] => {
  const stukken = knipPerDag(sessies).get(dag) ?? [];
  const per = new Map<string, DagBalk>();
  for (const s of stukken) {
    const balk = per.get(s.userId) ?? { userId: s.userId, naam: s.naam, rol: s.rol, periodes: [], totaalMin: 0 };
    balk.periodes.push({ vanMin: s.vanMin, totMin: s.totMin, vanIso: s.vanIso, totIso: s.totIso });
    per.set(s.userId, balk);
  }
  for (const balk of per.values()) {
    balk.periodes = voegSamen(balk.periodes);
    balk.totaalMin = balk.periodes.reduce((som, p) => som + Math.max(1, p.totMin - p.vanMin), 0);
  }
  return [...per.values()].sort((a, b) => b.totaalMin - a.totaalMin || a.naam.localeCompare(b.naam, 'nl'));
};

/**
 * Overlappende of aansluitende periodes samensmelten.
 *
 * Twee toestellen tegelijk (telefoon én bureau), of twee serverless-instanties
 * die bijna gelijktijdig een sessie openen, leveren overlappende rijen voor
 * dezelfde persoon. Ongesmolten zou dat een gestreepte balk geven én een
 * dubbeltelling in "totaal aanwezig". Aansluitende blokken gaan ook samen: een
 * sessie die om 00:00 op de dagrand werd geknipt hoort visueel één geheel te
 * blijven met wat er direct op volgt.
 */
export const voegSamen = (periodes: Periode[]): Periode[] => {
  const op = [...periodes].sort((a, b) => a.vanMin - b.vanMin || a.totMin - b.totMin);
  const uit: Periode[] = [];
  for (const p of op) {
    const vorige = uit[uit.length - 1];
    if (vorige && p.vanMin <= vorige.totMin) {
      if (p.totMin > vorige.totMin) {
        vorige.totMin = p.totMin;
        vorige.totIso = p.totIso;
      }
      continue;
    }
    uit.push({ ...p });
  }
  return uit;
};

/** Aantal verschillende personen dat op die dag actief was. */
export const telPerDag = (sessies: AanwezigheidSessie[]): Map<string, number> => {
  const uit = new Map<string, Set<string>>();
  for (const [dag, stukken] of knipPerDag(sessies)) {
    uit.set(dag, new Set(stukken.map((s) => s.userId)));
  }
  return new Map([...uit].map(([dag, set]) => [dag, set.size]));
};

/**
 * Wie is er nu. Een sessie geldt als lopend zolang het laatste teken van
 * leven binnen `vensterMs` ligt: de app meldt zich hoogstens elke 5 minuten,
 * dus met een venster van 10 minuten valt niemand ten onrechte af omdat zijn
 * hartslag net nog niet geschreven was.
 */
export const NU_VENSTER_MS = 10 * 60 * 1000;

export const nuOnline = (sessies: AanwezigheidSessie[], nu: number = Date.now()): AanwezigheidSessie[] => {
  const perUser = new Map<string, AanwezigheidSessie>();
  for (const s of sessies) {
    const t = new Date(s.tot).getTime();
    if (!Number.isFinite(t) || nu - t > NU_VENSTER_MS) continue;
    const vorige = perUser.get(s.userId);
    if (!vorige || new Date(vorige.tot).getTime() < t) perUser.set(s.userId, s);
  }
  return [...perUser.values()].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
};

/** "6 u 12" / "48 min" — leesbare duur voor een tijdbalk. */
export const duurKort = (minuten: number): string => {
  const m = Math.max(0, Math.round(minuten));
  if (m < 60) return `${m} min`;
  const u = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${u} u` : `${u} u ${rest}`;
};
