import type { ReactNode } from 'react';
import { GOUD } from '../BrandLogo';
import { cn } from '../../lib/ui';

/**
 * Illustratieset op het lus-motief (idee 10, 09-2026): vijf lijntekeningen
 * voor lege staten en foutschermen, elk gebouwd rond de onderbroken ovale
 * lus uit het VHB-logo (zelfde geometrie als BrandMotief, op schaal). Lijnen
 * in `currentColor` (zet `text-slate-400`, dark mode flipt mee), één gouden
 * segment op de lus als merkcitaat en hooguit één extra gouden accent waar
 * de betekenis dat vraagt (vinkje, uitroep). Strokes 1.5, viewBox 160×120,
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

/* De lus: stadionvorm, straal 22, middelpunten (52,60) en (108,60); de
   onderbreking zit rechtsboven, tussen het inkt-einde (−10°) en het gouden
   segment (top → −23°) — dezelfde verhouding als in het logo. */
const LUS_INK = 'M 100 38 H 52 A 22 22 0 0 0 52 82 H 108 A 22 22 0 0 0 129.67 56.18';
const LUS_GOUD = 'M 105 38 H 108 A 22 22 0 0 1 128.25 51.4';

function Lus({ transform, dashRechts = false }: { transform?: string; /** Rechterhelft gestippeld (verbinding valt weg). */ dashRechts?: boolean }) {
  if (dashRechts) {
    return (
      <g transform={transform}>
        <path d="M 100 38 H 52 A 22 22 0 0 0 52 82 H 80" />
        <path d="M 80 82 H 108 A 22 22 0 0 0 129.67 56.18" strokeDasharray="3 4.5" />
        <path d={LUS_GOUD} stroke={GOUD} strokeDasharray="3 4.5" />
      </g>
    );
  }
  return (
    <g transform={transform}>
      <path d={LUS_INK} />
      <path d={LUS_GOUD} stroke={GOUD} />
    </g>
  );
}

/** Lege lijst / inbox: de lus als lege bak, met erboven de plekken waar
 *  rijen komen — nog gestippeld. */
export function LegeLijst({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <g strokeDasharray="2.5 4" opacity={0.7}>
        <path d="M 54 20 H 106" />
        <path d="M 54 32 H 106" />
      </g>
      <Lus transform="translate(0 10)" />
    </Vel>
  );
}

/** Niets te doen: de lus als rustpunt, het gouden vinkje erin. */
export function AllesGedaan({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <Lus />
      <path d="M 68 61 L 77 70 L 94 51" stroke={GOUD} strokeWidth={2} />
    </Vel>
  );
}

/** Offline: de lus als verbinding die wegvalt (rechts gestippeld) en de
 *  signaalbogen erboven — de buitenste al onderbroken. */
export function GeenBereik({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <path d="M 71 34 A 13 13 0 0 1 89 34" />
      <path d="M 62 25 A 25 25 0 0 1 98 25" strokeDasharray="3 4.5" />
      <path d="M 80 44 v 0.01" strokeWidth={3} />
      <Lus transform="translate(0 12)" dashRechts />
    </Vel>
  );
}

/** Iets ging mis: de lus met het gouden uitroep-accent. */
export function Fout({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <Lus />
      <path d="M 80 49 V 63" stroke={GOUD} strokeWidth={2} />
      <circle cx={80} cy={70.5} r={1.6} fill={GOUD} stroke="none" />
    </Vel>
  );
}

/** Niet gevonden / geen zoekresultaat: de lus als loep met een steel. */
export function NietGevonden({ className }: IllustratieProps) {
  return (
    <Vel className={className}>
      <g transform="rotate(-24 88 54) translate(8 -6)">
        <Lus />
        <path d="M 30 60 H 12" strokeWidth={3} />
      </g>
      <g strokeDasharray="2.5 4" opacity={0.7}>
        <path d="M 22 102 H 66" />
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
