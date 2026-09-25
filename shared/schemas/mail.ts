import { z } from './zod.js';

/**
 * Beheer › Mails (mailtranche PR 3, 25-09): welke automatische mails het
 * portaal verstuurt, welke daarvan een admin kan uitzetten, en de
 * verzendlijsten (naam + adressen) voor de mailknop op een omleiding en
 * het zelf versturen van een mail. Beide instellingen staan als één
 * jsonb-waarde in app_settings; alleen admins schrijven ze (PUT /api/mails/…).
 */

export const MAIL_INSTELLINGEN_KEY = 'mail_instellingen';
export const VERZENDLIJSTEN_KEY = 'verzendlijsten';

export interface MailSoortInfo {
  /** Sleutel zoals sendEmail hem logt (mail_log.soort). */
  soort: string;
  naam: string;
  wanneer: string;
  ontvangers: string;
  /** Er gaat ook een pushmelding uit. */
  push?: boolean;
  /** Kan niet uitgezet worden: zonder deze mail werkt het portaal niet of
   *  verlies je je vangnet (welkom, wachtwoord, back-up en herstel). */
  altijdAan?: boolean;
  /** Verstuurd door Supabase Auth, niet door de API (alleen ter informatie). */
  viaSupabase?: boolean;
}

/** Elke mail die het portaal kent, in de volgorde van het beheerscherm. */
export const MAIL_SOORTEN: readonly MailSoortInfo[] = [
  { soort: 'welkom', naam: 'Welkomstmail', wanneer: 'Bij een nieuw account', ontvangers: 'De nieuwe gebruiker', altijdAan: true },
  { soort: 'wachtwoord', naam: 'Wachtwoord vergeten', wanneer: 'Als iemand een nieuw wachtwoord vraagt', ontvangers: 'Die gebruiker', altijdAan: true, viaSupabase: true },
  { soort: 'verlof-beslissing', naam: 'Verlofbeslissing', wanneer: 'Bij goedkeuren, afwijzen of annuleren van verlof', ontvangers: 'De chauffeur van de aanvraag', push: true },
  { soort: 'ziekmelding', naam: 'Ziekmelding', wanneer: 'Als een planner iemand ziek meldt', ontvangers: 'Planners en admins, elk apart', push: true },
  { soort: 'dringende-update', naam: 'Dringende update', wanneer: 'Bij het publiceren van een dringende update', ontvangers: 'Alle actieve gebruikers met een e-mailadres', push: true },
  { soort: 'vervaldatum', naam: 'Vervaldatum document', wanneer: '90, 30, 7 en 0 dagen vóór het verlopen van Code 95 of medische schifting', ontvangers: 'De chauffeur zelf', push: true },
  { soort: 'weekoverzicht', naam: 'Weekoverzicht', wanneer: 'Elke maandag om 06:00: meldingen, cijfers van de week, vervaldata en openstaande diensten', ontvangers: 'Admins die systeemmail willen (of ALERT_EMAIL)' },
  { soort: 'testmail', naam: 'Testmail', wanneer: 'Op vraag, vanuit Systeemstatus', ontvangers: 'De admin zelf', altijdAan: true },
  { soort: 'backup-integriteit', naam: 'Back-up-integriteit', wanneer: 'Als de nachtelijke back-up de controle niet haalt', ontvangers: 'Admins die systeemmail willen (of ALERT_EMAIL)', altijdAan: true },
  { soort: 'backup-weekkopie', naam: 'Wekelijkse back-up', wanneer: 'Elke zondagnacht, versleuteld als bijlage', ontvangers: 'Admins die systeemmail willen (of ALERT_EMAIL)', altijdAan: true },
  { soort: 'restore-proef', naam: 'Restore-proef', wanneer: 'Elke eerste van de maand, alleen als het herstel faalt', ontvangers: 'Admins die systeemmail willen (of ALERT_EMAIL)', altijdAan: true },
];

export const MAIL_SOORT_PER_SLEUTEL: ReadonlyMap<string, MailSoortInfo> = new Map(MAIL_SOORTEN.map((m) => [m.soort, m]));

/** Soorten die een admin mag uitzetten. */
export const UITZETBARE_MAIL_SOORTEN: readonly string[] = MAIL_SOORTEN.filter((m) => !m.altijdAan).map((m) => m.soort);

export const mailInstellingenSchema = z.object({
  /** Mailsoorten die uit staan; alles wat er niet in staat is aan. */
  uit: z.array(z.string().trim().min(1)).max(50).default([]),
});
export type MailInstellingen = z.output<typeof mailInstellingenSchema>;
export const STANDAARD_MAIL_INSTELLINGEN: MailInstellingen = { uit: [] };

/** Onbekende invoer (db-jsonb) → geldige instellingen, anders alles aan.
 *  Soorten die altijd aan staan of onbekend zijn, vallen uit de lijst. */
export const parseMailInstellingen = (waarde: unknown): MailInstellingen => {
  const r = mailInstellingenSchema.safeParse(waarde);
  if (!r.success) return STANDAARD_MAIL_INSTELLINGEN;
  return { uit: [...new Set(r.data.uit.filter((s) => UITZETBARE_MAIL_SOORTEN.includes(s)))] };
};

/** Staat deze mailsoort aan? Onbekende soorten (bv. een nieuwe mail die nog
 *  niet in de lijst staat) zijn aan: een vergeten registratie mag nooit een
 *  mail tegenhouden. */
export const isMailAan = (instellingen: MailInstellingen, soort: string): boolean => {
  const info = MAIL_SOORT_PER_SLEUTEL.get(soort);
  if (!info || info.altijdAan) return true;
  return !instellingen.uit.includes(soort);
};

// --- Verzendlijsten ---

/** Bewust eenvoudig: iets vóór en iets ná een @, met een punt in het domein.
 *  De mailserver beslist verder; dit vangt tikfouten zoals een vergeten @. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailAdres = z
  .string({ error: 'Vul een e-mailadres in' })
  .trim()
  .toLowerCase()
  .regex(EMAIL_RE, 'Dit is geen geldig e-mailadres');

export const VERZENDLIJST_MAX_ADRESSEN = 200;
export const verzendlijstSchema = z.object({
  id: z.string().trim().min(1).max(64),
  naam: z.string({ error: 'Geef de lijst een naam' }).trim().min(1, 'Geef de lijst een naam').max(60, 'Hooguit 60 tekens'),
  adressen: z.array(emailAdres).max(VERZENDLIJST_MAX_ADRESSEN, `Hooguit ${VERZENDLIJST_MAX_ADRESSEN} adressen`),
});
export type Verzendlijst = z.output<typeof verzendlijstSchema>;

export const verzendlijstenSchema = z.array(verzendlijstSchema).max(50, 'Hooguit 50 lijsten');
export type Verzendlijsten = z.output<typeof verzendlijstenSchema>;

/** Onbekende invoer → geldige lijsten (dubbele adressen per lijst weg), anders leeg. */
export const parseVerzendlijsten = (waarde: unknown): Verzendlijsten => {
  const r = verzendlijstenSchema.safeParse(waarde);
  if (!r.success) return [];
  return r.data.map((l) => ({ ...l, adressen: [...new Set(l.adressen)] }));
};

/** Vrije invoer (één adres per regel, komma of puntkomma) → adressen en de
 *  regels die geen adres zijn. */
export const leesAdressen = (tekst: string): { adressen: string[]; fouten: string[] } => {
  const adressen: string[] = [];
  const fouten: string[] = [];
  for (const stuk of tekst.split(/[\n,;]+/)) {
    const a = stuk.trim().toLowerCase();
    if (!a) continue;
    if (EMAIL_RE.test(a)) { if (!adressen.includes(a)) adressen.push(a); } else fouten.push(stuk.trim());
  }
  return { adressen, fouten };
};

// --- Zelf een mail sturen (PR 5, alleen admin) ---

/** Sleutel in het verzendlog; staat niet in MAIL_SOORTEN (geen automatische mail). */
export const EIGEN_MAIL_SOORT = 'eigen-mail';
/** Namen voor logregels van soorten die niet in de registry staan. */
export const OMLEIDING_MAIL_SOORT = 'omleiding-mail';
export const EXTRA_SOORT_NAMEN: Readonly<Record<string, string>> = { [EIGEN_MAIL_SOORT]: 'Eigen mail', [OMLEIDING_MAIL_SOORT]: 'Omleiding gemaild' };
export const naamVanSoort = (soort: string): string => MAIL_SOORT_PER_SLEUTEL.get(soort)?.naam ?? EXTRA_SOORT_NAMEN[soort] ?? soort;

export const ONTVANGER_GROEPEN = ['chauffeurs', 'techniekers', 'planning'] as const;
export type OntvangerGroep = (typeof ONTVANGER_GROEPEN)[number];
export const GROEP_LABEL: Record<OntvangerGroep, string> = {
  chauffeurs: 'Alle chauffeurs',
  techniekers: 'Alle techniekers',
  planning: 'Alle planners en admins',
};

export const EIGEN_MAIL_ONDERWERP_MAX = 150;
export const EIGEN_MAIL_TEKST_MAX = 5000;

export const eigenMailOntvangersSchema = z.object({
  groepen: z.array(z.enum(ONTVANGER_GROEPEN)).max(3).default([]),
  /** Id's van verzendlijsten. */
  lijsten: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  /** Id's van bestaande gebruikers. */
  gebruikers: z.array(z.string().trim().min(1).max(64)).max(500).default([]),
  /** Vrij ingetypte adressen. */
  adressen: z.array(emailAdres).max(VERZENDLIJST_MAX_ADRESSEN, `Hooguit ${VERZENDLIJST_MAX_ADRESSEN} losse adressen`).default([]),
});

export const eigenMailSchema = z.object({
  onderwerp: z.string({ error: 'Vul een onderwerp in' }).trim().min(1, 'Vul een onderwerp in').max(EIGEN_MAIL_ONDERWERP_MAX, `Hooguit ${EIGEN_MAIL_ONDERWERP_MAX} tekens`),
  tekst: z.string({ error: 'Schrijf een bericht' }).trim().min(1, 'Schrijf een bericht').max(EIGEN_MAIL_TEKST_MAX, `Hooguit ${EIGEN_MAIL_TEKST_MAX} tekens`),
  ontvangers: eigenMailOntvangersSchema,
  /** true = alleen tonen wie de mail zou krijgen en hoe ze eruitziet. */
  droog: z.boolean().default(false),
});
export type EigenMail = z.output<typeof eigenMailSchema>;
export type EigenMailInvoer = z.input<typeof eigenMailSchema>;

// --- Een omleiding mailen (PR 4, planner en admin) ---

export const OMLEIDING_MAIL_BERICHT_MAX = 2000;
export const omleidingMailSchema = z.object({
  /** Verzendlijst-id's en vrije adressen; geen groepen (dit is extern gericht: De Lijn, garage). */
  ontvangers: z.object({
    lijsten: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
    adressen: z.array(emailAdres).max(VERZENDLIJST_MAX_ADRESSEN, `Hooguit ${VERZENDLIJST_MAX_ADRESSEN} losse adressen`).default([]),
  }),
  /** Vrije begeleidende tekst bovenaan de mail. */
  bericht: z.string().trim().max(OMLEIDING_MAIL_BERICHT_MAX, `Hooguit ${OMLEIDING_MAIL_BERICHT_MAX} tekens`).default(''),
  droog: z.boolean().default(false),
});
export type OmleidingMail = z.output<typeof omleidingMailSchema>;
export type OmleidingMailInvoer = z.input<typeof omleidingMailSchema>;
