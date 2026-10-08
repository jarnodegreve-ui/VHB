/**
 * Dienstregelingversies (fase 1, 08-10-2026). De dienstregeling van De Lijn
 * wijzigt om de paar maanden terwijl de dienstnummers gelijk blijven; het
 * dienstoverzicht bestaat daarom in versies met een geldig-vanaf-datum. Hier
 * staan de regels die de server (planning-opbouw, API) en de browser (het
 * scherm, de vergelijking) delen. Zuiver: geen zod, geen I/O.
 */

export type VersieKern = { id: string; geldigVanaf: string };

const opDatum = <V extends VersieKern>(versies: readonly V[]): V[] =>
  [...versies].sort((a, b) => a.geldigVanaf.localeCompare(b.geldigVanaf) || a.id.localeCompare(b.id));

/** De oudste versie (de kleinste geldig-vanaf), of null zonder versies. */
export const oudsteVersie = <V extends VersieKern>(versies: readonly V[]): V | null => opDatum(versies)[0] ?? null;

/**
 * De versie die op `datum` (JJJJ-MM-DD) geldt: de grootste geldigVanaf die
 * niet na die dag ligt. Vóór de eerste versie geldt de eerste, zodat het
 * verleden van vóór de invoering aan de toenmalige lijst blijft hangen.
 */
export function versieVoorDatum<V extends VersieKern>(versies: readonly V[], datum: string): V | null {
  const gesorteerd = opDatum(versies);
  if (gesorteerd.length === 0) return null;
  let gekozen = gesorteerd[0];
  for (const v of gesorteerd) if (v.geldigVanaf <= datum) gekozen = v;
  return gekozen;
}

/** Hoort een dienst bij deze versie? Een rij zonder versie telt als de oudste. */
export const hoortBijVersie = (
  dienst: { dienstregelingId?: string | null },
  versieId: string,
  oudsteId: string | null,
): boolean => (dienst.dienstregelingId ?? oudsteId) === versieId;

export type VersieStatus = 'verlopen' | 'huidig' | 'toekomstig';

/** Verlopen (een latere versie geldt al), huidig (geldt vandaag) of toekomstig. */
export function versieStatus<V extends VersieKern>(versies: readonly V[], versie: VersieKern, vandaag: string): VersieStatus {
  const huidig = versieVoorDatum(versies, vandaag);
  if (huidig?.id === versie.id) return 'huidig';
  return versie.geldigVanaf > vandaag ? 'toekomstig' : 'verlopen';
}

/** De dag vóór de volgende versie, of null als dit de laatste is. */
export function versieGeldigTot<V extends VersieKern>(versies: readonly V[], versie: VersieKern): string | null {
  const volgende = opDatum(versies).find((v) => v.geldigVanaf > versie.geldigVanaf);
  return volgende ? dagVoor(volgende.geldigVanaf) : null;
}

/** 'JJJJ-MM-DD' van de dag ervoor (UTC-rekenwerk, de invoer is een kalenderdag). */
export const dagVoor = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const dmj = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** Naam van de versie, of "Vanaf dd/mm/jjjj" zonder naam. */
export const versieLabel = (v: { naam?: string | null; geldigVanaf: string }): string =>
  (v.naam ?? '').trim() || `Vanaf ${dmj(v.geldigVanaf)}`;

// --- Vergelijking van twee versies --------------------------------------------

/** De velden van een dienst waar de planning-opbouw naar kijkt. */
export const DIENST_VELDEN = [
  'startTime', 'endTime', 'loopnr',
  'startTime2', 'endTime2', 'loopnr2',
  'startTime3', 'endTime3', 'loopnr3',
] as const;
export type DienstVeld = (typeof DIENST_VELDEN)[number];

export const DIENST_VELD_LABEL: Record<DienstVeld, string> = {
  startTime: 'start deel 1', endTime: 'einde deel 1', loopnr: 'loop deel 1',
  startTime2: 'start deel 2', endTime2: 'einde deel 2', loopnr2: 'loop deel 2',
  startTime3: 'start deel 3', endTime3: 'einde deel 3', loopnr3: 'loop deel 3',
};

export type DienstKern = { serviceNumber: string } & Partial<Record<DienstVeld, string | null | undefined>>;

export type DienstVerschil = {
  nummer: string;
  /** De dienst in de oudere versie (null = bestond daar niet). */
  oud: DienstKern | null;
  /** De dienst in de nieuwere versie (null = bestaat daar niet meer). */
  nieuw: DienstKern | null;
  /** Welke velden verschillen (leeg bij nieuw/weg). */
  velden: DienstVeld[];
};

export type Vergelijking = {
  gewijzigd: DienstVerschil[];
  nieuw: DienstVerschil[];
  weg: DienstVerschil[];
  ongewijzigd: number;
};

/** Dienstnummer als sleutel: spaties en hoofdletters tellen niet ('2101 ' = '2101'). */
export const dienstSleutel = (nummer: string | null | undefined): string => String(nummer ?? '').trim().toLowerCase();

const waarde = (d: DienstKern, veld: DienstVeld): string => String(d[veld] ?? '').trim();

const perNummer = (diensten: readonly DienstKern[]): Map<string, DienstKern> => {
  const m = new Map<string, DienstKern>();
  // Dubbele nummers: de laatste wint, zoals in de planning-opbouw.
  for (const d of diensten) { const k = dienstSleutel(d.serviceNumber); if (k) m.set(k, d); }
  return m;
};

const opNummer = (a: DienstVerschil, b: DienstVerschil) => a.nummer.localeCompare(b.nummer, 'nl', { numeric: true });

/**
 * Wat verandert er van `oud` naar `nieuw`? Per dienstnummer: gewijzigd (met
 * de velden die verschillen), nieuw (alleen in `nieuw`) of weg (alleen in
 * `oud`). Het controleblad voor een nieuwe dienstregeling.
 */
export function vergelijkDiensten(oud: readonly DienstKern[], nieuw: readonly DienstKern[]): Vergelijking {
  const was = perNummer(oud);
  const wordt = perNummer(nieuw);
  const uit: Vergelijking = { gewijzigd: [], nieuw: [], weg: [], ongewijzigd: 0 };
  for (const [k, d] of wordt) {
    const vorige = was.get(k);
    if (!vorige) { uit.nieuw.push({ nummer: d.serviceNumber.trim(), oud: null, nieuw: d, velden: [] }); continue; }
    const velden = DIENST_VELDEN.filter((veld) => waarde(vorige, veld) !== waarde(d, veld));
    if (velden.length === 0) { uit.ongewijzigd += 1; continue; }
    uit.gewijzigd.push({ nummer: d.serviceNumber.trim(), oud: vorige, nieuw: d, velden });
  }
  for (const [k, d] of was) {
    if (!wordt.has(k)) uit.weg.push({ nummer: d.serviceNumber.trim(), oud: d, nieuw: null, velden: [] });
  }
  uit.gewijzigd.sort(opNummer); uit.nieuw.sort(opNummer); uit.weg.sort(opNummer);
  return uit;
}
