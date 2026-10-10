import { Plus, Trash2 } from 'lucide-react';
import { DAGTYPE_GROEPEN, dagtypeKort, type DienstTijden } from '../../../shared/dagtype';
import { cn } from '../../lib/ui';
import type { Veldfouten } from '../../lib/formulier';
import { Card } from '../Card';
import { Field, Input } from '../Field';
import { Button, FilterChip, IconButton, MicroLabel } from '../primitives';
import { dagtypeInGebruik, nieuweVariant, variantVeld, type VariantFormulier } from './dienstVarianten';

/**
 * Het blok "Afwijkingen per dagtype" in het dienstformulier (deel 2, 10-10):
 * per afwijking de dagtypes waarop ze geldt (keuzelijst per periode) en een
 * volledige set tijden, delen en loopnummers. Een nieuwe afwijking start met
 * de gewone tijden, zodat de planner alleen aanpast wat anders is. Een
 * dagtype kan maar in één afwijking staan: elders in gebruik = uitgeschakeld.
 */
const TIJD_TITEL = 'UU:MM, na middernacht als 24:00+ (bv. 26:16)';

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
  const zet = (i: number, patch: Partial<VariantFormulier>) => onChange(varianten.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const weg = (i: number) => onChange(varianten.filter((_, j) => j !== i));
  const wissel = (i: number, code: string) => {
    const v = varianten[i];
    const nieuw = v.dagtypes.includes(code) ? v.dagtypes.filter((c) => c !== code) : [...v.dagtypes, code].sort();
    zet(i, { dagtypes: nieuw });
    wisVeld(variantVeld(v.sleutel, 'dagtypes'));
  };

  return (
    <div className="space-y-4 border-t border-hairline pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <MicroLabel>Afwijkingen per dagtype</MicroLabel>
          <p className="text-body-sm text-slate-500">
            Andere tijden op bepaalde dagtypes, bijvoorbeeld een korter namiddagdeel op een woensdag schooldag. Op alle andere dagen gelden de gewone tijden hierboven.
          </p>
        </div>
        {!disabled && (
          <Button type="button" variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => onChange([...varianten, nieuweVariant(basis)])}>
            Afwijking toevoegen
          </Button>
        )}
      </div>

      {varianten.map((v, i) => {
        const veld = (naam: string) => variantVeld(v.sleutel, naam);
        const dagtypeFout = fouten[veld('dagtypes')];
        const tijd = (naam: 'startTime' | 'endTime' | 'startTime2' | 'endTime2' | 'startTime3' | 'endTime3', label: string, verplicht = false) => (
          <Field label={label} htmlFor={veld(naam)} error={fouten[veld(naam)]}>
            <Input
              id={veld(naam)} type="text" inputMode="numeric" required={verplicht} pattern="\d{1,2}:\d{2}" title={TIJD_TITEL}
              placeholder={verplicht ? '06:30' : '—'} value={v[naam]} className="tabular-nums"
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
          <Card key={v.sleutel} tone="muted" padding="none" className="p-4 sm:p-5">
            <fieldset className="min-w-0 space-y-4">
              {/* De legend moet het eerste kind zijn om de groep te benoemen; de
                  zichtbare kop staat ernaast met de verwijderknop. */}
              <legend className="sr-only">Afwijking {i + 1}</legend>
              <div className="flex items-center justify-between gap-3">
                <span aria-hidden="true" className="text-card-title">Afwijking {i + 1}</span>
                {!disabled && <IconButton label={`Afwijking ${i + 1} verwijderen`} size="sm" variant="danger" onClick={() => weg(i)}><Trash2 size={16} /></IconButton>}
              </div>

              {/* De keuzelijst: per periode de weekdagen als chips. Een code die
                  al in een andere afwijking staat is hier uitgeschakeld. */}
              <div role="group" aria-labelledby={`${veld('dagtypes')}-label`} aria-describedby={dagtypeFout ? `${veld('dagtypes')}-fout` : undefined} className="space-y-2">
                <MicroLabel className="block">
                  <span id={`${veld('dagtypes')}-label`}>Geldt op</span>
                </MicroLabel>
                {DAGTYPE_GROEPEN.map((g) => (
                  <div key={g.groep} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-x-3">
                    <span className="shrink-0 text-xs font-medium text-slate-600 sm:w-32">{g.groep}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {g.dagtypes.map((d) => {
                        const elders = inGebruik.get(d.code);
                        const andere = elders !== undefined && elders !== i;
                        return (
                          <FilterChip
                            key={d.code}
                            active={v.dagtypes.includes(d.code)}
                            disabled={disabled || andere}
                            aria-label={d.label}
                            title={andere ? `${d.label}: al in afwijking ${elders + 1}` : d.label}
                            className={cn('min-w-11', andere && 'opacity-40')}
                            onClick={() => wissel(i, d.code)}
                          >
                            {dagtypeKort(d.code)}
                          </FilterChip>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {dagtypeFout && <p id={`${veld('dagtypes')}-fout`} role="alert" className="text-xs font-medium text-red-700">{dagtypeFout}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {tijd('startTime', 'Starttijd (deel 1)', true)}
                {tijd('endTime', 'Eindtijd (deel 1)', true)}
                {loop('loopnr', 'Loopnummer (deel 1)')}
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {tijd('startTime2', 'Starttijd (deel 2)')}
                {tijd('endTime2', 'Eindtijd (deel 2)')}
                {loop('loopnr2', 'Loopnummer (deel 2)')}
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {tijd('startTime3', 'Starttijd (deel 3)')}
                {tijd('endTime3', 'Eindtijd (deel 3)')}
                {loop('loopnr3', 'Loopnummer (deel 3)')}
              </div>
            </fieldset>
          </Card>
        );
      })}
    </div>
  );
}
