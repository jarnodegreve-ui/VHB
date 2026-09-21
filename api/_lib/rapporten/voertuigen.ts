import {
  AANDRIJVING_LABEL, DEFECT_STATUS_LABEL, VOERTUIG_CATEGORIE_LABEL, VOERTUIG_STATUS_LABEL, VOERTUIG_TYPE_LABEL, VOERTUIG_VERVAL_LABEL,
  WERKCODE_LABEL, WERKTYPE_LABEL,
} from "../../../shared/techniek.js";
import { onbekendLabel } from "../../../shared/rapporten/filters.js";
import { VERVAL_STATUS_LABEL, brusselseDag, dagenTussen, jarenTussen, pastInTermijn, vervalStatus } from "../../../shared/rapporten/peildatum.js";
import type { RapportBereik, RapportFilters, RapportResultaat, RapportRij } from "../../../shared/rapporten/types.js";

/**
 * De rapporten van het domein Voertuigen, als pure functies (bron + filters +
 * peildatum → rijen + bereik), dus te testen op vaste cijfers. De bron ophalen
 * gebeurt in voertuigLaders.ts; de definities staan in
 * shared/rapporten/definities/voertuigen.ts.
 *
 * `vandaag` is de kalenderdag in België: leeftijd, resterende dagen en
 * doorlooptijd rekenen daartegen, nooit tegen de klok van de server.
 */

export type RapportVoertuig = {
  id: string;
  busnr: string;
  kortNr?: number | null;
  nummerplaat?: string | null;
  chassisnr?: string | null;
  merk?: string | null;
  type: string;
  categorie: string;
  aandrijving?: string | null;
  status: string;
  inDienst?: string | null;
  zitplaatsen?: number | null;
  opmerking?: string | null;
};

const label = (tabel: Record<string, string>, waarde: string | null | undefined): string | null =>
  waarde ? tabel[waarde] ?? waarde : null;

/** Busnummer met het korte nummer erbij, zoals in de voertuigkiezer: "613 026 (26)". */
export const busLabel = (v: { busnr: string; kortNr?: number | null }): string => (v.kortNr != null ? `${v.busnr} (${v.kortNr})` : v.busnr);

const keuze = (filters: RapportFilters, id: string): string => filters.keuzes[id] ?? "alle";

/** Status, categorie en aandrijving; zonder statuskeuze alles wat in dienst is (actief en reserve). */
const pastInWagenpark = (v: RapportVoertuig, filters: RapportFilters): boolean => {
  const status = filters.keuzes.status ?? "in_dienst";
  if (status === "in_dienst" ? v.status === "uit_dienst" : status !== "alle" && v.status !== status) return false;
  const categorie = keuze(filters, "categorie");
  if (categorie !== "alle" && v.categorie !== categorie) return false;
  const aandrijving = keuze(filters, "aandrijving");
  return aandrijving === "alle" || v.aandrijving === aandrijving;
};

/** Het wagenpark heeft geen periode: het bereik zegt alleen óf er voertuigen zijn (eerste datum in dienst tot vandaag). */
const wagenparkBereik = (voertuigen: readonly RapportVoertuig[], vandaag: string): RapportBereik => {
  if (voertuigen.length === 0) return null;
  const eerste = voertuigen.reduce<string>((min, v) => (v.inDienst && v.inDienst < min ? v.inDienst : min), vandaag);
  return { van: eerste, tot: vandaag };
};

export function bouwWagenparkOverzicht(voertuigen: readonly RapportVoertuig[], filters: RapportFilters, vandaag: string): RapportResultaat {
  const rijen: RapportRij[] = voertuigen.filter((v) => pastInWagenpark(v, filters)).map((v) => ({
    id: v.id,
    busnr: v.busnr,
    nummerplaat: v.nummerplaat ?? null,
    merk: v.merk ?? null,
    type: label(VOERTUIG_TYPE_LABEL, v.type),
    aandrijving: label(AANDRIJVING_LABEL, v.aandrijving),
    categorie: label(VOERTUIG_CATEGORIE_LABEL, v.categorie),
    zitplaatsen: v.zitplaatsen ?? null,
    inDienst: v.inDienst ?? null,
    leeftijd: jarenTussen(v.inDienst, vandaag),
    status: label(VOERTUIG_STATUS_LABEL, v.status),
  }));
  return { rijen, bereik: wagenparkBereik(voertuigen, vandaag), peildatum: vandaag };
}

export function bouwWagenparkTechnisch(voertuigen: readonly RapportVoertuig[], filters: RapportFilters, vandaag: string): RapportResultaat {
  const rijen: RapportRij[] = voertuigen.filter((v) => pastInWagenpark(v, filters)).map((v) => ({
    id: v.id,
    busnr: v.busnr,
    nummerplaat: v.nummerplaat ?? null,
    chassisnr: v.chassisnr ?? null,
    merk: v.merk ?? null,
    type: label(VOERTUIG_TYPE_LABEL, v.type),
    aandrijving: label(AANDRIJVING_LABEL, v.aandrijving),
    zitplaatsen: v.zitplaatsen ?? null,
    inDienst: v.inDienst ?? null,
    opmerking: v.opmerking ?? null,
  }));
  return { rijen, bereik: wagenparkBereik(voertuigen, vandaag) };
}

/**
 * Eén groep voertuigen samengevat. `metLeeftijd` is het gewicht van het
 * gemiddelde in de totaalrij (geen eigen kolom). Het gemiddelde blijft
 * onafgerond: de kolom toont één decimaal, en de totaalrij komt zo op exact
 * hetzelfde cijfer uit als het gemiddelde in het overzicht per voertuig.
 */
const vatSamen = (groep: readonly RapportVoertuig[], vandaag: string) => {
  const leeftijden = groep.map((v) => jarenTussen(v.inDienst, vandaag)).filter((n): n is number => n !== null);
  return {
    aantal: groep.length,
    metLeeftijd: leeftijden.length,
    gemiddeld: leeftijden.length ? leeftijden.reduce((s, n) => s + n, 0) / leeftijden.length : null,
    oudste: leeftijden.length ? Math.max(...leeftijden) : null,
    jongste: leeftijden.length ? Math.min(...leeftijden) : null,
    zitplaatsen: groep.reduce((s, v) => s + (v.zitplaatsen ?? 0), 0),
  };
};

const groepeer = <T>(lijst: readonly T[], sleutel: (item: T) => string): Map<string, T[]> => {
  const uit = new Map<string, T[]>();
  for (const item of lijst) {
    const k = sleutel(item);
    const groep = uit.get(k);
    if (groep) groep.push(item); else uit.set(k, [item]);
  }
  return uit;
};

/** Alleen wat in dienst is (actief en reserve), binnen de gekozen categorie. */
const vloot = (voertuigen: readonly RapportVoertuig[], filters: RapportFilters): RapportVoertuig[] => {
  const categorie = keuze(filters, "categorie");
  return voertuigen.filter((v) => v.status !== "uit_dienst" && (categorie === "alle" || v.categorie === categorie));
};

const GROEP_LABEL: Record<string, (v: RapportVoertuig) => string> = {
  categorie: (v) => label(VOERTUIG_CATEGORIE_LABEL, v.categorie) ?? "Zonder categorie",
  type: (v) => label(VOERTUIG_TYPE_LABEL, v.type) ?? "Zonder type",
  merk: (v) => v.merk?.trim() || "Zonder merk",
  aandrijving: (v) => label(AANDRIJVING_LABEL, v.aandrijving) ?? "Zonder aandrijving",
};

export function bouwWagenparkLeeftijd(voertuigen: readonly RapportVoertuig[], filters: RapportFilters, vandaag: string): RapportResultaat {
  const naam = GROEP_LABEL[filters.keuzes.groep ?? "categorie"] ?? GROEP_LABEL.categorie;
  const rijen: RapportRij[] = [...groepeer(vloot(voertuigen, filters), naam)].map(([groep, lijst]) => {
    const s = vatSamen(lijst, vandaag);
    return { id: groep, groep, aantal: s.aantal, gemiddeld: s.gemiddeld, oudste: s.oudste, jongste: s.jongste, metLeeftijd: s.metLeeftijd };
  });
  return { rijen, bereik: wagenparkBereik(voertuigen, vandaag), peildatum: vandaag };
}

export function bouwWagenparkSamenvatting(voertuigen: readonly RapportVoertuig[], filters: RapportFilters, vandaag: string): RapportResultaat {
  const sleutel = (v: RapportVoertuig) => [v.merk?.trim() || "", v.type, v.aandrijving ?? ""].join(" | ");
  const rijen: RapportRij[] = [...groepeer(vloot(voertuigen, filters), sleutel)].map(([id, lijst]) => {
    const s = vatSamen(lijst, vandaag);
    const [eerste] = lijst;
    return {
      id,
      merk: eerste.merk?.trim() || "Zonder merk",
      type: label(VOERTUIG_TYPE_LABEL, eerste.type),
      aandrijving: label(AANDRIJVING_LABEL, eerste.aandrijving),
      aantal: s.aantal,
      zitplaatsen: s.zitplaatsen,
      gemiddeld: s.gemiddeld,
      metLeeftijd: s.metLeeftijd,
    };
  });
  return { rijen, bereik: wagenparkBereik(voertuigen, vandaag), peildatum: vandaag };
}

// --- Vervaldata per voertuig ---

export type RapportVoertuigVerval = { vehicleId: string; soort: string; validUntil: string; opmerking?: string | null };

export function bouwVervaldataVoertuigen(
  bron: { voertuigen: readonly RapportVoertuig[]; vervaldata: readonly RapportVoertuigVerval[] },
  filters: RapportFilters,
  vandaag: string,
): RapportResultaat {
  const perId = new Map(bron.voertuigen.map((v) => [v.id, v]));
  const soort = keuze(filters, "soort");
  const rijen: RapportRij[] = [];
  let van: string | null = null;
  let tot: string | null = null;
  for (const e of bron.vervaldata) {
    if (van === null || e.validUntil < van) van = e.validUntil;
    if (tot === null || e.validUntil > tot) tot = e.validUntil;
    if (soort !== "alle" && e.soort !== soort) continue;
    if (filters.voertuig && e.vehicleId !== filters.voertuig) continue;
    const resterend = dagenTussen(vandaag, e.validUntil);
    if (!pastInTermijn(resterend, filters.keuzes.termijn)) continue;
    const v = perId.get(e.vehicleId);
    rijen.push({
      id: `${e.vehicleId}:${e.soort}`,
      busnr: v ? busLabel(v) : onbekendLabel(e.vehicleId),
      nummerplaat: v?.nummerplaat ?? null,
      soort: label(VOERTUIG_VERVAL_LABEL, e.soort),
      geldigTot: e.validUntil,
      resterend,
      status: VERVAL_STATUS_LABEL[vervalStatus(resterend)],
      opmerking: e.opmerking ?? null,
    });
  }
  return { rijen, bereik: van !== null && tot !== null ? { van, tot } : null, peildatum: vandaag };
}

// --- Gele boek en werkprestaties ---

type Namen = (id: string | null | undefined) => string | null;

/** Naam bij een gebruikers-id; een verwijderd account blijft staan als "Onbekend (<id>)". */
export const namenUit = (users: ReadonlyArray<{ id: string | number; name: string }>): Namen => {
  const perId = new Map(users.map((u) => [String(u.id), u.name]));
  return (id) => (id ? perId.get(String(id)) ?? onbekendLabel(String(id)) : null);
};

export type RapportDefect = {
  id: string;
  vehicleId: string;
  busnr: string;
  kortNr?: number | null;
  /** Tijdstip (timestamptz). */
  gemeldOp: string;
  gemeldDoor: string;
  werktype: string;
  omschrijving: string;
  status: string;
  uitgevoerdOp?: string | null;
  uitgevoerdDoor?: string | null;
  manuren?: number | null;
};

export function bouwDefecten(
  bron: { defecten: readonly RapportDefect[]; users: ReadonlyArray<{ id: string | number; name: string }> },
  filters: RapportFilters,
  vandaag: string,
): RapportResultaat {
  const naam = namenUit(bron.users);
  const werktype = keuze(filters, "werktype");
  const status = keuze(filters, "status");
  const rijen: RapportRij[] = [];
  let van: string | null = null;
  let tot: string | null = null;
  for (const d of bron.defecten) {
    const dag = brusselseDag(d.gemeldOp);
    if (!dag) continue;
    if (van === null || dag < van) van = dag;
    if (tot === null || dag > tot) tot = dag;
    if ((filters.van && dag < filters.van) || (filters.tot && dag > filters.tot)) continue;
    if (filters.voertuig && d.vehicleId !== filters.voertuig) continue;
    if (werktype !== "alle" && d.werktype !== werktype) continue;
    if (status !== "alle" && d.status !== status) continue;
    // Doorlooptijd: van melding tot uitvoering; wat nog open staat loopt tot
    // vandaag. Een geannuleerde melding heeft geen doorlooptijd.
    const einde = d.status === "uitgevoerd" ? d.uitgevoerdOp ?? null : d.status === "open" ? vandaag : null;
    const doorlooptijd = einde ? dagenTussen(dag, einde) : null;
    rijen.push({
      id: d.id,
      gemeldOp: dag,
      bus: busLabel(d),
      werktype: label(WERKTYPE_LABEL, d.werktype),
      omschrijving: d.omschrijving,
      gemeldDoor: naam(d.gemeldDoor),
      status: label(DEFECT_STATUS_LABEL, d.status),
      uitgevoerdOp: d.uitgevoerdOp ?? null,
      uitgevoerdDoor: naam(d.uitgevoerdDoor),
      manuren: d.manuren ?? null,
      doorlooptijd: doorlooptijd === null ? null : Math.max(0, doorlooptijd),
    });
  }
  return { rijen, bereik: van !== null && tot !== null ? { van, tot } : null, peildatum: vandaag };
}

export type RapportWerk = {
  id: string;
  datum: string;
  mecanicienId: string;
  vehicleId?: string | null;
  busnr?: string | null;
  kortNr?: number | null;
  werkcode: string;
  omschrijving: string;
  beginTijd?: string | null;
  eindeTijd?: string | null;
  werkuren: number;
};

export function bouwUitgevoerdeWerken(
  bron: { werken: readonly RapportWerk[]; users: ReadonlyArray<{ id: string | number; name: string }> },
  filters: RapportFilters,
): RapportResultaat {
  const naam = namenUit(bron.users);
  const werkcode = keuze(filters, "werkcode");
  const rijen: RapportRij[] = [];
  let van: string | null = null;
  let tot: string | null = null;
  for (const w of bron.werken) {
    const dag = w.datum.slice(0, 10);
    if (van === null || dag < van) van = dag;
    if (tot === null || dag > tot) tot = dag;
    if ((filters.van && dag < filters.van) || (filters.tot && dag > filters.tot)) continue;
    if (filters.voertuig && w.vehicleId !== filters.voertuig) continue;
    if (filters.chauffeur && String(w.mecanicienId) !== filters.chauffeur) continue;
    if (werkcode !== "alle" && w.werkcode !== werkcode) continue;
    rijen.push({
      id: w.id,
      datum: dag,
      // Zonder voertuig = werk aan de garage zelf (busnummer 999 in Access).
      bus: w.busnr ? busLabel({ busnr: w.busnr, kortNr: w.kortNr }) : "Garage, algemeen",
      werkcode: label(WERKCODE_LABEL, w.werkcode),
      omschrijving: w.omschrijving,
      mecanicien: naam(w.mecanicienId),
      begin: w.beginTijd ?? null,
      einde: w.eindeTijd ?? null,
      werkuren: w.werkuren,
    });
  }
  return { rijen, bereik: van !== null && tot !== null ? { van, tot } : null };
}
