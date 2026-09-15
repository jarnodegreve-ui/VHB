import type { LucideIcon } from 'lucide-react';
import {
  Activity, AlertTriangle, Bell, Bus, Calendar, CalendarCheck, CalendarCog, ClipboardList, FileText, FolderOpen,
  Hash, HeartPulse, IdCard, Inbox, LayoutDashboard, ListChecks, Map as MapIcon, MapPin, Palette, Phone, Plus, RotateCcw, Settings, Smartphone,
  Sunrise, Thermometer, Users, Wrench, Zap, CalendarCheck2, Coins, Route } from 'lucide-react';
import type { Role, View } from '../types';

/**
 * Dé routetabel van het portaal — één bron voor: het pad in de URL, de
 * sidebar (sectie + icoon + label), de bottom-nav, het command palette, de
 * rol-guard en de titel in de topbar. Voorheen stonden die zes lijsten los
 * in App.tsx/BottomNav/CommandPalette en liepen ze uit elkaar (één scherm
 * had drie namen).
 *
 * `pad` = de URL zonder leidende slash ('' = dashboard). Parameters komen
 * erachter als extra segmenten (`/bezetting/2026-03`), zie router.ts.
 */
export type Sectie = 'algemeen' | 'planning' | 'mensen' | 'communicatie' | 'techniek' | 'systeem' | 'account';

export type RouteDef = {
  view: View;
  pad: string;
  /** Naam in navigatie én topbar — hetzelfde woord overal. */
  label: string;
  /** Korte naam voor de bottom-nav (valt terug op label). */
  kort?: string;
  /** Eén regel uitleg (command palette, instellingen-overzicht). */
  omschrijving: string;
  icoon: LucideIcon;
  sectie: Sectie;
  rollen: readonly Role[];
  /** Niet in de sidebar tonen (wel bereikbaar via URL/palette). */
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
/** Garagewerk: de technieker plus staf (die plant de bussen in en volgt op). */
const TECHNIEK: readonly Role[] = ['technieker', 'planner', 'admin'];

export const ROUTES: readonly RouteDef[] = [
  // — Algemeen —
  { view: 'dashboard', pad: '', label: 'Dashboard', omschrijving: 'Vandaag in één oogopslag.', icoon: LayoutDashboard, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'mijn-dag', pad: 'mijn-dag', label: 'Mijn dag', omschrijving: 'Je dienst van vandaag of morgen, blok voor blok.', icoon: Sunrise, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  { view: 'rooster', pad: 'rooster', label: 'Rooster', omschrijving: 'Je komende diensten en export naar agenda.', icoon: Calendar, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  { view: 'omleidingen', pad: 'omleidingen', label: 'Omleidingen', omschrijving: 'Actuele omleidingen.', icoon: MapPin, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  { view: 'ritblaadjes', pad: 'ritbladen', label: 'Ritbladen', omschrijving: 'Actuele rit-informatie als PDF.', icoon: FileText, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  { view: 'documenten', pad: 'documenten', label: 'Documenten', omschrijving: 'Documenten die de planning voor jou klaarzet.', icoon: FolderOpen, sectie: 'algemeen', rollen: ['chauffeur', 'technieker'] },
  { view: 'ruil-verzoeken', pad: 'dienstruil', label: 'Dienstruil', omschrijving: 'Ruil een dienst met een collega.', icoon: RotateCcw, sectie: 'algemeen', rollen: RIJDEND_EN_STAF },
  { view: 'verlof', pad: 'verlof', label: 'Verlof', omschrijving: 'Vraag verlof aan en volg je aanvragen op.', icoon: CalendarCheck, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'updates', pad: 'updates', label: 'Updates', omschrijving: 'Nieuws en mededelingen.', icoon: Bell, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'meldingen', pad: 'meldingen', label: 'Meldingen', omschrijving: 'Wat er voor jou binnenkwam: planning, verlof, ruil en updates.', icoon: Inbox, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'contacten', pad: 'contacten', label: 'Contacten', omschrijving: 'Contactgegevens van alle medewerkers.', icoon: Phone, sectie: 'algemeen', rollen: IEDEREEN },
  { view: 'bezetting', pad: 'maandplanning', label: 'Maandplanning', omschrijving: 'Wie rijdt welke dienst, zoals in het chauffeurslokaal.', icoon: Users, sectie: 'algemeen', breed: true, rollen: RIJDEND_EN_STAF },
  // — Beheer › Planning —
  { view: 'werkvoorraad', pad: 'werkvoorraad', label: 'Overzicht', omschrijving: 'Alles wat op een beslissing van de planning wacht, op één scherm.', icoon: ListChecks, sectie: 'planning', rollen: STAF },
  { view: 'beheer-roosters', pad: 'beheer/roosters', label: 'Beheer roosters', omschrijving: 'Importeer en herbouw de planning.', icoon: CalendarCog, sectie: 'planning', rollen: STAF },
  { view: 'planning-matrix', pad: 'beheer/planningsoverzicht', label: 'Planningsoverzicht', omschrijving: 'Controleer de geïmporteerde matrix per dag en chauffeur.', icoon: FileText, sectie: 'planning', breed: true, rollen: STAF },
  { view: 'planning-codes', pad: 'beheer/planningscodes', label: 'Planningscodes', omschrijving: 'Betekenis van matrixcodes.', icoon: Hash, sectie: 'planning', rollen: STAF },
  { view: 'dienstoverzicht', pad: 'dienstoverzicht', label: 'Dienstoverzicht', omschrijving: 'Alle diensten, uren en blokken.', icoon: Bus, sectie: 'planning', rollen: STAF },
  { view: 'beheer-dienstoverzicht', pad: 'beheer/dienstoverzicht', label: 'Beheer dienstoverzicht', omschrijving: 'Onderhoud het dienstschema.', icoon: ClipboardList, sectie: 'planning', rollen: STAF },
  { view: 'dienstopbouw', pad: 'beheer/dienstopbouw', label: 'Dienstopbouw', omschrijving: 'Ritdelen per dienst uit de ET-export: controles, ritbladen en looncomponenten.', icoon: Route, sectie: 'planning', rollen: STAF },
  { view: 'dagafsluiting', pad: 'beheer/dagafsluiting', label: 'Dagafsluiting', omschrijving: 'Bevestig per dag wie wat werkelijk reed, met overminuten en premies.', icoon: CalendarCheck2, sectie: 'planning', rollen: STAF },
  { view: 'looncontrole', pad: 'beheer/looncontrole', label: 'Looncontrole', omschrijving: 'Maandstand, looncodes, matricules en de Easypay-export.', icoon: Coins, sectie: 'planning', breed: true, rollen: STAF },
  { view: 'dekking', pad: 'openstaande-diensten', label: 'Openstaande diensten', kort: 'Open diensten', omschrijving: 'Niet-ingevulde diensten per dag t.o.v. het dag-type.', icoon: AlertTriangle, sectie: 'planning', breed: true, rollen: STAF },
  // — Beheer › Mensen —
  { view: 'verlof-kalender', pad: 'beheer/verlofkalender', label: 'Verlofkalender', omschrijving: 'Maandoverzicht van alle afwezigheden.', icoon: Calendar, sectie: 'mensen', rollen: STAF },
  { view: 'ziekte', pad: 'beheer/ziekte', label: 'Ziekte', omschrijving: 'Ziekmeldingen en de diensten die daardoor open staan.', icoon: Thermometer, sectie: 'mensen', rollen: STAF },
  { view: 'vervaldata', pad: 'beheer/vervaldata', label: 'Vervaldata', omschrijving: 'Rijbewijzen, attesten en andere vervaldata.', icoon: IdCard, sectie: 'mensen', rollen: STAF },
  // — Beheer › Communicatie —
  { view: 'beheer-updates', pad: 'beheer/updates', label: 'Beheer updates', omschrijving: 'Publiceer updates en dringende meldingen.', icoon: Plus, sectie: 'communicatie', rollen: STAF },
  { view: 'beheer-omleidingen', pad: 'beheer/omleidingen', label: 'Beheer omleidingen', omschrijving: 'Routewijzigingen en bijlagen voor chauffeurs.', icoon: MapIcon, sectie: 'communicatie', rollen: STAF },
  // — Techniek (fase A Access-migratie, 13-09) —
  { view: 'defecten', pad: 'techniek/defecten', label: 'Gele boek', omschrijving: 'Gemelde defecten per bus en hun opvolging.', icoon: Wrench, sectie: 'techniek', rollen: TECHNIEK },
  { view: 'werkprestaties', pad: 'techniek/prestaties', label: 'Werkprestaties', kort: 'Prestaties', omschrijving: 'Wat de garage per dag aan welke bus deed.', icoon: ClipboardList, sectie: 'techniek', rollen: TECHNIEK },
  { view: 'voertuigen', pad: 'techniek/voertuigen', label: 'Voertuigen', omschrijving: 'Het wagenpark met keuringen en vervaldata.', icoon: Bus, sectie: 'techniek', rollen: TECHNIEK },
  // — Systeem —
  { view: 'gebruikers', pad: 'beheer/gebruikers', label: 'Gebruikers', omschrijving: 'Accounts, rollen en toegang.', icoon: Users, sectie: 'systeem', rollen: ADMIN },
  { view: 'toestellen', pad: 'beheer/toestellen', label: 'Toestellen', omschrijving: 'Keur toestellen goed of blokkeer ze.', icoon: Smartphone, sectie: 'systeem', rollen: ADMIN },
  { view: 'activiteit', pad: 'beheer/activiteit', label: 'Activiteit', omschrijving: 'Recente beheeracties en aanmeldingen.', icoon: Activity, sectie: 'systeem', breed: true, rollen: ADMIN },
  { view: 'ocpi-monitoring', pad: 'beheer/laadpalen', label: 'Laadpalen', kort: 'Laadpalen', omschrijving: 'Live status, maandrapport, historiek en sessies van de laadpalen (ChargEye).', icoon: Zap, sectie: 'systeem', rollen: ADMIN },
  { view: 'designsysteem', pad: 'beheer/designsysteem', label: 'Designsysteem', omschrijving: 'Alle bouwstenen, tokens en toestanden op één pagina.', icoon: Palette, sectie: 'systeem', rollen: ADMIN },
  { view: 'beheer-debug', pad: 'beheer/systeemstatus', label: 'Systeemstatus', omschrijving: 'Koppelingen, tabellen en health checks.', icoon: HeartPulse, sectie: 'systeem', rollen: ADMIN },
  // — Account —
  { view: 'instellingen', pad: 'instellingen', label: 'Instellingen', omschrijving: 'Thema, meldingen, wachtwoord en agenda-koppeling.', icoon: Settings, sectie: 'account', rollen: IEDEREEN, verborgen: true },
];

const PER_VIEW = new Map<View, RouteDef>(ROUTES.map((r) => [r.view, r]));
const PER_PAD = new Map<string, RouteDef>(ROUTES.map((r) => [r.pad, r]));

export const routeVan = (view: View): RouteDef => PER_VIEW.get(view) ?? ROUTES[0];
export const routeVanPad = (pad: string): RouteDef | undefined => PER_PAD.get(pad);

/** Alle views die voor minstens één rol bestaan (whitelist voor deeplinks). */
export const ALLE_VIEWS: readonly View[] = ROUTES.map((r) => r.view);

export const magView = (rol: Role, view: View): boolean => routeVan(view).rollen.includes(rol);

/** Brede kolom voor dit scherm? (zie RouteDef.breed) */
export const isBreed = (view: View): boolean => routeVan(view).breed === true;

/** Sectiewoord voor de desktop-topbar: hetzelfde woord als de zijbalk
 *  (Beheer › Planning/Mensen/Communicatie, Techniek, Systeem). 'algemeen'
 *  heeft er geen: die schermen staan los bovenaan het menu en "Algemeen"
 *  boven een dashboard zegt niets (de scroll-titel doet daar het werk). */
const SECTIE_LABEL: Record<Sectie, string | null> = {
  algemeen: null,
  planning: 'Beheer · Planning',
  mensen: 'Beheer · Mensen',
  communicatie: 'Beheer · Communicatie',
  techniek: 'Techniek',
  systeem: 'Systeem',
  account: 'Account',
};
export const sectieLabel = (view: View): string | null => SECTIE_LABEL[routeVan(view).sectie];

/** Routes voor de sidebar van een rol, gegroepeerd per sectie. */
export const sidebarRoutes = (rol: Role, sectie: Sectie): RouteDef[] =>
  ROUTES.filter((r) => r.sectie === sectie && r.rollen.includes(rol) && !r.verborgen);

/** Pad van een view (met optionele parameters), voor href's en pushState. */
export const padVan = (view: View, params: readonly string[] = []): string => {
  const basis = routeVan(view).pad;
  const extra = params.filter(Boolean).map(encodeURIComponent).join('/');
  return '/' + [basis, extra].filter(Boolean).join('/');
};
