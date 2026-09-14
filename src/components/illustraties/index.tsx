import type { ReactNode } from 'react';
import { GOUD } from '../BrandLogo';
import { cn } from '../../lib/ui';

/**
 * Illustratieset op het merkteken (idee 10, 09-2026; hertekend 14-09 voor
 * het VHB-primary-merk): vijf lijntekeningen voor lege staten en
 * foutschermen, elk gebouwd rond de V met de gouden schuine streep uit het
 * VHB-merk (zelfde helling als BrandMotief). Lijnen in `currentColor` (zet
 * `text-slate-400`, dark mode flipt mee), de gouden streep als merkcitaat en
 * hooguit één extra gouden accent waar de betekenis dat vraagt (vinkje,
 * uitroep). Strokes 1.5, viewBox 160×120,
 * geen tekst, geen gezichtjes — `aria-hidden`, de tekst ernaast draagt de
 * betekenis. Sizen op hoogte (`h-24 lg:h-32`); de breedte volgt.
 *
 * Gebruik: `<EmptyState illustratie={<LegeLijst />} …>` (ui.tsx) of los in
 * een eigen lege staat. Overzicht op /beheer/designsysteem → Illustraties.
 */
export type IllustratieProps = { className?: string };

function Vel({ className, children }: IllustratieProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 160 120"
      className={cn('h-24 w-auto shrink-0', className)}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/* Het merkteken: de V uit het VHB-merk als twee lijnen (het rechterbeen
   kort, zoals in het logo) met de gouden streep evenwijdig ernaast —
   dezelfde helling als in het merk (10 eenheden tussen been en streep).
   Ankerpunt: de V-punt op (66,82). */
const V_LINKS = 'M 44 38 L 66 82';
const V_RECHTS = 'M 88 38 L 75 64';
const STREEP = 'M 76 82 L 98 38';

function Merk({ transform, dashRechts = false }: { transform?: string; /** Rechterhelft gestippeld (verbinding valt weg). */ dashRechts?: boolean }) {
  return (
    <g transform={transform}>
      <path d={V_LINKS} />
      <path d={V_RECHTS} strokeDasharray={dashRechts ? '3 4.5' : undefined} />
      <path d={STREEP} stroke={GOUD} strokeWidth={2.5} strokeDasharray={dashRechts ? '3 4.5' : undefined} />
    </g>
  );
}

/** Lege lijst / inbox: het merkteken met rechts de plekken waar rijen komen,
 *  nog gestippeld. */
export function LegeLijst({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <Merk transform="translate(-14 0)" />
      <g strokeDasharray="2.5 4" opacity={0.7}>
        <path d="M 100 50 H 134" />
        <path d="M 100 62 H 134" />
        <path d="M 100 74 H 134" />
      </g>
    </Vel>
  );
}

/** Niets te doen: het merkteken, rechts het gouden vinkje als rustpunt. */
export function AllesGedaan({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <Merk transform="translate(-14 0)" />
      <path d="M 104 62 L 112 70 L 128 50" stroke={GOUD} strokeWidth={2} />
    </Vel>
  );
}

/** Offline: het merkteken als verbinding die wegvalt (rechts gestippeld) en
 *  de signaalbogen erboven — de buitenste al onderbroken. */
export function GeenBereik({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <path d="M 71 30 A 13 13 0 0 1 89 30" />
      <path d="M 62 21 A 25 25 0 0 1 98 21" strokeDasharray="3 4.5" />
      <path d="M 80 40 v 0.01" strokeWidth={3} />
      <Merk transform="translate(7 18)" dashRechts />
    </Vel>
  );
}

/** Iets ging mis: het merkteken met rechts het gouden uitroep-accent. */
export function Fout({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <Merk transform="translate(-14 0)" />
      <path d="M 116 50 V 66" stroke={GOUD} strokeWidth={2} />
      <circle cx={116} cy={73.5} r={1.6} fill={GOUD} stroke="none" />
    </Vel>
  );
}

/** Niet gevonden / geen zoekresultaat: het merkteken met rechts een loep
 *  (cirkel + steel) en onderaan een gestippelde, lege resultaatregel. */
export function NietGevonden({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <Merk transform="translate(-14 -4)" />
      <circle cx={114} cy={54} r={11} />
      <path d="M 122 62 L 132 72" strokeWidth={3} />
      <g strokeDasharray="2.5 4" opacity={0.7}>
        <path d="M 40 100 H 120" />
      </g>
    </Vel>
  );
}

export const ILLUSTRATIES = {
  LegeLijst,
  AllesGedaan,
  GeenBereik,
  Fout,
  NietGevonden,
} as const;
