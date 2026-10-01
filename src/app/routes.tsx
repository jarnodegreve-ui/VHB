import type { LucideIcon } from 'lucide-react';
import {
  Activity, AlertTriangle, Bell, Bus, BusFront, Calendar, CalendarCheck, CalendarCog, ClipboardList, FileText, FolderOpen,
  Hash, HeartPulse, History, IdCard, Inbox, LayoutDashboard, ListChecks, Map as MapIcon, MapPin, Palette, Phone, Plus, RotateCcw, Settings, Smartphone,
  Sun, Sunrise, Thermometer, Users, Wrench, Zap, CalendarCheck2, Coins, Route, FileBarChart, Mail } from 'lucide-react';
import type { Role, View } from '../types';
import { heeftRol, type Toegang } from '../../shared/toegang';

/**
 * Dé routetabel van het portaal — één bron voor: het pad in de URL, de
 * sidebar (sectie + icoon + label), de bottom-nav, de rol-guard en de titel
 * in de topbar. Voorheen stonden die lijsten los in App.tsx en BottomNav en
 * liepen ze uit elkaar (één scherm had drie namen).
 *
 * `pad` = de URL zonder leidende slash ('' = dashboard). Parameters komen
 * erachter als extra segmenten (`/bezetting/2026-03`), zie router.ts.
 */
export type Sectie = 'algemeen' | 'planning' | 'afwezigheid' | 'communicatie' | 'techniek' | 'systeem' | 'account';

export type RouteDef = {
  view: View;
  pad: string;
  /** Naam in navigatie én topbar — hetzelfde woord overal. */
  label: string;
  /** Korte naam voor de bottom-nav (valt terug op label). */
  kort?: string;
  /** Eén regel uitleg (instellingen-overzicht). */
  omschrijving: string;
  icoon: LucideIcon;
  sectie: Sectie;
  rollen: readonly Role[];
  /** Niet in de sidebar tonen (wel bereikbaar via URL). */
  verborgen?: boolean;
  /** Brede kolom (--content-max-breed i.p.v. --content-max): schermen met
   *  een matrix of brede tabel. Schil (topbar, #hoofdinhoud) en PageShell
   *  `breed` volgen hetzelfde veld, anders staat de kop smaller dan de inhoud. */
  breed?: boolean;
};

const IEDEREEN: readonly Role[] = ['chauffeur', 'technieker', 'planner', 'admin'];
const STAF: readonly Role[] = ['planner', 'admin'];
/** Rijdend personeel plus staf: alles wat met diensten en rooster te maken
 *  heeft. Een technieker heeft geen diensten, dus die schermen zijn voor hem
 *  leeg en staan niet in zijn menu (Jarno 09-09). */
const RIJDEND_EN_STAF: readonly Role[] = ['chauffeur', 'planner', 'admin'];
const ADMIN: readonly Role[] = ['admin'];
/** Garagewerk: de technieker plus staf (die plant de bussen in en volgt op).
 *  Een chauffeur met "Ook technieker" krijgt ze erbij (magView, sidebarRoutes). */
const TECHNIEK: readonly Role[] = ['technieker', 'planner', 'admin'];

export const ROUTES: readonly RouteDef[] = [
  // — Algemeen —
  { view: 'dashboard', pad: '', label: 'Dashboard', omschrijving: 'Vandaag in één oogopslag.', icoon: LayoutDashboard, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'mijn-dag', pad: 'mijn-dag', label: 'Mijn dag', omschrijving: 'Je dienst van vandaag of morgen, blok voor blok.', icoon: Sunrise, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  { view: 'rooster', pad: 'rooster', label: 'Rooster', omschrijving: 'Je komende diensten en export naar agenda.', icoon: Calendar, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  { view: 'omleidingen', pad: 'omleidingen', label: 'Omleidingen', omschrijving: 'Actuele omleidingen.', icoon: MapPin, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  { view: 'ritblaadjes', pad: 'ritbladen', label: 'Ritbladen', omschrijving: 'Actuele rit-informatie als PDF.', icoon: FileText, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  // 01-10 (Jarno): voor iedereen, ook de technieker (die test de filmkast na een herstelling).
  // Icoon: de voorkant van de bus, met het bord boven de voorruit (keuze Jarno 01-10; de
  // wegwijzer las niet op de maat van het menu). Bewust een andere bus dan Voertuigen (zijkant).
  { view: 'filmnummers', pad: 'filmnummers', label: 'Filmnummers', omschrijving: 'Het nummer dat je intoetst per bestemming.', icoon: BusFront, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'documenten', pad: 'documenten', label: 'Documenten', omschrijving: 'Documenten die de planning voor jou klaarzet.', icoon: FolderOpen, sectie: 'algemeen', rollen: ['chauffeur', 'technieker'] },
  { view: 'ruil-verzoeken', pad: 'dienstruil', label: 'Dienstruil', omschrijving: 'Ruil een dienst met een collega.', icoon: RotateCcw, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  { view: 'verlof', pad: 'verlof', label: 'Verlof', omschrijving: 'Vraag verlof aan en volg je aanvragen op.', icoon: CalendarCheck, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'updates', pad: 'updates', label: 'Updates', omschrijving: 'Nieuws en mededelingen.', icoon: Bell, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'meldingen', pad: 'meldingen', label: 'Meldingen', omschrijving: 'Wat er voor jou binnenkwam: planning, verlof, ruil en updates.', icoon: Inbox, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'contacten', pad: 'contacten', label: 'Contacten', omschrijving: 'Contactgegevens van alle medewerkers.', icoon: Phone, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'bezetting', pad: 'maandplanning', label: 'Maandplanning', omschrijving: 'Wie rijdt welke dienst, zoals in het chauffeurslokaal.', icoon: Users, sectie: 'algemeen', breed: true, rollen: RIJDEND_EN_STAF },
  // — Beheer › Planning —
  { view: 'vandaag', pad: 'vandaag', label: 'Vandaag', omschrijving: 'Afwezigen, open diensten, ruilen en omleidingen van één dag, met de weg naar de beslissing.', icoon: Sun, sectie: 'planning', rollen: STAF },
  { view: 'werkvoorraad', pad: 'overzicht', label: 'Overzicht', omschrijving: 'Alles wat op een beslissing van de planning wacht, op één scherm.', icoon: ListChecks, sectie: 'planning', rollen: STAF },
  { view: 'beheer-roosters', pad: 'beheer/planning', label: 'Beheer planning', omschrijving: 'Importeer en herbouw de planning.', icoon: CalendarCog, sectie: 'planning', rollen: STAF },
  { view: 'planning-matrix', pad: 'beheer/planningsoverzicht', label: 'Planningsoverzicht', omschrijving: 'Controleer de geïmporteerde matrix per dag en chauffeur.', icoon: FileText, sectie: 'planning', breed: true, rollen: STAF },
  { view: 'planning-codes', pad: 'beheer/planningscodes', label: 'Planningscodes', omschrijving: 'Betekenis van matrixcodes.', icoon: Hash, sectie: 'planning', rollen: STAF },
  // 3D (23-09): Dienstoverzicht en Beheer dienstoverzicht zijn één scherm,
  // alleen voor planner en admin; het oude pad /dienstoverzicht is een alias.
  { view: 'dienstoverzicht', pad: 'beheer/dienstoverzicht', label: 'Dienstoverzicht', omschrijving: 'Alle diensten, uren en loopnummers; hier onderhoud je ze.', icoon: Bus, sectie: 'planning', rollen: STAF },
  { view: 'dienstopbouw', pad: 'beheer/dienstopbouw', label: 'Dienstopbouw', omschrijving: 'Ritdelen per dienst uit de ET-export: controles, ritbladen en looncomponenten.', icoon: Route, sectie: 'planning', rollen: STAF },
  { view: 'dagafsluiting', pad: 'beheer/dagadministratie', label: 'Dagadministratie', omschrijving: 'Bevestig per dag wie wat werkelijk reed, met overminuten en premies.', icoon: CalendarCheck2, sectie: 'planning', rollen: STAF },
  { view: 'looncontrole', pad: 'beheer/looncontrole', label: 'Looncontrole', omschrijving: 'Maandstand, looncodes, matricules en de Easypay-export.', icoon: Coins, sectie: 'planning', breed: true, rollen: STAF },
  { view: 'dekking', pad: 'openstaande-diensten', label: 'Openstaande diensten', kort: 'Open diensten', omschrijving: 'Niet-ingevulde diensten per dag t.o.v. het dag-type.', icoon: AlertTriangle, sectie: 'planning', breed: true, rollen: STAF },
  // 30-09 (Jarno): Vervaldata stond onder Personeel.
  { view: 'vervaldata', pad: 'beheer/vervaldata', label: 'Vervaldata', omschrijving: 'Rijbewijzen, attesten en andere vervaldata.', icoon: IdCard, sectie: 'planning', rollen: STAF },
  // — Beheer › Afwezigheid (heette Personeel tot 30-09) —
  { view: 'verlof-kalender', pad: 'beheer/verlofkalender', label: 'Verlofkalender', omschrijving: 'Maandoverzicht van alle afwezigheden.', icoon: Calendar, sectie: 'afwezigheid', rollen: STAF },
  { view: 'ziekte', pad: 'beheer/ziekte', label: 'Ziekte', omschrijving: 'Ziekmeldingen en de diensten die daardoor open staan.', icoon: Thermometer, sectie: 'afwezigheid', rollen: STAF },
  // — Beheer › Communicatie —
  { view: 'beheer-updates', pad: 'beheer/updates', label: 'Beheer updates', omschrijving: 'Publiceer updates en dringende meldingen.', icoon: Plus, sectie: 'communicatie', rollen: STAF },
  { view: 'beheer-omleidingen', pad: 'beheer/omleidingen', label: 'Beheer omleidingen', omschrijving: 'Routewijzigingen en bijlagen voor chauffeurs.', icoon: MapIcon, sectie: 'communicatie', rollen: STAF },
  // 30-09 (Jarno): Mails stond onder Systeem; blijft alleen voor de admin.
  { view: 'beheer-mails', pad: 'beheer/mails', label: 'Mails', omschrijving: 'Welke mails het portaal verstuurt, verzendlijsten en het verzendlog.', icoon: Mail, sectie: 'communicatie', rollen: ADMIN },
  // — Techniek (fase A Access-migratie, 13-09) —
  { view: 'defecten', pad: 'techniek/defecten', label: 'Gele boek', omschrijving: 'Gemelde defecten per bus en hun opvolging.', icoon: Wrench, sectie: 'techniek', rollen: TECHNIEK },
  // 24-09 (B, Jarno): heette Dagadministratie, net als het loonscherm; twee schermen met één naam.
  { view: 'werkprestaties', pad: 'techniek/prestaties', label: 'Werkprestaties', omschrijving: 'Wat de garage per dag aan welke bus deed, dag per dag ingegeven.', icoon: ClipboardList, sectie: 'techniek', rollen: TECHNIEK },
  { view: 'voertuig-werken', pad: 'techniek/werken', label: 'Uitgevoerde werken per bus', kort: 'Per bus', omschrijving: 'De volledige werkgeschiedenis van één bus, wie het deed en hoelang het duurde.', icoon: History, sectie: 'techniek', rollen: TECHNIEK },
  { view: 'voertuigen', pad: 'techniek/voertuigen', label: 'Voertuigen', omschrijving: 'Het wagenpark met keuringen en vervaldata.', icoon: Bus, sectie: 'techniek', rollen: TECHNIEK },
  // — Systeem —
  // Rapporten (20-09): één plek voor alle overzichten, zoals het rapportenmenu
  // in Access. Catalogus op /rapporten, één rapport op /rapporten/<domein>/<id>
  // met de filters in de querystring (register in shared/rapporten). Was een
  // eigen sectie tot 30-09 (Jarno); blijft ook voor de planner, die onder
  // Systeem dus alleen Rapporten ziet.
  { view: 'rapporten', pad: 'rapporten', label: 'Rapporten', omschrijving: 'Alle overzichten op één plek: filteren, afdrukken en exporteren.', icoon: FileBarChart, sectie: 'systeem', breed: true, rollen: STAF },
  { view: 'gebruikers', pad: 'beheer/gebruikers', label: 'Gebruikers', omschrijving: 'Accounts, rollen en toegang.', icoon: Users, sectie: 'systeem', rollen: ADMIN },
  { view: 'toestellen', pad: 'beheer/toestellen', label: 'Toestellen', omschrijving: 'Keur toestellen goed of blokkeer ze.', icoon: Smartphone, sectie: 'systeem', rollen: ADMIN },
  { view: 'activiteit', pad: 'beheer/activiteit', label: 'Activiteit', omschrijving: 'Recente beheeracties en aanmeldingen.', icoon: Activity, sectie: 'systeem', breed: true, rollen: ADMIN },
  { view: 'ocpi-monitoring', pad: 'beheer/laadplein', label: 'Laadplein', omschrijving: 'Live status, maandrapport, historiek en sessies van de laadpalen (ChargEye).', icoon: Zap, sectie: 'systeem', rollen: ADMIN },
  { view: 'designsysteem', pad: 'beheer/designsysteem', label: 'Designsysteem', omschrijving: 'Alle bouwstenen, tokens en toestanden op één pagina.', icoon: Palette, sectie: 'systeem', rollen: ADMIN },
  { view: 'beheer-debug', pad: 'beheer/systeemstatus', label: 'Systeemstatus', omschrijving: 'Koppelingen, tabellen en health checks.', icoon: HeartPulse, sectie: 'systeem', rollen: ADMIN },
  // — Account —
  { view: 'instellingen', pad: 'instellingen', label: 'Instellingen', omschrijving: 'Thema, meldingen, wachtwoord en agenda-koppeling.', icoon: Settings, sectie: 'account', rollen: IEDEREEN, verborgen: true },
];

const PER_VIEW = new Map<View, RouteDef>(ROUTES.map((r) => [r.view, r]));
const PER_PAD = new Map<string, RouteDef>(ROUTES.map((r) => [r.pad, r]));

/** Hernoemde paden: het oude pad blijft naar dezelfde view wijzen, zodat
 *  bladwijzers en de `doel`-link van meldingen die al verstuurd zijn niet
 *  in een 'pagina niet gevonden' eindigen. */
const OUDE_PADEN = new Map<string, string>([
  // 21-09: het scherm heet in de app al "Overzicht"; het pad zei nog werkvoorraad.
  ['werkvoorraad', 'overzicht'],
  // 22-09: Beheer roosters heet Beheer planning, Dagafsluiting heet Dagadministratie.
  ['beheer/roosters', 'beheer/planning'],
  ['beheer/dagafsluiting', 'beheer/dagadministratie'],
  // 23-09 (3D): Dienstoverzicht en Beheer dienstoverzicht samengevoegd.
  ['dienstoverzicht', 'beheer/dienstoverzicht'],
  // 30-09: Laadpalen heet Laadplein.
  ['beheer/laadpalen', 'beheer/laadplein'],
]);

/** Verdwenen view-sleutels (in `?view=` van oude pushberichten of het
 *  onthouden laatste scherm) en de view die hun plaats nam. */
const OUDE_VIEWS = new Map<string, View>([
  ['beheer-dienstoverzicht', 'dienstoverzicht'],
]);

export const routeVan = (view: View): RouteDef => PER_VIEW.get(view) ?? ROUTES[0];
export const routeVanPad = (pad: string): RouteDef | undefined => {
  const direct = PER_PAD.get(pad);
  if (direct) return direct;
  const nieuwPad = OUDE_PADEN.get(pad);
  return nieuwPad ? PER_PAD.get(nieuwPad) : undefined;
};

/** Alle views die voor minstens één rol bestaan (whitelist voor deeplinks). */
export const ALLE_VIEWS: readonly View[] = ROUTES.map((r) => r.view);

/** Een view-sleutel van buiten (URL, localStorage) naar een bestaande view:
 *  bekend = zichzelf, verdwenen = zijn opvolger, anders null. */
export const bekendeView = (sleutel: string | null | undefined): View | null => {
  if (!sleutel) return null;
  if ((ALLE_VIEWS as readonly string[]).includes(sleutel)) return sleutel as View;
  return OUDE_VIEWS.get(sleutel) ?? null;
};

/** Een rol, of een persoon: dan telt "Ook technieker" mee (shared/toegang.ts). */
type Wie = Role | Toegang;
const alsToegang = (wie: Wie): Toegang => (typeof wie === 'string' ? { role: wie } : wie);

export const magView = (wie: Wie, view: View): boolean => heeftRol(alsToegang(wie), routeVan(view).rollen);

/** Brede kolom voor dit scherm? (zie RouteDef.breed) */
export const isBreed = (view: View): boolean => routeVan(view).breed === true;

/** Sectiewoord voor de desktop-topbar: hetzelfde woord als de zijbalk
 *  (Beheer › Planning/Afwezigheid/Communicatie, Techniek, Systeem). 'algemeen'
 *  heeft er geen: die schermen staan los bovenaan het menu en "Algemeen"
 *  boven een dashboard zegt niets (de scroll-titel doet daar het werk). Een
 *  geopend rapport zet zelf "Rapporten · <domein>" boven zijn titel. */
const SECTIE_LABEL: Record<Sectie, string | null> = {
  algemeen: null,
  planning: 'Beheer · Planning',
  afwezigheid: 'Beheer · Afwezigheid',
  communicatie: 'Beheer · Communicatie',
  techniek: 'Techniek',
  systeem: 'Systeem',
  account: 'Account',
};
export const sectieLabel = (view: View): string | null => SECTIE_LABEL[routeVan(view).sectie];

/** Routes voor de sidebar van een rol of persoon, gegroepeerd per sectie. */
export const sidebarRoutes = (wie: Wie, sectie: Sectie): RouteDef[] =>
  ROUTES.filter((r) => r.sectie === sectie && heeftRol(alsToegang(wie), r.rollen) && !r.verborgen);

/** Pad van een view (met optionele parameters), voor href's en pushState. */
export const padVan = (view: View, params: readonly string[] = []): string => {
  const basis = routeVan(view).pad;
  const extra = params.filter(Boolean).map(encodeURIComponent).join('/');
  return '/' + [basis, extra].filter(Boolean).join('/');
};
