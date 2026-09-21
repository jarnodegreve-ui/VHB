import type { Melding, MeldingSoort } from '../types';
import { MELDING_SOORTEN } from '../../shared/meldingSoorten';
import { addDagen, isoDate } from './datum';
import { formatDateHuman } from './format';

/**
 * Meldingencentrum — pure helpers voor de lijst: filteren, groeperen per dag
 * en het dag-label. De view (MeldingenView) blijft daardoor dun en dit is
 * los testbaar (src/lib/meldingen.test.ts).
 */

export type MeldingFilter = 'alles' | 'ongelezen' | MeldingSoort;

/** Lokale dag ('YYYY-MM-DD') van een ISO-tijdstip; ongeldig = lege string. */
export const dagVan = (createdAt: string): string => {
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? '' : isoDate(d);
};

/** 'Vandaag' / 'Gisteren' / 'do 3 september' (met jaar als het een ander jaar is). */
export const dagLabel = (dagIso: string, vandaagIso: string): string => {
  if (!dagIso) return 'Onbekend';
  if (dagIso === vandaagIso) return 'Vandaag';
  if (dagIso === addDagen(vandaagIso, -1)) return 'Gisteren';
  return formatDateHuman(dagIso);
};

export const filterMeldingen = (meldingen: Melding[], filter: MeldingFilter): Melding[] => {
  if (filter === 'alles') return meldingen;
  if (filter === 'ongelezen') return meldingen.filter((m) => !m.gelezenOp);
  return meldingen.filter((m) => m.soort === filter);
};

/** Soorten die in de lijst voorkomen, in de vaste volgorde van het contract. */
export const soortenIn = (meldingen: Melding[]): MeldingSoort[] => {
  const aanwezig = new Set(meldingen.map((m) => m.soort));
  return MELDING_SOORTEN.filter((s) => aanwezig.has(s));
};

export type MeldingGroep = { dag: string; label: string; items: Melding[] };

/** Nieuwste eerst, gegroepeerd per lokale dag (de lijst komt al gesorteerd
 *  van de server; we sorteren tóch, zodat een optimistische invoeging klopt). */
export const groepeerPerDag = (meldingen: Melding[], vandaagIso: string): MeldingGroep[] => {
  const gesorteerd = [...meldingen].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groepen: MeldingGroep[] = [];
  for (const m of gesorteerd) {
    const dag = dagVan(m.createdAt);
    const laatste = groepen[groepen.length - 1];
    if (laatste && laatste.dag === dag) laatste.items.push(m);
    else groepen.push({ dag, label: dagLabel(dag, vandaagIso), items: [m] });
  }
  return groepen;
};

/**
 * Datums in de tekst van oude meldingen: tot 21-09 schreven drie sjablonen in
 * de API de rauwe ISO-datum ("2026-10-03"), die Jarno las als jaar/maand/dag.
 * De API stuurt nu dd/mm/jjjj (DAG_DMJ), maar de rijen die er al staan blijven
 * zoals ze verstuurd zijn — daarom zetten we ze bij het tonen om. Alleen een
 * volledige ISO-dag wordt geraakt; tijdstippen en losse getallen niet.
 */
const ISO_DAG = /\b(\d{4})-(\d{2})-(\d{2})\b(?!T)/g;
export const datumsLeesbaar = (tekst: string | null | undefined): string =>
  String(tekst ?? '').replace(ISO_DAG, (_, j, m, d) => `${d}/${m}/${j}`);

/** 'HH:MM' in Belgische tijd voor de rij. */
export const tijdVan = (createdAt: string): string => {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
  } catch {
    return '';
  }
};
