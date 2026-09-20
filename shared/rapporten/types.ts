/**
 * Het rapportenregister: één rapport = één definitie. De pagina Rapporten
 * (catalogus, filters, tabel, CSV), het printblad en de server
 * (GET /api/rapporten/:id) lezen allemaal dezelfde definitie, dus een nieuw
 * rapport is een definitie + een laadfunctie + een test, geen nieuw scherm.
 * Zod-vrij: alleen types en gewone data.
 */

/** Het domein bepaalt onder welke kop een rapport in de catalogus staat. */
export type RapportDomein = 'ziekte' | 'verlof' | 'ruilen' | 'planning' | 'voertuigen' | 'uren';

/**
 * De filters van een rapport, in de volgorde waarin ze op het scherm staan.
 * De vier vaste soorten hebben elk hun eigen bouwsteen (Periodekiezer,
 * jaarkeuze, Chauffeurkiezer, Voertuigkiezer) en hun eigen vaste parameter in
 * de URL (`van`+`tot`, `jaar`, `chauffeur`, `voertuig`); een keuzelijst brengt
 * haar eigen parameter (`id`) en opties mee.
 */
export type RapportFilter =
  | { soort: 'periode' }
  | { soort: 'jaar' }
  | { soort: 'chauffeur'; /** Veldlabel, standaard "Chauffeur". */ label?: string }
  | { soort: 'voertuig' }
  | {
    soort: 'keuze';
    /** Parameternaam in de URL; mag niet botsen met de vaste namen. */
    id: string;
    label: string;
    opties: ReadonlyArray<{ waarde: string; label: string }>;
    /** Waarde zonder keuze in de URL; zonder opgave de eerste optie. */
    standaard?: string;
  };

/**
 * Het type stuurt de opmaak (scherm, blad, CSV), de uitlijning en of een
 * kolom optelbaar is:
 *  - `tekst`  zoals aangeleverd
 *  - `datum`  'JJJJ-MM-DD', in beeld dd/mm/jjjj
 *  - `getal`  aantal (dagen, stuks), optelbaar
 *  - `duur`   MINUTEN, in beeld u:mm, optelbaar
 *  - `janee`  boolean, in beeld ja/nee
 */
export type KolomType = 'tekst' | 'datum' | 'getal' | 'duur' | 'janee';

export type RapportKolom = {
  /** Sleutel in de rij. */
  id: string;
  titel: string;
  type: KolomType;
  /** Standaard: getal en duur rechts, de rest links. */
  uitlijning?: 'links' | 'rechts';
  /** Telt mee in de totaalrij (alleen zinvol voor getal en duur). */
  totaal?: boolean;
};

export type RapportDefinitie = {
  /** Ook het laatste stuk van de URL en de sleutel van de laadfunctie. */
  id: string;
  domein: RapportDomein;
  titel: string;
  /** Eén regel, voor de catalogus en onder de titel. */
  omschrijving: string;
  filters: readonly RapportFilter[];
  kolommen: readonly RapportKolom[];
  sortering: { kolom: string; richting: 'asc' | 'desc' };
  /** A4 staand of liggend op het printblad. */
  print: 'staand' | 'liggend';
  /** Naam van de gegevens in de lege teksten: "Er zijn pas verlofgegevens vanaf …". */
  bronNaam: string;
};

export type RapportWaarde = string | number | boolean | null;
/** Eén rij: een stabiel `id` plus een waarde per kolom-id. */
export type RapportRij = { id: string } & Record<string, RapportWaarde>;

/** De gekozen filters, genormaliseerd (standaarden ingevuld). */
export type RapportFilters = {
  van?: string;
  tot?: string;
  jaar?: number;
  /** Leeg = alle. */
  chauffeur?: string;
  voertuig?: string;
  /** Keuzelijst-filters per `id`. */
  keuzes: Record<string, string>;
};

/** Van wanneer tot wanneer de bron gegevens heeft; null = nog niets geregistreerd. */
export type RapportBereik = { van: string; tot: string } | null;

export type RapportAntwoord = {
  rijen: RapportRij[];
  /** Som per optelbare kolom over álle rijen (ook nul, dus "0" op het blad). */
  totalen: Record<string, number>;
  bereik: RapportBereik;
  /** ISO-tijdstip van de server. */
  gegenereerdOp: string;
};

/** Wat een laadfunctie teruggeeft; de route vult totalen en tijdstip aan. */
export type RapportResultaat = { rijen: RapportRij[]; bereik: RapportBereik };
