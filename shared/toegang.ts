/**
 * Toegang per persoon (28-09): de rol, plus de schakelaar "Ook technieker"
 * die een admin in Gebruikers zet voor een chauffeur die ook in de garage
 * werkt. Zo'n chauffeur houdt alles van zijn rol (planning, rooster,
 * dienstruil, loon, verlofbezetting) en krijgt erbij wat een technieker mag:
 * het techniekgedeelte in de app en de API, de techniekmeldingen en een
 * plaats in de keuzelijsten van mecaniciens.
 *
 * Twee maten, bewust gescheiden:
 * - toegang en ontvangers (mag deze persoon X, wie krijgt die melding):
 *   `heeftRol` en `isTechnieker` hieronder;
 * - wie iemand ís (rijdend personeel, onderbalk, dashboardtegels, de poort):
 *   gewoon `role`. Een chauffeur met de schakelaar blijft daar een chauffeur.
 *
 * Zonder imports en zonder zod: routes.tsx zit in de startbundel.
 */
export type Toegang = { role: string; ookTechnieker?: boolean };

/** Technieker van rol, of chauffeur met de schakelaar aan. De schakelaar
 *  telt alleen bij een chauffeur; sanitizeIncomingUser zet hem voor elke
 *  andere rol uit. */
export const isTechnieker = (wie: Toegang): boolean =>
  wie.role === 'technieker' || (wie.role === 'chauffeur' && wie.ookTechnieker === true);

/** Heeft deze persoon één van deze rollen? "Ook technieker" telt als de rol
 *  technieker. De basis van requireRole (API) en magView (app). */
export const heeftRol = (wie: Toegang, rollen: readonly string[]): boolean =>
  rollen.includes(wie.role) || (rollen.includes('technieker') && isTechnieker(wie));

/**
 * Het systeemaccount "beheerder" is een technisch account, geen medewerker:
 * het hoort niet in lijsten van chauffeurs, contacten, verlof of rapporten.
 *
 * Eén herkenning voor app en API. Vroeger stond die op 23 plekken inline, in
 * drie schrijfwijzen (alleen kleine letters, met of zonder trim), waardoor
 * een naam met een spatie errond in het ene scherm wegviel en in het andere
 * niet. De regel hier is de ruimste van die drie: spaties vooraan en
 * achteraan weg, hoofdletters tellen niet. Accenten worden bewust NIET
 * weggewerkt: geen enkele oude variant deed dat, en "Behéérder" is dus een
 * andere naam.
 *
 * Bewust hier en niet in een eigen module: dit bestand zit al in de
 * startbundel, een eigen module werd een aparte chunk van 132 bytes die elf
 * schermen elk apart ophaalden (gemeten: warmup chauffeur +0,08 kB).
 */
export const isSysteemAccount = (naam: unknown): boolean =>
  String(naam ?? '').trim().toLowerCase() === 'beheerder';
