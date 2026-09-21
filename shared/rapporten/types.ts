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
 * haar eigen parameter (`id`) en opties mee, een vinkje (aan/uit, in de URL
 * `<id>=1`) alleen haar parameter en label.
 */
export type RapportFilter =
  | { soort: 'periode'; /** Periode zonder keuze in de URL; zonder opgave "deze maand". */ standaard?: 'deze-maand' | 'vorige-maand' | 'dit-kwartaal' | 'dit-jaar' }
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
  }
  | {
    soort: 'vinkje';
    /** Parameternaam in de URL (`<id>=1` = aan, afwezig = uit); mag niet botsen met de vaste namen. */
    id: string;
    /** Wat het vinkje doet als het aan staat: "Alleen boven de limiet". */
    label: string;
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
  /**
   * Rol van de kolom op een smal scherm (telefoon), waar niet alles naast
   * elkaar past. Alleen de tabel op het scherm luistert hiernaar: het
   * printblad, de CSV en het brede scherm tonen altijd alle kolommen in de
   * volgorde van de definitie.
   *  - `onderEerste`  geen eigen kolom, maar een tweede, gedempte regel onder
   *                   de waarde van de eerste kolom (sectie onder de naam)
   *  - `achteraan`    blijft een kolom, maar schuift naar het einde: achter
   *                   het horizontaal scrollen in plaats van ervoor
   *  - `verberg`      op een smal scherm weg
   * De eerste kolom heeft nooit een rol: die blijft links staan.
   */
  smal?: 'onderEerste' | 'achteraan' | 'verberg';
  /** Korte kolomkop voor het smalle scherm ("Opgen."); de volledige titel blijft de naam voor hulptechnologie. */
  kort?: string;
  /**
   * Lange tekst (een opmerking, een lijst namen). Op een smal scherm krijgt de
   * kolom dan een bredere vaste maat (zo breed als er naast de vaste eerste
   * kolom past), zodat de tekst niet elke rij vijf regels hoog maakt.
   */
  lang?: boolean;
  /**
   * Sorteer op een ander veld van de rij dan wat er in beeld staat: een maand
   * toont "Augustus 2026" maar sorteert op '2026-08'. Het veld hoeft geen
   * kolom te zijn.
   */
  sorteerOp?: string;
};

export type RapportDefinitie = {
  /** Ook het laatste stuk van de URL en de sleutel van de laadfunctie. */
  id: string;
  domein: RapportDomein;
  titel: string;
  /** Eén regel, voor de catalogus en onder de titel. */
  omschrijving: string;
  filters: readonly RapportFilter[];
  /**
   * De kolommen. Een rapport waarvan de kolommen van de gegevens afhangen (één
   * kolom per verloftype dat in het jaar voorkomt) zet hier zijn vaste
   * kolommen en laat zijn laadfunctie de volledige lijst meegeven
   * (`RapportResultaat.kolommen`); scherm, blad en CSV gebruiken dan die lijst
   * (`metKolommen` in opmaak.ts). De sorteerkolom moet in beide staan.
   */
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
  /** Vinkje-filters per `id`; alleen aanwezig bij een rapport dat er heeft. */
  vinkjes?: Record<string, boolean>;
};

/** Van wanneer tot wanneer de bron gegevens heeft; null = nog niets geregistreerd. */
export type RapportBereik = { van: string; tot: string } | null;

export type RapportAntwoord = {
  rijen: RapportRij[];
  /** Alleen bij een rapport met kolommen die van de gegevens afhangen: de volledige lijst, in plaats van die uit de definitie. */
  kolommen?: RapportKolom[];
  /** Som per optelbare kolom over álle rijen (ook nul, dus "0" op het blad). */
  totalen: Record<string, number>;
  bereik: RapportBereik;
  /** ISO-tijdstip van de server. */
  gegenereerdOp: string;
};

/** Wat een laadfunctie teruggeeft; de route vult totalen en tijdstip aan. */
export type RapportResultaat = {
  rijen: RapportRij[];
  bereik: RapportBereik;
  /** Kolommen die van de gegevens afhangen: de volledige lijst (zie `RapportDefinitie.kolommen`). */
  kolommen?: RapportKolom[];
  /**
   * Totalen die geen som van de rijen zijn (unieke chauffeurs over de hele
   * periode, een melding die in twee maanden telt maar één keer in het
   * totaal). Ze komen bovenop de gewone sommen in de totaalrij; zoekt de
   * gebruiker in de tabel, dan vallen ze weg en blijven alleen de sommen.
   */
  totalen?: Record<string, number>;
};

/** De lader van een rapport op de server: haalt de bron op en geeft ze aan de pure laadfunctie. */
export type RapportLader = (filters: RapportFilters) => Promise<RapportResultaat>;
