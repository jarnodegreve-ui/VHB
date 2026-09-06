import { useCallback, useEffect, useRef, useState } from 'react';
import { LEGE_DASHBOARD_VOORKEUREN, parseDashboardVoorkeuren, type DashboardVoorkeuren } from '../../shared/schemas/dashboardVoorkeuren';
import type { User } from '../types';
import { apiFetch } from './api';
import { notify } from './ui';

/**
 * Dashboard op maat (next-level 2, 06-09): tegels hebben een stabiel id,
 * een gebruiker verbergt ze of wijzigt de volgorde. De catalogus per rol
 * staat hier; de views (DashboardView, PlannerDashboardWidgets) renderen
 * hun tegels in de volgorde die `pasVoorkeurenToe` teruggeeft.
 *
 * Opslag: users.dashboardvoorkeuren via PATCH /api/me/voorkeuren (bron),
 * localStorage als terugval zolang de save niet gelukt is (offline,
 * migratie nog niet gedraaid). Onbekende ids (tegel hernoemd/verdwenen)
 * worden genegeerd; essentiële tegels zijn nooit te verbergen.
 */
export type TegelDef = {
  id: string;
  label: string;
  /** Korte uitleg onder het label in de aanpas-lijst. */
  omschrijving?: string;
  /** Niet te verbergen (wel te verplaatsen). */
  essentieel?: boolean;
  /** Groepskop in de aanpas-lijst ('Tegels' / 'Panelen'). */
  groep: 'tegels' | 'panelen';
};

export const CHAUFFEUR_TEGELS: readonly TegelDef[] = [
  { id: 'vandaag', label: 'Vandaag', omschrijving: 'Je dienst van vandaag met de dienstbalk.', essentieel: true, groep: 'tegels' },
  { id: 'volgende-dienst', label: 'Volgende dienst', omschrijving: 'Dienstnummer, dag en delen.', groep: 'tegels' },
  { id: 'verlofsaldo', label: 'Verlofsaldo', omschrijving: 'Dagen over dit jaar.', groep: 'tegels' },
  { id: 'deze-maand', label: 'Deze maand', omschrijving: 'Aantal ingeplande diensten.', groep: 'tegels' },
  { id: 'omleidingen', label: 'Omleidingen', omschrijving: 'Aantal actieve omleidingen.', groep: 'tegels' },
  { id: 'komende-diensten', label: 'Komende diensten', omschrijving: 'De eerstvolgende drie diensten.', groep: 'panelen' },
  { id: 'omleidingen-paneel', label: 'Omleidingen (lijst)', omschrijving: 'De nieuwste actieve omleidingen.', groep: 'panelen' },
  { id: 'snelle-acties', label: 'Snelle acties', omschrijving: 'Snelkoppelingen onderaan (alleen op de telefoon).', groep: 'panelen' },
];

export const PLANNER_TEGELS: readonly TegelDef[] = [
  { id: 'chauffeurs-actief', label: 'Chauffeurs actief', omschrijving: 'Nu aan het rijden; morgen: de eerste start.', groep: 'tegels' },
  { id: 'ingepland', label: 'Ingepland', omschrijving: 'Chauffeurs met dienst vandaag of morgen.', groep: 'tegels' },
  { id: 'beschikbaar', label: 'Beschikbaar', omschrijving: 'Vrij en inzetbaar.', groep: 'tegels' },
  { id: 'afwezig', label: 'Afwezig', omschrijving: 'Ziek en verlof.', groep: 'tegels' },
  { id: 'omleidingen', label: 'Omleidingen', omschrijving: 'Aantal actieve omleidingen.', groep: 'tegels' },
  { id: 'laadplein', label: 'Aan de lader', omschrijving: 'Alleen zichtbaar met OCPI-data.', groep: 'tegels' },
  { id: 'open-taken', label: 'Open taken', omschrijving: 'De werkvoorraad van de planner.', essentieel: true, groep: 'panelen' },
  { id: 'activiteit', label: 'Live activiteit', omschrijving: 'Laatste acties (admin) of recente updates.', groep: 'panelen' },
  { id: 'deze-week', label: 'Deze week', omschrijving: 'Dekking per dag (breed scherm).', groep: 'panelen' },
];

export const tegelsVoorRol = (role: User['role']): readonly TegelDef[] =>
  role === 'chauffeur' ? CHAUFFEUR_TEGELS : PLANNER_TEGELS;

/** Zichtbare tegels in de gewenste volgorde: eerst de ids uit `volgorde`
 *  (bekende ids, één keer), daarna de rest in catalogusvolgorde; verborgen
 *  ids eruit — behalve essentiële. */
export const pasVoorkeurenToe = (defs: readonly TegelDef[], voorkeuren: DashboardVoorkeuren | null | undefined): TegelDef[] => {
  const v = voorkeuren ?? LEGE_DASHBOARD_VOORKEUREN;
  return volledigeVolgorde(defs, v).filter((d) => d.essentieel || !v.verborgen.includes(d.id));
};

/** Alle tegels (ook verborgen) in de gewenste volgorde — voor de aanpas-lijst. */
export const volledigeVolgorde = (defs: readonly TegelDef[], voorkeuren: DashboardVoorkeuren | null | undefined): TegelDef[] => {
  const v = voorkeuren ?? LEGE_DASHBOARD_VOORKEUREN;
  const perId = new Map(defs.map((d) => [d.id, d]));
  const gezien = new Set<string>();
  const uit: TegelDef[] = [];
  for (const id of v.volgorde) {
    const d = perId.get(id);
    if (d && !gezien.has(id)) { gezien.add(id); uit.push(d); }
  }
  for (const d of defs) if (!gezien.has(d.id)) uit.push(d);
  return uit;
};

export const isVerborgen = (defs: readonly TegelDef[], voorkeuren: DashboardVoorkeuren, id: string): boolean => {
  const def = defs.find((d) => d.id === id);
  return Boolean(def && !def.essentieel && voorkeuren.verborgen.includes(id));
};

/** Tonen/verbergen; essentiële tegels blijven altijd zichtbaar. */
export const zetZichtbaar = (defs: readonly TegelDef[], voorkeuren: DashboardVoorkeuren, id: string, zichtbaar: boolean): DashboardVoorkeuren => {
  const def = defs.find((d) => d.id === id);
  if (!def || def.essentieel) return voorkeuren;
  const zonder = voorkeuren.verborgen.filter((x) => x !== id);
  return { ...voorkeuren, verborgen: zichtbaar ? zonder : [...zonder, id] };
};

/** Eén plek omhoog/omlaag in de volledige volgorde (verborgen tegels tellen mee). */
export const verplaats = (defs: readonly TegelDef[], voorkeuren: DashboardVoorkeuren, id: string, richting: 'omhoog' | 'omlaag'): DashboardVoorkeuren => {
  const ids = volledigeVolgorde(defs, voorkeuren).map((d) => d.id);
  const i = ids.indexOf(id);
  const j = richting === 'omhoog' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return voorkeuren;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return { ...voorkeuren, volgorde: ids };
};

export const isStandaard = (v: DashboardVoorkeuren): boolean => v.verborgen.length === 0 && v.volgorde.length === 0;

// --- Rasterhulp ---

/** Gat-vrije verdeling van n statustegels in het planner-raster (md = 6
 *  kolommen): rijen van drie (span-2); een rest van twee wordt een rij van
 *  twee (span-3), een rest van één trekt de vorige rij mee naar twee rijen
 *  van twee. Op xl: één rij met precies n kolommen. */
export const stripSpans = (n: number): { md: string[]; xl: string } => {
  const XL: Record<number, string> = { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6' };
  const xl = XL[Math.min(6, Math.max(1, n))] ?? 'xl:grid-cols-6';
  if (n <= 0) return { md: [], xl };
  if (n === 1) return { md: ['md:col-span-6'], xl };
  const rest = n % 3;
  const breed = rest === 0 ? 0 : rest === 2 ? 2 : 4;
  const md = Array.from({ length: n }, (_, i) => (i >= n - breed ? 'md:col-span-3' : 'md:col-span-2'));
  return { md, xl };
};

/** Kleine chauffeurs-tegels op xl (6 kolommen): 3 → 2, 2 → 3, 1 → 6. */
export const kleineTegelSpan = (n: number): string => {
  if (n <= 1) return 'xl:col-span-6';
  if (n === 2) return 'xl:col-span-3';
  if (n === 3) return 'xl:col-span-2';
  return 'xl:col-span-2';
};

// --- Opslag ---

const lokaleSleutel = (userId: string) => `vhb-dashboard-voorkeuren-${userId}`;

export const leesLokaleVoorkeuren = (userId: string): DashboardVoorkeuren | null => {
  try {
    const raw = window.localStorage.getItem(lokaleSleutel(userId));
    return raw ? parseDashboardVoorkeuren(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

export const bewaarLokaleVoorkeuren = (userId: string, v: DashboardVoorkeuren | null): void => {
  try {
    if (v) window.localStorage.setItem(lokaleSleutel(userId), JSON.stringify(v));
    else window.localStorage.removeItem(lokaleSleutel(userId));
  } catch {
    /* opslag geblokkeerd — de server blijft de bron */
  }
};

/**
 * Voorkeuren van de ingelogde gebruiker + opslaan. Start met het profiel
 * (/api/me); een lokale kopie wint alleen zolang er een niet-geslaagde save
 * openstaat. Opslaan: meteen lokaal + in de state (live preview), daarna
 * één PATCH (400 ms gebundeld); lukt die, dan gaat de lokale kopie weg.
 */
export function useDashboardVoorkeuren(user: User) {
  const [voorkeuren, setVoorkeuren] = useState<DashboardVoorkeuren>(
    () => leesLokaleVoorkeuren(user.id) ?? user.dashboardVoorkeuren ?? LEGE_DASHBOARD_VOORKEUREN,
  );
  const timer = useRef<number | null>(null);
  const laatste = useRef(voorkeuren);
  laatste.current = voorkeuren;

  const verstuur = useCallback(async (v: DashboardVoorkeuren) => {
    try {
      const res = await apiFetch('/api/me/voorkeuren', { method: 'PATCH', body: JSON.stringify({ dashboard: v }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(data?.error || `Opslaan mislukt (${res.status})`);
      }
      // Alleen opruimen als er intussen niets nieuws gekozen is.
      if (laatste.current === v) bewaarLokaleVoorkeuren(user.id, null);
    } catch (err) {
      // Lokaal blijft de indeling staan; de volgende wijziging probeert opnieuw.
      notify(`Je dashboardindeling is alleen op dit toestel bewaard: ${err instanceof Error ? err.message : 'opslaan mislukt'}.`, 'info');
    }
  }, [user.id]);

  const opslaan = useCallback((v: DashboardVoorkeuren) => {
    setVoorkeuren(v);
    bewaarLokaleVoorkeuren(user.id, v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; void verstuur(v); }, 400);
  }, [user.id, verstuur]);

  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); void verstuur(laatste.current); } }, [verstuur]);

  return { voorkeuren, opslaan };
}
