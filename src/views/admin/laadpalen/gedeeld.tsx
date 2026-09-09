import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn, downloadBlob, notify } from '../../../lib/ui';
import { csvTekst } from '../../../lib/csv';
import { apiFetch } from '../../../lib/api';
import { isoDate } from '../../../lib/datum';
import { MONTH_NAMES, formatGetal, metEenheid } from '../../../lib/format';
import { Segmented, type BadgeTone } from '../../../components/primitives';

/**
 * Gedeelde bouwstenen van de laadpalenpagina (herwerking 08-09-2026):
 * formatters, statuslabels, de CPU-groepering, de termijnschakelaar en de
 * veeg-selectie voor grafieken. Eén plek voor Live, Maand, Historiek en
 * Sessies zodat "112 kW" overal hetzelfde leest.
 */

// ---- Getallen ----
/** kW / kWh in Belgische notatie, max. 2 decimalen (ChargEye levert er vijf). */
export const tekstKw = (v: number) => metEenheid(formatGetal(v), 'kW');
export const tekstKwh = (v: number) => metEenheid(formatGetal(v), 'kWh');
/** Hele kWh met smal duizendtal ("6 559"): tienden zeggen niets op maandniveau. */
export const fmtKwh = (kwh: number) => formatGetal(Math.round(kwh));
export const tekstKwhHeel = (kwh: number) => metEenheid(fmtKwh(kwh), 'kWh');
/** Minuten → "9 u 24 min", "45 min", "—". */
export const duurLabel = (min: number | null | undefined): string => {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—';
  const u = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (u === 0) return metEenheid(m, 'min');
  if (m === 0) return metEenheid(u, 'u');
  return `${metEenheid(u, 'u')} ${metEenheid(m, 'min')}`;
};

// ---- Datums (alles Brusselse tijd, zoals de API levert) ----
export const maandLabel = (maand: string): string => {
  const [j, m] = maand.split('-').map(Number);
  return `${MONTH_NAMES[m - 1] ?? maand} ${j}`;
};
export const maandKort = (maand: string): string => {
  const [j, m] = maand.split('-').map(Number);
  return `${(MONTH_NAMES[m - 1] ?? maand).slice(0, 3).toLowerCase()} ${String(j).slice(2)}`;
};
export const uurLabel = (ts: string | null | undefined) => (ts ? new Date(ts).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : '—');
/** "wo 3 sep" */
export const dagKort = (dag: string) => new Date(`${dag}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
/** "woensdag 3 september 2026" */
export const dagLang = (dag: string) => new Date(`${dag}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/** "3 sep 02:15" */
export const tijdstipKort = (ts: string | null | undefined) => (ts ? new Date(ts).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const dagMaand = (dag: string) => `${Number(dag.slice(8, 10))} ${(MONTH_NAMES[Number(dag.slice(5, 7)) - 1] ?? '').toLowerCase()}`;
/** "Augustus 2026" · "4 augustus 2026" · "4–5 augustus 2026" · "28 juli – 5 augustus 2026". */
export const periodeLabel = (v: { van: string; tot: string; maand: string | null }): string => {
  if (v.maand) return maandLabel(v.maand);
  const jaar = v.tot.slice(0, 4);
  if (v.van === v.tot) return `${dagMaand(v.van)} ${jaar}`;
  if (v.van.slice(0, 7) === v.tot.slice(0, 7)) return `${Number(v.van.slice(8, 10))}–${dagMaand(v.tot)} ${jaar}`;
  if (v.van.slice(0, 4) === jaar) return `${dagMaand(v.van)} – ${dagMaand(v.tot)} ${jaar}`;
  return `${dagMaand(v.van)} ${v.van.slice(0, 4)} – ${dagMaand(v.tot)} ${jaar}`;
};

// ---- Statussen ----
export const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Beschikbaar', CHARGING: 'Laden', RESERVED: 'Gereserveerd', BLOCKED: 'Geblokkeerd',
  INOPERATIVE: 'Buiten dienst', OUTOFORDER: 'Storing', PLANNED: 'Gepland', REMOVED: 'Verwijderd', UNKNOWN: 'Onbekend',
};
export const statusTone = (s?: string): BadgeTone => {
  switch ((s ?? '').toUpperCase()) {
    case 'AVAILABLE': return 'emerald';
    case 'CHARGING': return 'blue';
    case 'RESERVED': return 'amber';
    case 'BLOCKED': case 'INOPERATIVE': case 'OUTOFORDER': return 'red';
    default: return 'slate';
  }
};
export const statusLabel = (s?: string) => STATUS_LABEL[(s ?? '').toUpperCase()] ?? (s ?? 'Onbekend');
/** Stille pil voor gewone statussen; storing en gereserveerd houden kleur. */
export const stilStatus = (tone: BadgeTone) => tone !== 'red' && tone !== 'amber';

/** ChargEye-classificaties van een aankoppeling, in mensentaal. */
export const KLASSE_LABEL: Record<string, string> = {
  OK: 'In orde',
  HANDSHAKE_FAIL: 'Handshake mislukt',
  HANDSHAKE_CANCELED: 'Handshake afgebroken',
  LOW_POWER: 'Te laag vermogen',
  ABRUPT_STOP: 'Abrupt gestopt',
  ABRUPTLY_CANCELED: 'Abrupt geannuleerd',
  NOT_IDENTIFIED: 'Niet herkend',
};
export const klasseLabel = (k: string | null | undefined) => (k ? (KLASSE_LABEL[k] ?? k.toLowerCase().replace(/_/g, ' ')) : 'Onbekend');

/** Eén bron voor de rijstructuur van een laadpunt: "Vol" is 100% batterij óf
 *  laden zónder vermogen; dan zegt "Laden voltooid" meer dan "0 kW". */
export const laadStatus = (status: string | undefined, sessie?: { soc?: number | null; powerKw?: number | null } | null) => {
  const soc = typeof sessie?.soc === 'number' ? sessie.soc : null;
  const kw = typeof sessie?.powerKw === 'number' ? sessie.powerKw : null;
  const laadt = (status ?? '').toUpperCase() === 'CHARGING';
  const vol = Boolean(sessie) && ((soc ?? 0) >= 100 || (laadt && kw !== null && kw <= 0));
  const label = !sessie
    ? null
    : vol
      ? 'Laden voltooid'
      : laadt && kw !== null && kw > 0
        ? `Laden · ${metEenheid(Math.round(kw), 'kW')}`
        : null;
  return { soc, kw, laadt, vol, label };
};

// ---- Groepering per CPU ----
/** Groepeer laadpunten per CPU (het fysieke station): het uid-voorvoegsel
 *  vóór het laatste "-N". Het CPU-nummer komt uit de physical_reference
 *  ("CPU3 sat1.1" → 3, "mal.1.5" → 1, "2.7" → 2). */
export function groepeerPerCpu<T extends { uid: string; evse_id?: string | null; physical_reference?: string | null }>(evses: T[]): Array<{ key: string; label: string; evses: T[] }> {
  const groepen = new Map<string, T[]>();
  for (const e of evses) {
    const key = String(e.uid ?? '').replace(/-\d+$/, '') || 'onbekend';
    groepen.set(key, [...(groepen.get(key) ?? []), e]);
  }
  const cpuNummer = (lijst: T[]): number | null => {
    for (const e of lijst) {
      const ref = String(e.physical_reference ?? '');
      const cpu = /cpu\s*(\d+)/i.exec(ref);
      if (cpu) return Number(cpu[1]);
      const leidend = /^(?:[a-z]+\.)?(\d+)\./i.exec(ref);
      if (leidend) return Number(leidend[1]);
    }
    return null;
  };
  const kolommen = [...groepen.entries()]
    .map(([key, lijst], i) => {
      const nr = cpuNummer(lijst);
      return {
        key,
        label: nr !== null ? `CPU ${nr}` : `Station ${i + 1}`,
        volgorde: nr ?? 90 + i,
        evses: [...lijst].sort((a, b) => laadpuntSort(a.evse_id ?? a.uid, b.evse_id ?? b.uid)),
      };
    })
    .sort((a, b) => a.volgorde - b.volgorde)
    .map(({ key, label, evses: lijst }) => ({ key, label, evses: lijst }));
  const gezien = new Map<string, number>();
  for (const kolom of kolommen) {
    const n = (gezien.get(kolom.label) ?? 0) + 1;
    gezien.set(kolom.label, n);
    if (n > 1) kolom.label = `${kolom.label} (${n})`;
  }
  return kolommen;
}

/** Laadpunt-nummers natuurlijk sorteren: 1, 2, … 12.A, 12.B (niet "1", "10", "11"). */
export const laadpuntSort = (a: string | null | undefined, b: string | null | undefined): number => {
  const key = (v: string | null | undefined): [number, string] => {
    const m = /^(\d+)(?:\.(.+))?$/.exec(String(v ?? ''));
    return m ? [Number(m[1]), m[2] ?? ''] : [Number.MAX_SAFE_INTEGER, String(v ?? '')];
  };
  const [an, as] = key(a);
  const [bn, bs] = key(b);
  return an - bn || as.localeCompare(bs);
};

// ---- Bedieningselementen ----
/** Termijn-/tabschakelaar in de app-standaard segmented-maat. */
export function TermijnKeuze<T extends string>({ label, waarde, opties, onKies, className }: { label: string; waarde: T; opties: Array<{ id: T; label: string }>; onKies: (t: T) => void; className?: string }) {
  return (
    <Segmented<T>
      label={label}
      className={cn('shrink-0', className)}
      waarde={waarde}
      opties={opties.map((o) => ({ waarde: o.id, label: o.label }))}
      onChange={onKies}
    />
  );
}

/** Verschil t.o.v. de vorige periode: "+12 %" met pijl, gedempt. `omgekeerd`
 *  = lager is beter (piekvermogen): dan kleurt een daling groen. */
export function Delta({ huidig, vorige, omgekeerd = false, className, title }: { huidig: number | null; vorige: number | null; omgekeerd?: boolean; className?: string; title?: string }) {
  if (huidig === null || vorige === null || vorige <= 0) return null;
  const pct = ((huidig - vorige) / vorige) * 100;
  const stil = Math.abs(pct) < 0.5;
  const beter = omgekeerd ? pct < 0 : pct > 0;
  const Icoon = stil ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    /* 2xs: verschil-indicator (teller) naast een kerncijfer */
    <span className={cn('inline-flex items-center gap-0.5 font-mono text-2xs font-semibold', stil ? 'text-slate-500' : beter ? 'text-emerald-700' : 'text-slate-600', className)} title={title ?? 'Verschil met de vorige periode'}>
      <Icoon size={12} />
      {stil ? '±0 %' : `${pct > 0 ? '+' : '−'}${formatGetal(Math.abs(pct), Math.abs(pct) >= 10 ? 0 : 1)} %`}
    </span>
  );
}

// ---- Grafiek-hulpen ----
/** Kleinste "mooie" as-top ≥ max (1/1.5/2/2.5/3/4/5/6/8 × 10^n). */
export function mooiMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (max <= f * p) return f * p;
  }
  return 10 * p;
}

/** Hairline-gridlijnen mét waarde-labels achter een grafiek. Render in een
 *  `relative` wrapper; de labels hangen nét onder hun lijn. */
export function GridLijnen({ top, eenheid }: { top: number; eenheid: string }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {[1, 0.5].map((f) => (
        <div key={f} className="absolute inset-x-0" style={{ bottom: `${f * 100}%` }}>
          <div className="border-t border-hairline" />
          <span
            // 2xs: as-label in de grafiek
            className="absolute right-0 top-0.5 z-10 rounded px-1 py-0.5 text-2xs font-medium font-mono leading-none text-slate-500"
            style={{ background: 'var(--tile-bg)' }}
          >
            {formatGetal(top * f)} {eenheid}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Veeg-selectie (touch) over een reeks even brede vakken: sleep met je vinger
 * en de uitlezing eronder springt mee (à la de iOS-batterijgrafiek). Werkt
 * op de 24u-curve én op de dag-staven (31 staven van ±10 px op een telefoon).
 * `touch-pan-y` op de container laat verticaal scrollen met rust.
 */
export function useScrub() {
  const scrubActief = useRef(false);
  const scrubStart = useRef<{ vooraf: string | null; bewogen: boolean; x: number }>({ vooraf: null, bewogen: false, x: 0 });
  const scrubHandlers = (items: Array<{ key: string }>, huidig: string | null, zet: (key: string | null) => void) => {
    const kiesOpX = (clientX: number, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || items.length === 0) return null;
      const frac = Math.min(0.999, Math.max(0, (clientX - r.left) / r.width));
      const key = items[Math.floor(frac * items.length)].key;
      zet(key);
      return key;
    };
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'touch') return;
        scrubActief.current = true;
        scrubStart.current = { vooraf: huidig, bewogen: false, x: e.clientX };
        kiesOpX(e.clientX, e.currentTarget);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'touch' || !scrubActief.current) return;
        if (Math.abs(e.clientX - scrubStart.current.x) > 6) scrubStart.current.bewogen = true;
        kiesOpX(e.clientX, e.currentTarget);
      },
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'touch') return;
        if (!scrubStart.current.bewogen) {
          const key = kiesOpX(e.clientX, e.currentTarget);
          if (key && key === scrubStart.current.vooraf) zet(null);
        }
        window.setTimeout(() => { scrubActief.current = false; }, 50);
      },
      onPointerCancel: () => {
        zet(scrubStart.current.vooraf);
        window.setTimeout(() => { scrubActief.current = false; }, 50);
      },
    };
  };
  return { scrubActief, scrubHandlers };
}

// ---- API-types ----
export type SessieDetail = {
  id: string;
  evseUid: string;
  dag: string;
  start: string | null;
  eind: string | null;
  status: string;
  duurMin: number | null;
  laadMin: number | null;
  kwh: number;
  gemKw: number | null;
  maxKw: number | null;
  socStart: number | null;
  socEind: number | null;
  voertuig: string | null;
  klasse: string | null;
  ongeldig: boolean;
  laadbeurt: boolean;
  mislukt: boolean;
};

export type DagRij = {
  dag: string;
  kwh: number;
  sessies: number;
  laadbeurten: number;
  mislukt: number;
  piekKw: number | null;
  piekTs: string | null;
  piekCharging: number | null;
};

export type PuntRij = {
  evseUid: string;
  evseId: string | null;
  physicalReference: string | null;
  maxElectricPowerKw: number | null;
  kwh: number;
  kwhVorige?: number;
  aandeel: number;
  sessies: number;
  laadbeurten: number;
  mislukt: number;
  laadMin: number;
  gemKw: number | null;
  maxKw: number | null;
};

export type Totalen = {
  kwh: number;
  sessies: number;
  laadbeurten: number;
  mislukt: number;
  laaddagen: number;
  gemPerLaaddag: number;
  hoogsteDag: { dag: string; kwh: number } | null;
  piekKw: number | null;
  piekTs: string | null;
  piekDag: string | null;
  piekCharging: number | null;
  gemDagpiekKw: number | null;
  piekDagen: number;
  /** Som van de effectieve laadtijd in minuten; null = onbekend (geen enkele
   *  sessie in de reeks had charging_periods), en dat is iets anders dan 0. */
  laadMin: number | null;
};

export type MaandRij = Totalen & { maand: string; dagen: number; klassen: Record<string, number> };

export type Laadpunt = { uid: string; evseId: string | null; physicalReference: string | null };

/** Naam van een laadpunt uit de laadpuntenlijst: "13.A", anders de referentie of de uid. */
export const puntNaam = (uid: string, laadpunten: Laadpunt[] | Map<string, Laadpunt>): string => {
  const p = laadpunten instanceof Map ? laadpunten.get(uid) : laadpunten.find((x) => x.uid === uid);
  return p?.evseId ?? p?.physicalReference ?? uid;
};

// ---- Exports ----
/** CSV-download: puntkomma-gescheiden met decimale komma (Belgische Excel)
 *  en BOM zodat Excel de UTF-8 goed leest; csvTekst neutraliseert formule-
 *  prefixen (laadpuntnamen komen van een externe partij). */
export const exporteerCsv = (naam: string, regels: unknown[][]) => {
  const csv = '\ufeff' + csvTekst(regels.map((r) => r.map((c) => (typeof c === 'number' ? String(Math.round(c * 10) / 10).replace('.', ',') : c))), ';');
  void downloadBlob(naam, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
};

/** Excel-werkboek van de server ophalen (api/ocpi/export of historiek). */
export const downloadXlsx = async (url: string, naam: string): Promise<void> => {
  try {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(String(res.status));
    // downloadBlob meldt zelf wat er gebeurde (deelblad, download, of een
    // Bewaren-knop als de gesture verlopen was); een eigen succes-toast zou
    // in standalone succes claimen dat er niet was.
    await downloadBlob(naam, await res.blob());
  } catch {
    notify('Exporteren is mislukt, controleer je verbinding en probeer opnieuw.', 'error');
  }
};

/** Lokale kalenderdag van een tijdstip ("YYYY-MM-DD"); de browser staat in
 *  Brusselse tijd, dus dit valt samen met de dag die de API toekent. */
export const dagVanTs = (ts: string | null | undefined): string => (ts ? isoDate(new Date(ts)) : '');
