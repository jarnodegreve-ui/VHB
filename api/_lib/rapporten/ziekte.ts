import { berekenZiektePeriode, ziekteBereik } from "../../../shared/ziekteInzicht.js";
import type { RapportFilters, RapportResultaat, RapportRij } from "../../../shared/rapporten/types.js";
import { maandLabel, persoonZoeker, type RapportGebruiker, type VerlofRij } from "./gedeeld.js";

/**
 * De drie ziekterapporten. Pure functies (bron + filters → rijen + bereik),
 * allemaal op dezelfde telling: `berekenZiektePeriode` uit
 * shared/ziekteInzicht.ts, de kern van het jaaroverzicht op het Ziekte-scherm.
 * Voor hetzelfde jaar zijn de cijfers dus gelijk aan dat scherm
 * (src/rapportZiekte.test.ts bewaakt dat):
 *  - alleen goedgekeurde ziekmeldingen;
 *  - kalenderdagen, weekends en feestdagen inbegrepen;
 *  - een melding over de periodegrens telt alleen haar dagen BINNEN de periode;
 *  - alleen t/m vandaag: een lopende melding telt tot vandaag (of tot het
 *    einde van de periode als dat vroeger valt);
 *  - een dag telt per chauffeur één keer, ook bij overlappende meldingen.
 *
 * "Gemiste diensten" staat er bewust niet in: de planningrijen van een zieke
 * verdwijnen niet vanzelf en worden na herverdelen overschreven, dus er is
 * geen betrouwbare bron voor wat iemand door ziekte niet gereden heeft.
 */

export type ZiekteBron = {
  users: readonly RapportGebruiker[];
  leave: readonly VerlofRij[];
  /** De kalenderdag van vandaag in België (ISO). */
  vandaag: string;
};

const periodeVan = (filters: RapportFilters): { van: string; tot: string } => ({ van: filters.van ?? "", tot: filters.tot ?? "" });

/** Alleen de meldingen van de gekozen chauffeur (of alle). */
const meldingenVoor = (bron: ZiekteBron, filters: RapportFilters): readonly VerlofRij[] =>
  (filters.chauffeur ? bron.leave.filter((l) => String(l.userId) === filters.chauffeur) : bron.leave);

/** Rapport "Ziekte in kalenderdagen": één rij per chauffeur met ziekte in de periode. */
export function bouwZiekteKalenderdagen(bron: ZiekteBron, filters: RapportFilters): RapportResultaat {
  const { van, tot } = periodeVan(filters);
  const inzicht = berekenZiektePeriode(meldingenVoor(bron, filters), van, tot, bron.vandaag);
  const persoon = persoonZoeker(bron.users);
  const rijen: RapportRij[] = inzicht.chauffeurs.map((c) => {
    const p = persoon(c.userId);
    return {
      id: c.userId,
      naam: p.naam,
      personeelsnr: p.personeelsnr,
      meldingen: c.meldingen,
      kalenderdagen: c.kalenderdagen,
      langstePeriode: c.langstePeriode,
      laatsteMelding: c.laatsteMelding,
    };
  });
  return { rijen, bereik: ziekteBereik(bron.leave, bron.vandaag) };
}

/** Rapport "Details ziekte": één rij per ziekmelding die de periode raakt. */
export function bouwZiekteDetails(bron: ZiekteBron, filters: RapportFilters): RapportResultaat {
  const { van, tot } = periodeVan(filters);
  const inzicht = berekenZiektePeriode(meldingenVoor(bron, filters), van, tot, bron.vandaag);
  const persoon = persoonZoeker(bron.users);
  const opmerking = new Map(bron.leave.map((l) => [l.id, l.comment?.trim() || null]));
  const rijen: RapportRij[] = inzicht.meldingen.map((m) => {
    const p = persoon(m.userId);
    return {
      id: m.id,
      naam: p.naam,
      personeelsnr: p.personeelsnr,
      // De geregistreerde datums, niet afgekapt: de kolom Kalenderdagen zegt
      // hoeveel daarvan binnen de gekozen periode (en t/m vandaag) vallen.
      van: m.startDate,
      tot: m.endDate,
      kalenderdagen: m.kalenderdagen,
      opmerking: opmerking.get(m.id) ?? null,
    };
  });
  return { rijen, bereik: ziekteBereik(bron.leave, bron.vandaag) };
}

/** Rapport "Ziekte per maand": elke maand van de periode t/m vandaag, ook zonder ziekte. */
export function bouwZiektePerMaand(bron: ZiekteBron, filters: RapportFilters): RapportResultaat {
  const { van, tot } = periodeVan(filters);
  const inzicht = berekenZiektePeriode(bron.leave, van, tot, bron.vandaag);
  const rijen: RapportRij[] = inzicht.maanden.map((m) => ({
    id: m.maand,
    maand: maandLabel(m.maand),
    maandSleutel: m.maand,
    meldingen: m.meldingen,
    kalenderdagen: m.kalenderdagen,
    chauffeurs: m.chauffeurs,
  }));
  return {
    rijen,
    bereik: ziekteBereik(bron.leave, bron.vandaag),
    // Geen sommen van de maanden: een melding over twee maanden is één melding,
    // een chauffeur die twee maanden ziek was is één chauffeur.
    totalen: { meldingen: inzicht.aantalMeldingen, chauffeurs: inzicht.chauffeurs.length },
  };
}
