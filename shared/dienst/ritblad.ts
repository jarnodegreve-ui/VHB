import type { Segment } from '../dienst.js';
import { formatHHMM } from './tijd.js';

/**
 * Het ritblad van een dienst uit de ritdelen (Access qry-rap ritblad):
 * alle delen behalve stationnement, met lijn, rit (of 'led'), loop,
 * vertrek, start, aankomst, einde en via. Voor ledige ritten van en naar de
 * stelplaats staat het loopnummer in de via-kolom (zoals op de gedrukte
 * bladen).
 */
export type RitbladRij = { lijn: string; rit: string; loop: string; vertrek: string; start: string; aankomst: string; einde: string; via: string; type: string };

const stelplaats = (naam: string | null) => /stelplaats|garage|coach|aflos/i.test(naam ?? '');

export function ritbladVanSegmenten(segments: Segment[], viaVanVariant: (variant: string | null) => string = () => ''): RitbladRij[] {
  return [...segments]
    .sort((a, b) => a.volgorde - b.volgorde)
    .filter((s) => s.type !== 'STA')
    .map((s) => ({
      type: s.type,
      lijn: s.lijn ?? '',
      rit: s.type === 'LED' ? 'led' : s.rit ?? (s.type === 'RIT' ? '' : s.type.toLowerCase()),
      loop: s.loop ?? '',
      vertrek: s.vertrek ?? '',
      start: formatHHMM(s.startMin, { wrap24: true }),
      aankomst: s.aankomst ?? '',
      einde: formatHHMM(s.eindeMin, { wrap24: true }),
      via: !s.variant && stelplaats(s.vertrek) ? s.loop ?? '' : viaVanVariant(s.variant),
    }));
}
