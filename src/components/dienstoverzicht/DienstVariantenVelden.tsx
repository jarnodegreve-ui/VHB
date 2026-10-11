import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DAGTYPE_GROEPEN, dagtypeKort, dagtypeLabel, isKiesbaarDagtype, type DienstTijden } from '../../../shared/dagtype';
import { cn } from '../../lib/ui';
import type { Veldfouten } from '../../lib/formulier';
import { Card } from '../Card';
import { Field, Input } from '../Field';
import { Button, FilterChip, IconButton, MicroLabel, microLabelClass } from '../primitives';
import { TIJD_TITEL, dagtypeInGebruik, nieuweVariant, variantVeld, type VariantFormulier } from './dienstVarianten';

/**
 * Het blok "Afwijkingen per dagtype" in het dienstformulier (deel 2, 10-10):
 * per afwijking de dagtypes waarop ze geldt (keuzelijst per periode) en een
 * volledige set tijden, delen en loopnummers. Een nieuwe afwijking start met
 * de gewone tijden, zodat de planner alleen aanpast wat anders is. Een
 * dagtype kan maar in één afwijking staan: elders in gebruik = uitgeschakeld.
 *
 * Controle-ronde 10-10: alleen dagtypes die het portaal zelf kan afleiden
 * (KIESBARE_DAGTYPES); een nieuwe afwijking krijgt focus en komt in beeld;
 * na verwijderen gaat de focus terug naar de knop; de keuzelijst draagt
 * `data-fout` zodat focusEersteFout ze vindt; een uitgeschakelde chip zegt in
 * zijn naam waarom.
 */
const GROEPEN = DAGTYPE_GROEPEN
  .map((g) => ({ groep: g.groep, dagtypes: g.dagtypes.filter((d) => isKiesbaarDagtype(d.code)) }))
  .filter((g) => g.dagtypes.length > 0);

export function DienstVariantenVelden({ varianten, basis, onChange, fouten, wisVeld, disabled }: {
  varianten: VariantFormulier[];
  /** De gewone tijden van het formulier: het vertrekpunt van een nieuwe afwijking. */
  basis: DienstTijden;
  onChange: (varianten: VariantFormulier[]) => void;
  fouten: Veldfouten;
  wisVeld: (veld: string) => void;
  disabled?: boolean;
}) {
  const inGebruik = dagtypeInGebruik(varianten);
  const toevoegKnop = useRef<HTMLButtonElement>(null);
  const blokken = useRef(new Map<string, HTMLFieldSetElement>());
  // Na "Afwijking toevoegen": het nieuwe blok in beeld en de focus op zijn
  // eerste chip (op een telefoon staat het anders een scherm lager, onzichtbaar).
  const [focusOp, setFocusOp] = useState<string | null>(null);
  useEffect(() => {
    if (!focusOp) return;
    const blok = blokken.current.get(focusOp);
    setFocusOp(null);
    if (!blok) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    blok.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    // De eerste vrije chip van de keuzelijst, niet de verwijderknop in de kop.
    blok.querySelector<HTMLElement>('[role="group"] button:not([disabled])')?.focus({ preventScroll: true });
  }, [focusOp]);

  const zet = (i: number, patch: Partial<VariantFormulier>) => onChange(varianten.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const voegToe = () => {
    const nieuw = nieuweVariant(basis);
    onChange([...varianten, nieuw]);
    setFocusOp(nieuw.sleutel);
  };
  const weg = (i: number) => {
    onChange(varianten.filter((_, j) => j !== i));
    toevoegKnop.current?.focus();
  };
  const wissel = (i: number, code: string) => {
    const v = varianten[i];
    const nieuw = v.dagtypes.includes(code) ? v.dagtypes.filter((c) => c !== code) : [...v.dagtypes, code].sort();
    zet(i, { dagtypes: nieuw });
    wisVeld(variantVeld(v.sleutel, 'dagtypes'));
  };

  return (
    <div className="space-y-5 border-t border-hairline pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-subsection-title">Afwijkingen per dagtype</h3>
          <p className="text-body-sm text-slate-500">Andere tijden op bepaalde dagtypes; op alle andere dagen gelden de gewone tijden hierboven.</p>
        </div>
        {!disabled && (
          <Button ref={toevoegKnop} type="button" variant="secondary" size="sm" icon={<Plus size={14} />} onClick={voegToe}>
            Afwijking toevoegen
          </Button>
        )}
      </div>

      {varianten.map((v, i) => {
        const veld = (naam: string) => variantVeld(v.sleutel, naam);
        const dagtypeFout = fouten[veld('dagtypes')];
        // Een code die niet (meer) kiesbaar is maar wel in deze afwijking staat
        // (bv. uit een oudere versie), blijft zichtbaar zodat ze te verwijderen is.
        const overige = v.dagtypes.filter((c) => !isKiesbaarDagtype(c));
        const elders = (code: string) => { const e = inGebruik.get(code); return e !== undefined && e !== i ? e : null; };
        const ergensUitgeschakeld = GROEPEN.some((g) => g.dagtypes.some((d) => elders(d.code) !== null));
        const chip = (code: string, label: string) => {
          const andere = elders(code);
          return (
            <FilterChip
              key={code}
              active={v.dagtypes.includes(code)}
              disabled={disabled || andere !== null}
              aria-label={andere !== null ? `${label}, al in afwijking ${andere + 1}` : label}
              className={cn('min-w-11', andere !== null && 'cursor-not-allowed opacity-40')}
              onClick={() => wissel(i, code)}
            >
              {dagtypeKort(code)}
            </FilterChip>
          );
        };
        const tijd = (naam: 'startTime' | 'endTime' | 'startTime2' | 'endTime2' | 'startTime3' | 'endTime3', label: string, placeholder: string, verplicht = false) => (
          <Field label={label} htmlFor={veld(naam)} error={fouten[veld(naam)]}>
            <Input
              id={veld(naam)} type="text" inputMode="numeric" required={verplicht} pattern="\d{1,2}[:.]?\d{2}" title={TIJD_TITEL}
              placeholder={placeholder} value={v[naam]} className="tabular-nums"
              onChange={(e) => { zet(i, { [naam]: e.target.value }); wisVeld(veld(naam)); }}
            />
          </Field>
        );
        const loop = (naam: 'loopnr' | 'loopnr2' | 'loopnr3', label: string) => (
          <Field label={label} htmlFor={veld(naam)}>
            <Input id={veld(naam)} type="text" inputMode="numeric" placeholder="bv. 12" value={v[naam]} className="tabular-nums" onChange={(e) => zet(i, { [naam]: e.target.value })} />
          </Field>
        );
        return (
          <Card key={v.sleutel} tone="muted" padding="sm">
            <fieldset
              ref={(el) => { if (el) blokken.current.set(v.sleutel, el); else blokken.current.delete(v.sleutel); }}
              className="min-w-0 space-y-5"
            >
              {/* De legend moet het eerste kind zijn om de groep te benoemen; de
                  zichtbare kop staat ernaast met de verwijderknop. */}
              <legend className="sr-only">Afwijking {i + 1}</legend>
              <div className="flex items-center justify-between gap-3">
                <p aria-hidden="true" className={microLabelClass}>Afwijking {i + 1}</p>
                {!disabled && <IconButton label={`Afwijking ${i + 1} verwijderen`} size="sm" variant="danger" onClick={() => weg(i)}><Trash2 size={16} /></IconButton>}
              </div>

              {/* De keuzelijst: per periode de weekdagen als chips. Een code die
                  al in een andere afwijking staat is hier uitgeschakeld. */}
              <div
                role="group"
                aria-labelledby={`${veld('dagtypes')}-label`}
                aria-describedby={dagtypeFout ? `${veld('dagtypes')}-fout` : undefined}
                data-fout={dagtypeFout ? '' : undefined}
                className="space-y-2"
              >
                <MicroLabel className="block">
                  <span id={`${veld('dagtypes')}-label`}>Geldt op</span>
                </MicroLabel>
                {GROEPEN.map((g) => (
                  <div key={g.groep} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-x-3">
                    <span className="text-label shrink-0 sm:w-32">{g.groep}</span>
                    <div className="flex flex-wrap gap-1.5">{g.dagtypes.map((d) => chip(d.code, d.label))}</div>
                  </div>
                ))}
                {overige.length > 0 && (
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-x-3">
                    <span className="text-label shrink-0 sm:w-32">Overige</span>
                    <div className="flex flex-wrap gap-1.5">{overige.map((c) => chip(c, dagtypeLabel(c)))}</div>
                  </div>
                )}
                {ergensUitgeschakeld && <p className="text-xs text-slate-500">Grijze dagtypes staan al in een andere afwijking.</p>}
                {dagtypeFout && <p id={`${veld('dagtypes')}-fout`} role="alert" className="text-xs font-medium text-red-700">{dagtypeFout}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {tijd('startTime', 'Starttijd (deel 1)', '04:36', true)}
                {tijd('endTime', 'Eindtijd (deel 1)', '26:16', true)}
                {loop('loopnr', 'Loopnummer (deel 1)')}
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {tijd('startTime2', 'Starttijd (deel 2)', '—')}
                {tijd('endTime2', 'Eindtijd (deel 2)', '—')}
                {loop('loopnr2', 'Loopnummer (deel 2)')}
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {tijd('startTime3', 'Starttijd (deel 3)', '—')}
                {tijd('endTime3', 'Eindtijd (deel 3)', '—')}
                {loop('loopnr3', 'Loopnummer (deel 3)')}
              </div>
            </fieldset>
          </Card>
        );
      })}
    </div>
  );
}
