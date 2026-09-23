import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/ui';
import type { MaandVeeg } from '../lib/useMaandVeeg';
import { IconButton } from './primitives';
import { RichtingWissel } from './RichtingWissel';

/**
 * Maandnavigatie: "‹ maandnaam ›" boven een maandraster. Stond 7× uitgeschreven
 * (controle-ronde 27-08, bevinding 42c); dit is het rooster-dialect
 * (ScheduleView): IconButton md = 44px-knoppen (36px op een desktop met muis).
 * De aria-labels "Vorige maand"/"Volgende maand" zijn contract met de e2e-
 * tests — niet wijzigen. `children` = extra acties achter de pijlen (bv. een
 * "Vandaag"-knop); `className="justify-between"` spreidt de kop over de volle
 * breedte van een kaart. Onder sm vult de kop altijd de breedte (maand in het
 * midden tussen de pijlen).
 *
 * Richting (golf 4, punt 11): geef `veeg` (uit `useMaandVeeg`) en de pijlen
 * zetten de richting vóór ze de maand wisselen; `MaandWissel` eronder laat
 * de nieuwe maand dan van de juiste kant binnenkomen, en de veeg op touch
 * werkt op dezelfde container. Zonder `veeg` gedraagt de kop zich als
 * voorheen (`onVorige`/`onVolgende`).
 */
export function MaandNavigatie({
  label,
  onVorige,
  onVolgende,
  veeg,
  vorigeUit = false,
  volgendeUit = false,
  labelClassName,
  className,
  children,
  ...rest
}: {
  label: string;
  onVorige?: () => void;
  onVolgende?: () => void;
  /** Uit `useMaandVeeg`: de pijlen zetten dan ook de richting van de wissel. */
  veeg?: MaandVeeg;
  vorigeUit?: boolean;
  volgendeUit?: boolean;
  /** Extra klassen op de maandnaam (bv. een min-width tegen verspringen). */
  labelClassName?: string;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  const naarVorige = veeg ? veeg.vorige : onVorige;
  const naarVolgende = veeg ? veeg.volgende : onVolgende;
  return (
    // Telefoon: over de volle breedte, pijlen aan de randen en de maand in het
    // midden (P4, 23-09: in Verlofkalender en Looncontrole stond de kop links
    // gegroepeerd met lege ruimte ernaast). Extra acties (children) volgen
    // na de rechterpijl.
    <div className={cn('flex items-center gap-2 max-sm:w-full', className)} {...rest}>
      <IconButton label="Vorige maand" variant="secondary" onClick={naarVorige} disabled={vorigeUit}>
        <ChevronLeft size={16} />
      </IconButton>
      <span className={cn('text-center text-sm font-semibold capitalize text-slate-800 max-sm:flex-1', labelClassName)} aria-live="polite">
        {label}
      </span>
      <IconButton label="Volgende maand" variant="secondary" onClick={naarVolgende} disabled={volgendeUit}>
        <ChevronRight size={16} />
      </IconButton>
      {children}
    </div>
  );
}

/**
 * De maandinhoud (raster) die van maand wisselt met richting: nieuwe maand
 * schuift in van rechts bij "volgende", van links bij "vorige" (24 px,
 * `RichtingWissel`), en beweegt op touch met de vinger mee (`veeg.ref`).
 * Twee lagen: de buitenste knipt (4 px speling voor de ringen op de
 * randcellen: marge + padding, onderaan via `overflow-clip-margin`; ook
 * verticaal, zodat een zesde week van de oude maand niet over de legende
 * spookt), de binnenste is wat de veeg verschuift — de knip mag niet
 * mee-transformeren, anders schuift de knip mee met de inhoud.
 * `sleutel` = de maand (bv. "2026-10").
 */
export function MaandWissel({ sleutel, veeg, richting = 1, className, innerClassName, children }: {
  sleutel: string;
  veeg?: MaandVeeg;
  /** Zonder `veeg`: de richting van de laatste wissel. */
  richting?: 1 | -1;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('-mx-1 -mt-1 overflow-clip px-1 pt-1 [overflow-clip-margin:4px]', className)}>
      <div ref={veeg?.ref} className="touch-pan-y">
        <RichtingWissel
          sleutel={sleutel}
          richting={veeg?.richting ?? richting}
          uitStil={veeg?.viaVeeg ?? false}
          afstand={24}
          innerClassName={innerClassName}
        >
          {children}
        </RichtingWissel>
      </div>
    </div>
  );
}
