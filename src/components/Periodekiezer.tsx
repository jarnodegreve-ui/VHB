import { Field, Select, DateInput } from './Field';
import { cn } from '../lib/ui';
import {
  eersteVanMaand, herkenPeriode, laatsteVanMaand, maandenInPeriode, periodeFout, periodeKeuzesVoor, periodeVoor,
  type Periode, type PeriodeKeuze, type PeriodeSnelkeuze,
} from '../../shared/rapporten/periode';

/**
 * Periodekiezer: snelkeuze (deze maand, vorige maand, dit kwartaal, dit jaar,
 * vrij) plus de twee datums zelf. De datums staan er altijd bij, ook bij een
 * snelkeuze: je ziet welke dagen "dit kwartaal" precies zijn, en wie een
 * datum aanpast belandt vanzelf op "Vrije periode". De waarde is alleen
 * van/tot (ISO, zone-loos): de snelkeuze wordt eruit herkend, dus een
 * gedeelde link met datums toont morgen nog dezelfde periode.
 *
 * `vandaag` = de lokale kalenderdag van de gebruiker (isoDate(new Date())).
 * Een onmogelijke periode (einde vóór begin, langer dan 366 dagen) toont de
 * fout bij het veld; de aanroeper beslist zelf of hij dan nog laadt
 * (`periodeFout` uit shared/rapporten/periode).
 *
 * `snelkeuze` kiest de lijst (terugkijken, per dag, vooruitkijken).
 * `heleMaanden`: het rapport telt per kalendermaand; de twee datums worden dan
 * twee maanden ("Van maand", "Tot en met maand"), de waarde blijft van/tot (de
 * 1e en de laatste dag), zodat de URL, het blad en de server niets nieuws leren.
 */
// Korte maandnamen: het veld is op de telefoon een halve regel breed, en "September 2026" werd er afgekapt.
const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const maandLabel = (maand: string): string => `${MAAND_KORT[Number(maand.slice(5, 7)) - 1] ?? maand} ${maand.slice(0, 4)}`;

/** De maanden in de keuzelijst: twee jaar terug tot een jaar vooruit, opgerekt tot wat er gekozen is. */
const maandOpties = (vandaag: string, waarde: Periode): string[] => {
  const jaar = Number(vandaag.slice(0, 4));
  const randen = [`${jaar - 2}-01-01`, `${jaar + 1}-12-31`, waarde.van, waarde.tot].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return maandenInPeriode({ van: randen[0], tot: randen[randen.length - 1] }).reverse();
};

export function Periodekiezer({ waarde, onChange, vandaag, className, snelkeuze = 'terug', heleMaanden = false }: {
  waarde: Periode;
  onChange: (periode: Periode) => void;
  vandaag: string;
  className?: string;
  snelkeuze?: PeriodeSnelkeuze;
  heleMaanden?: boolean;
}) {
  const keuze = herkenPeriode(waarde, vandaag, snelkeuze);
  const fout = periodeFout(waarde, { heleMaanden });
  const kies = (k: PeriodeKeuze) => { if (k !== 'vrij') onChange(periodeVoor(k, vandaag)); };
  const maanden = heleMaanden ? maandOpties(vandaag, waarde) : [];
  return (
    // Op de telefoon: snelkeuze over de volle breedte, de datums eronder naast
    // elkaar. Vanaf sm drie velden op één regel.
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-[minmax(10rem,1.2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)]', className)}>
      <Field label="Periode" className="col-span-2 sm:col-span-1">
        {({ id }) => (
          <Select id={id} value={keuze} onChange={(e) => kies(e.target.value as PeriodeKeuze)}>
            {periodeKeuzesVoor(snelkeuze).map((k) => <option key={k.waarde} value={k.waarde}>{k.label}</option>)}
          </Select>
        )}
      </Field>
      {heleMaanden ? (
        <>
          <Field label="Van maand" error={fout?.veld === 'van' ? fout.tekst : undefined}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} invalid={invalid} value={waarde.van.slice(0, 7)} onChange={(e) => onChange({ ...waarde, van: eersteVanMaand(`${e.target.value}-01`) })}>
                {maanden.map((m) => <option key={m} value={m}>{maandLabel(m)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Tot en met maand" error={fout?.veld === 'tot' ? fout.tekst : undefined}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} invalid={invalid} value={waarde.tot.slice(0, 7)} onChange={(e) => onChange({ ...waarde, tot: laatsteVanMaand(`${e.target.value}-01`) })}>
                {maanden.map((m) => <option key={m} value={m}>{maandLabel(m)}</option>)}
              </Select>
            )}
          </Field>
        </>
      ) : (
        <>
      <Field label="Van" error={fout?.veld === 'van' ? fout.tekst : undefined}>
        {({ id, describedBy, invalid }) => (
          <DateInput id={id} aria-describedby={describedBy} invalid={invalid} value={waarde.van} max={waarde.tot || undefined} onChange={(van) => onChange({ ...waarde, van })} dialogLabel="Begindatum kiezen" />
        )}
      </Field>
      <Field label="Tot en met" error={fout?.veld === 'tot' ? fout.tekst : undefined}>
        {({ id, describedBy, invalid }) => (
          <DateInput id={id} aria-describedby={describedBy} invalid={invalid} value={waarde.tot} min={waarde.van || undefined} onChange={(tot) => onChange({ ...waarde, tot })} dialogLabel="Einddatum kiezen" />
        )}
      </Field>
        </>
      )}
    </div>
  );
}

/**
 * Jaarkeuze voor rapporten die per kalenderjaar tellen (verlofsaldo). Een
 * gewone Select, nieuwste jaar bovenaan. Standaard vijf jaar terug tot
 * volgend jaar; `vanaf` (bv. het jaar van de eerste gegevens) rekt de lijst
 * op, en het gekozen jaar staat er altijd in, ook als het uit een link komt.
 */
export function JaarKiezer({ waarde, onChange, huidigJaar, vanaf, className }: {
  waarde: number;
  onChange: (jaar: number) => void;
  huidigJaar: number;
  vanaf?: number;
  className?: string;
}) {
  const eerste = Math.min(vanaf ?? huidigJaar - 5, huidigJaar - 5, waarde);
  const laatste = Math.max(huidigJaar + 1, waarde);
  const jaren = Array.from({ length: laatste - eerste + 1 }, (_, i) => laatste - i);
  return (
    <Field label="Jaar" className={className}>
      {({ id }) => (
        <Select id={id} value={String(waarde)} onChange={(e) => onChange(Number(e.target.value))}>
          {jaren.map((j) => <option key={j} value={j}>{j}</option>)}
        </Select>
      )}
    </Field>
  );
}
