/**
 * Advies voor openstaande diensten: past een onbemande dienst in het schema
 * van een vrije chauffeur? Drie harde regels (vraag Jarno 17-08):
 *
 *  1. Minstens MIN_RUST_UREN uur rust t.o.v. de dienst van de dag ervoor — en
 *     spiegelbeeldig ook t.o.v. de dag erna, want dat is dezelfde regel
 *     bekeken vanaf morgen: anders maakt de toewijzing van vandaag de rust
 *     van een al ingeplande dienst kapot.
 *  2. Maximum MAX_WERKDAGEN_NA_ELKAAR gewerkte dagen na elkaar.
 *  3. Een schoolvervoerchauffeur (sectie) springt niet in op een lijndienst.
 *
 * Pure logica zonder storage, zodat src/advisor.test.ts hem direct kan
 * testen; de endpoint (/api/coverage-advisor) voert alleen de data aan.
 */

export const MIN_RUST_UREN = 8;
export const MAX_WERKDAGEN_NA_ELKAAR = 6;

export type TijdRij = { startTime: string; endTime: string };

/** 'HH:MM' → minuten sinds middernacht van de dienstdag. Busvak-uren ≥ 24
 *  ("26:16" = 02:16 de nacht erna) zijn geldig tot 47:59 — zelfde regels als
 *  parseHHMM in src/lib/shiftTime.ts. */
const parseBusvakMin = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
};

/**
 * Werkvenster van één dag (gesplitste dienst = meerdere rijen): vroegste
 * start t/m laatste einde, in minuten sinds middernacht van de dienstdag.
 * Een impliciete nachtdienst (einde ≤ start met gewone uren, bv.
 * 22:00–06:00) wordt +24u genormaliseerd — zelfde conventie als
 * isShiftActiveAt in src/lib/shiftTime.ts. Rijen met kapotte tijden tellen
 * niet mee; null = geen bruikbare tijden.
 */
export const dagVenster = (rijen: TijdRij[]): { start: number; eind: number } | null => {
  let start: number | null = null;
  let eind: number | null = null;
  for (const rij of rijen) {
    const s = parseBusvakMin(rij.startTime);
    const e = parseBusvakMin(rij.endTime);
    if (s === null || e === null) continue;
    const eNorm = e <= s ? e + 24 * 60 : e;
    start = start === null ? s : Math.min(start, s);
    eind = eind === null ? eNorm : Math.max(eind, eNorm);
  }
  return start === null || eind === null ? null : { start, eind };
};

/** ISO-dag ± n dagen (puur datumrekenen in UTC-frame, geen tijdzones). */
export const addDagen = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Rust in minuten tussen het einde van de vorige werkdag en het begin van de
 * aangeboden dienst. Beide staan in minuten t.o.v. hun éigen dienstdag-
 * middernacht; de vorige dag ligt 24u eerder, vandaar de +24u op de start.
 * null = geen dienst de dag ervoor → de regel legt niets op.
 */
export const rustTovVorigeDag = (vorigeDag: TijdRij[], dienstStart: number): number | null => {
  const v = dagVenster(vorigeDag);
  return v === null ? null : dienstStart + 24 * 60 - v.eind;
};

/** Spiegelbeeld: rust tussen het einde van de aangeboden dienst en de start
 *  van de dienst op de dag erna. */
export const rustTovVolgendeDag = (volgendeDag: TijdRij[], dienstEind: number): number | null => {
  const v = dagVenster(volgendeDag);
  return v === null ? null : v.start + 24 * 60 - dienstEind;
};

/** Hoeveel dagen na elkaar werkt de chauffeur als `datum` een werkdag wordt?
 *  Telt de aaneengesloten reeks bestaande werkdagen in beide richtingen
 *  (guard tegen ontsporen op een corrupte set). */
export const dagenNaElkaarMet = (gewerkteDagen: Set<string>, datum: string): number => {
  let n = 1;
  for (let d = addDagen(datum, -1), g = 0; gewerkteDagen.has(d) && g < 366; d = addDagen(d, -1), g++) n++;
  for (let d = addDagen(datum, 1), g = 0; gewerkteDagen.has(d) && g < 366; d = addDagen(d, 1), g++) n++;
  return n;
};

/** Een schoolbuschauffeur springt niet in op een lijndienst (regel Jarno
 *  17-08). Er is géén kenmerk op de dienst zelf dat "schoolrit" zegt, dus de
 *  regel hangt aan de sectie van de kandidaat; ruim matchen op "school" zodat
 *  een hernoemde sectie ("Schoolvervoer 2") hem niet stil uitschakelt. */
export const isSchoolvervoerSectie = (sectie?: string | null): boolean =>
  String(sectie ?? "").toLowerCase().includes("school");

/** "8u" / "7u53" — compacte urennotatie voor redenen en badges. */
export const formatUren = (minuten: number): string => {
  const heel = Math.max(0, minuten);
  const u = Math.floor(heel / 60);
  const m = heel % 60;
  return m === 0 ? `${u}u` : `${u}u${String(m).padStart(2, "0")}`;
};

/** Maandag van de week (ma–zo) waarin `iso` valt. */
export const maandagVan = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDagen(iso, -((d.getUTCDay() + 6) % 7));
};

/** Gewerkte dagen in de week (ma–zo) van `datum`, de dag zelf niet meegeteld
 *  — die is voor iedere kandidaat dezelfde toevoeging en zou alleen ruis geven. */
export const dagenInWeekVan = (gewerkteDagen: Set<string>, datum: string): number => {
  const maandag = maandagVan(datum);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const dag = addDagen(maandag, i);
    if (dag !== datum && gewerkteDagen.has(dag)) n++;
  }
  return n;
};

/** Gewerkte dagen in de kalendermaand van `datum`, de dag zelf niet meegeteld. */
export const dagenInMaandVan = (gewerkteDagen: Set<string>, datum: string): number => {
  const maand = datum.slice(0, 7);
  let n = 0;
  for (const dag of gewerkteDagen) {
    if (dag !== datum && dag.slice(0, 7) === maand) n++;
  }
  return n;
};

export type KandidaatAdvies = {
  id: string;
  name: string;
  /** Rust in minuten t.o.v. de vorige/volgende werkdag; null = geen dienst die dag. */
  rustVoor: number | null;
  rustNa: number | null;
  /** Gewerkte dagen na elkaar mét deze toewijzing erbij. */
  dagenNaElkaar: number;
  /** Al gewerkte dagen in de week (ma–zo) resp. kalendermaand van het gat. */
  dagenDezeWeek: number;
  dagenDezeMaand: number;
  /** Hoe vaak dit jaar al ingevallen. Telt sinds 19-08 niet meer mee in de
   *  sortering (keuze Jarno: het portaal wordt nog te weinig gebruikt om die
   *  teller iets te laten zeggen); blijft in het antwoord voor wie het wil zien. */
  keren: number;
  past: boolean;
  redenen: string[];
};

export const beoordeelKandidaat = (invoer: {
  id: string;
  name: string;
  /** Sectie uit gebruikersbeheer (Reguliere/Nacht/Flexi/Schoolvervoer). */
  sectie?: string | null;
  /** Venster van de aangeboden dienst; null = tijden onbekend → alleen de 6-dagenregel telt. */
  dienstVenster: { start: number; eind: number } | null;
  vorigeDag: TijdRij[];
  volgendeDag: TijdRij[];
  gewerkteDagen: Set<string>;
  datum: string;
  keren: number;
}): KandidaatAdvies => {
  const rustVoor = invoer.dienstVenster ? rustTovVorigeDag(invoer.vorigeDag, invoer.dienstVenster.start) : null;
  const rustNa = invoer.dienstVenster ? rustTovVolgendeDag(invoer.volgendeDag, invoer.dienstVenster.eind) : null;
  const dagen = dagenNaElkaarMet(invoer.gewerkteDagen, invoer.datum);
  const grens = MIN_RUST_UREN * 60;
  const redenen: string[] = [];
  // Categorische reden eerst: sectie vóór de tijd- en reeksregels.
  if (isSchoolvervoerSectie(invoer.sectie)) redenen.push("schoolvervoerchauffeur — springt niet in op een lijndienst");
  if (rustVoor !== null && rustVoor < grens) redenen.push(`maar ${formatUren(rustVoor)} rust na de dienst van de dag ervoor`);
  if (rustNa !== null && rustNa < grens) redenen.push(`maar ${formatUren(rustNa)} rust vóór de dienst van de dag erna`);
  if (dagen > MAX_WERKDAGEN_NA_ELKAAR) redenen.push(`zou ${dagen} dagen na elkaar werken`);
  return {
    id: invoer.id,
    name: invoer.name,
    rustVoor,
    rustNa,
    dagenNaElkaar: dagen,
    dagenDezeWeek: dagenInWeekVan(invoer.gewerkteDagen, invoer.datum),
    dagenDezeMaand: dagenInMaandVan(invoer.gewerkteDagen, invoer.datum),
    keren: invoer.keren,
    past: redenen.length === 0,
    redenen,
  };
};

/** Passend eerst; daarbinnen wie deze week (ma–zo) het minst werkte, dan de
 *  kortste aaneengesloten reeks rond het gat, dan het laagste maandtotaal,
 *  dan op naam — keuze Jarno 19-08. De invalbeurten-teller telt niet meer
 *  mee: zolang chauffeurs het portaal amper gebruiken staat die vrijwel
 *  overal op nul; de gewerkte dagen komen uit de geïmporteerde planning en
 *  zeggen wél iets. */
export const sorteerKandidaten = (ks: KandidaatAdvies[]): KandidaatAdvies[] =>
  [...ks].sort(
    (a, b) =>
      Number(b.past) - Number(a.past) ||
      a.dagenDezeWeek - b.dagenDezeWeek ||
      a.dagenNaElkaar - b.dagenNaElkaar ||
      a.dagenDezeMaand - b.dagenDezeMaand ||
      a.name.localeCompare(b.name),
  );

// --- Ketting-voorstellen (vraag Jarno 18-08, "voor als het moeilijker is") ---
//
// Past de open dienst bij niemand die vrij is, dan kan hij vaak wél via een
// ruil in één stap: een collega die al werkt staat zijn eigen dienst af aan
// een vrije collega en rijdt zelf het gat. Beide schakels moeten aan alle
// regels voldoen — de ketting verplaatst het probleem, hij mag het niet
// doorgeven.

/** Gegevens per persoon die de ketting-zoeker nodig heeft om de regels te
 *  checken — zelfde velden als beoordeelKandidaat verwacht. */
export type KettingPersoon = {
  id: string;
  name: string;
  sectie?: string | null;
  vorigeDag: TijdRij[];
  volgendeDag: TijdRij[];
  gewerkteDagen: Set<string>;
  keren: number;
};

export type KettingWerkende = KettingPersoon & {
  /** Zijn dienstcode(s) die dag (bv. "4101" of "4101/4103"). */
  dienstCode: string;
  /** Zijn planning-rijen die dag — de échte tijden van de dienst die vrijkomt. */
  rijen: TijdRij[];
};

export type KettingVoorstel = {
  /** Wie zijn eigen dienst afstaat en het gat rijdt. */
  vanId: string;
  vanNaam: string;
  /** De dienst die daardoor vrijkomt. */
  viaCode: string;
  viaTijden: string;
  /** De vrije collega die die dienst overneemt. */
  naarId: string;
  naarNaam: string;
};

/** "08:00–16:00" of "06:12–09:30 + 15:41–18:20" — weergave van planning-rijen,
 *  gesorteerd op starttijd (gesplitste diensten staan niet per se op volgorde). */
export const tijdenLabel = (rijen: TijdRij[]): string =>
  [...rijen]
    .filter((r) => r.startTime && r.endTime)
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    .map((r) => `${r.startTime}–${r.endTime}`)
    .join(" + ");

/**
 * Zoek ruilen in één stap: werkende X staat dienst D af aan vrije Y en rijdt
 * zelf het gat. Voorwaarden: het gat past in X' schema (X werkt al, dus zijn
 * reeks verandert niet — alleen de rusttijden tellen), en D past volledig in
 * dat van Y. Zonder tijden van de open dienst is de rustcheck voor X
 * onmogelijk → dan geen voorstellen (liever niets dan een onbetrouwbare ruil).
 * Beste ketting eerst: de overnemer die deze week het minst werkte (zelfde
 * criteria als sorteerKandidaten).
 */
export const zoekKettingen = (invoer: {
  datum: string;
  dienstVenster: { start: number; eind: number } | null;
  werkenden: KettingWerkende[];
  vrijen: KettingPersoon[];
  max?: number;
}): KettingVoorstel[] => {
  if (!invoer.dienstVenster) return [];
  const max = invoer.max ?? 3;
  const gevonden: Array<{ voorstel: KettingVoorstel; naar: KandidaatAdvies }> = [];
  for (const x of [...invoer.werkenden].sort((a, b) => a.name.localeCompare(b.name))) {
    const xOordeel = beoordeelKandidaat({
      id: x.id,
      name: x.name,
      sectie: x.sectie,
      dienstVenster: invoer.dienstVenster,
      vorigeDag: x.vorigeDag,
      volgendeDag: x.volgendeDag,
      gewerkteDagen: x.gewerkteDagen,
      datum: invoer.datum,
      keren: x.keren,
    });
    if (!xOordeel.past) continue;
    const dVenster = dagVenster(x.rijen);
    if (!dVenster) continue;
    const overnemers = sorteerKandidaten(
      invoer.vrijen.map((y) =>
        beoordeelKandidaat({
          id: y.id,
          name: y.name,
          sectie: y.sectie,
          dienstVenster: dVenster,
          vorigeDag: y.vorigeDag,
          volgendeDag: y.volgendeDag,
          gewerkteDagen: y.gewerkteDagen,
          datum: invoer.datum,
          keren: y.keren,
        }),
      ),
    ).filter((k) => k.past);
    if (overnemers.length === 0) continue;
    const beste = overnemers[0];
    gevonden.push({
      voorstel: {
        vanId: x.id,
        vanNaam: x.name,
        viaCode: x.dienstCode,
        viaTijden: tijdenLabel(x.rijen),
        naarId: beste.id,
        naarNaam: beste.name,
      },
      naar: beste,
    });
  }
  return gevonden
    .sort(
      (a, b) =>
        a.naar.dagenDezeWeek - b.naar.dagenDezeWeek ||
        a.naar.dagenNaElkaar - b.naar.dagenNaElkaar ||
        a.naar.dagenDezeMaand - b.naar.dagenDezeMaand ||
        a.naar.name.localeCompare(b.naar.name),
    )
    .slice(0, max)
    .map((g) => g.voorstel);
};

// --- Collega-samenvatting (vraag Jarno 18-08, bewust zónder AI) ---

/**
 * Eén advies-zin zoals een collega hem zou zeggen, opgebouwd uit de al
 * berekende feiten. Wordt getoond in de advies-modal én in de dagelijkse
 * digest-mail — platte tekst, geen opmaak.
 */
export const adviesSamenvatting = (invoer: {
  code: string;
  kandidaten: KandidaatAdvies[];
  kettingen: KettingVoorstel[];
}): string => {
  if (invoer.kandidaten.length === 0) {
    return `Niemand is vrij op deze dag — dienst ${invoer.code} is alleen op te lossen door te schuiven met de planning.`;
  }
  const passend = invoer.kandidaten.filter((k) => k.past);
  if (passend.length > 0) {
    const eerste = passend[0];
    const delen: string[] = [];
    delen.push(eerste.dagenNaElkaar === 1 ? "geen aansluitende werkdagen" : `${eerste.dagenNaElkaar}e werkdag op rij`);
    const rusten = [eerste.rustVoor, eerste.rustNa].filter((r): r is number => r !== null);
    if (rusten.length > 0) delen.push(`rust ${formatUren(Math.min(...rusten))}`);
    delen.push(eerste.dagenDezeWeek === 0
      ? "nog geen werkdag deze week"
      : `${eerste.dagenDezeWeek} werkdag${eerste.dagenDezeWeek === 1 ? "" : "en"} deze week`);
    const tweede = passend[1];
    const staart = tweede
      ? ` ${tweede.name} is de logische tweede keuze.`
      : invoer.kandidaten.length > 1
        ? " Bij de rest past dit niet zonder een regel te breken."
        : "";
    return `Ik zou ${eerste.name} vragen — ${delen.join(", ")}.${staart}`;
  }
  if (invoer.kettingen.length > 0) {
    const k = invoer.kettingen[0];
    return `Niemand is vrij én passend voor dienst ${invoer.code}. Wél mogelijk via een ruil: laat ${k.naarNaam} dienst ${k.viaCode} (${k.viaTijden}) overnemen van ${k.vanNaam} — dan kan ${k.vanNaam} dienst ${invoer.code} rijden.`;
  }
  const dichtstbij = invoer.kandidaten[0];
  return `Dit past bij niemand zonder een regel te breken, en ook een ruil in één stap lost het niet op. ${dichtstbij.name} komt het dichtst in de buurt (${dichtstbij.redenen.join(" en ")}).`;
};
