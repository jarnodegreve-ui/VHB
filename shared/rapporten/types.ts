/**
 * Het rapportenregister: één rapport = één definitie. De pagina Rapporten
 * (catalogus, filters, tabel, CSV), het printblad en de server
 * (GET /api/rapporten/:id) lezen allemaal dezelfde definitie, dus een nieuw
 * rapport is een definitie + een laadfunctie + een test, geen nieuw scherm.
 * Zod-vrij: alleen types en gewone data.
 */

/** Het domein bepaalt onder welke kop een rapport in de catalogus staat. */
export type RapportDomein = 'ziekte' | 'verlof' | 'ruilen' | 'planning' | 'voertuigen' | 'personeel' | 'uren';

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
  | {
    soort: 'chauffeur';
    /** Veldlabel, standaard "Chauffeur". */
    label?: string;
    /** Wie er in de kiezer staat, op rol (['technieker', 'planner', 'admin'] voor een mecanicien); zonder opgave iedereen die niet tot de staf hoort. */
    rollen?: readonly string[];
  }
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

/**
 * Toon van een cel: `gevaar` (vervallen, danger) en `waarschuwing` (binnenkort,
 * amber) vragen aandacht en zijn een pil; `aandacht` (amber), `goed` en `rust`
 * zijn een puntje met tekst, voor een toestand die op veel rijen tegelijk
 * staat (een open melding). Nooit goud: dat is geen statuskleur.
 */
export type KolomToon = 'gevaar' | 'waarschuwing' | 'aandacht' | 'goed' | 'rust';

/**
 * Hoe een kolom in de totaalrij telt: `som` (standaard bij `true`), de
 * kleinste of grootste waarde, of het gemiddelde. Een gemiddelde weegt met
 * `totaalGewicht` als de rijen zelf al groepen zijn.
 */
export type TotaalSoort = 'som' | 'min' | 'max' | 'gemiddelde';

export type RapportKolom = {
  /** Sleutel in de rij. */
  id: string;
  titel: string;
  type: KolomType;
  /** Standaard: getal en duur rechts, de rest links. */
  uitlijning?: 'links' | 'rechts';
  /** Telt mee in de totaalrij (alleen zinvol voor getal en duur); `true` = som. */
  totaal?: boolean | TotaalSoort;
  /**
   * Bij `totaal: 'gemiddelde'`: de sleutel in de rij met het gewicht (hoeveel
   * stuks er achter het gemiddelde van die rij zitten). Mag een waarde zijn
   * die geen eigen kolom heeft. Zonder opgave weegt elke rij even zwaar.
   */
  totaalGewicht?: string;
  /**
   * Tekstkolom met lopende tekst (omschrijving, opmerking, merk en model): krijgt op het brede
   * scherm een minimumbreedte en mag afbreken. Andere tekstkolommen zijn korte
   * waarden en blijven op één regel, zodat tien kolommen naast elkaar passen.
   */
  breed?: boolean;
  /** Vast aantal decimalen voor een getal (leeftijd 7,0); zonder opgave hoogstens twee, zonder nullen achteraan. */
  decimalen?: number;
  /**
   * Wat er staat als de waarde ontbreekt, in plaats van een streepje, met een
   * toon als dat ontbreken zelf het signaal is ("Geen datum" in amber bij een
   * vervaldatum). Alleen in beeld en op het blad; in de CSV blijft de cel leeg.
   */
  leeg?: { tekst: string; toon?: KolomToon };
  /** Tekstkolom met een status: waarde → toon. Wat er niet in staat krijgt geen toon. */
  tonen?: Readonly<Record<string, KolomToon>>;
  /**
   * Getalkolom met een grens (resterende dagen): onder `gevaarOnder` is de cel
   * `gevaar`, van daar tot en met `waarschuwingTot` `waarschuwing`.
   */
  signaal?: { gevaarOnder?: number; waarschuwingTot?: number };
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
  /**
   * Het rapport rekent tegenover vandaag (leeftijd, resterende dagen): de
   * server geeft zijn peildatum mee en scherm en blad tonen die in de
   * filterregel. Bewust geen parameter in de URL: een gedeelde link naar
   * "vervalt binnen 30 dagen" hoort morgen vanaf morgen te tellen.
   */
  peildatum?: boolean;
  /**
   * Als de bron nog helemaal leeg is: waar die gegevens ingevuld worden. De
   * tekst komt na "Er zijn nog geen <bronNaam> geregistreerd."; de actie is
   * een scherm uit de routetabel (`view`), zodat een lege staat nooit een
   * instructie zonder knop is.
   */
  geenBron?: { tekst: string; actie?: { label: string; view: string } };
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
  /** Totaal per optelbare kolom over álle rijen (een som ook bij nul, dus "0" op het blad). */
  totalen: Record<string, number>;
  bereik: RapportBereik;
  /** Alleen bij een rapport met `peildatum`: de kalenderdag (Brussel) waartegen gerekend is. */
  peildatum?: string;
  /** ISO-tijdstip van de server. */
  gegenereerdOp: string;
};

/** Wat een laadfunctie teruggeeft; de route vult totalen en tijdstip aan. */
export type RapportResultaat = { rijen: RapportRij[]; bereik: RapportBereik; peildatum?: string };
