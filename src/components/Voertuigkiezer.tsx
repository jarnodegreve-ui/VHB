import { useEffect, useMemo, useState } from 'react';
import { Field, Select } from './Field';
import { laadVoertuigen } from '../lib/techniek';
import { onbekendLabel } from '../../shared/rapporten/filters';

/** Wat de kiezer van een voertuig nodig heeft (Vehicle en VehicleKort voldoen). */
export type KiesbaarVoertuig = { id: string; busnr: string; kortNr?: number | null; status: string };

export const voertuigLabel = (v: KiesbaarVoertuig): string => (v.kortNr != null ? `${v.busnr} (${v.kortNr})` : v.busnr);

const opBus = (a: KiesbaarVoertuig, b: KiesbaarVoertuig) =>
  (a.kortNr ?? Number.MAX_SAFE_INTEGER) - (b.kortNr ?? Number.MAX_SAFE_INTEGER) || a.busnr.localeCompare(b.busnr, 'nl', { numeric: true });

/**
 * Het wagenpark voor een kiezer of voor de naam in een printkop. Zelf-ladend
 * (de voertuigen zitten niet in de collecties van de schil) en alleen als
 * `actief` waar is, zodat een rapport zonder voertuigfilter niets ophaalt.
 * Een laadfout is geen ramp: de kiezer toont dan alleen "Alle".
 */
export function useVoertuigen(actief: boolean): KiesbaarVoertuig[] {
  const [voertuigen, setVoertuigen] = useState<KiesbaarVoertuig[]>([]);
  useEffect(() => {
    if (!actief) return;
    let leeft = true;
    laadVoertuigen().then((v) => { if (leeft) setVoertuigen(v); }).catch(() => { /* kiezer blijft op "Alle" */ });
    return () => { leeft = false; };
  }, [actief]);
  return voertuigen;
}

/**
 * Voertuigkiezer: één bus of "Alle", op kort nummer en busnummer gesorteerd;
 * wat niet meer actief is staat onderaan in een eigen groep. Zelfde opzet als
 * de Chauffeurkiezer.
 */
export function Voertuigkiezer({ voertuigen, waarde, onChange, label = 'Voertuig', className }: {
  voertuigen: readonly KiesbaarVoertuig[];
  waarde: string;
  onChange: (id: string) => void;
  label?: string;
  className?: string;
}) {
  const { actief, uitDienst } = useMemo(() => ({
    actief: voertuigen.filter((v) => v.status === 'actief').sort(opBus),
    uitDienst: voertuigen.filter((v) => v.status !== 'actief').sort(opBus),
  }), [voertuigen]);
  const onbekend = waarde !== '' && !voertuigen.some((v) => v.id === waarde);
  return (
    <Field label={label} className={className}>
      {({ id }) => (
        <Select id={id} value={waarde} onChange={(e) => onChange(e.target.value)}>
          <option value="">Alle</option>
          {onbekend && <option value={waarde}>{onbekendLabel(waarde)}</option>}
          {actief.map((v) => <option key={v.id} value={v.id}>{voertuigLabel(v)}</option>)}
          {uitDienst.length > 0 && (
            <optgroup label="Uit dienst">
              {uitDienst.map((v) => <option key={v.id} value={v.id}>{voertuigLabel(v)} (uit dienst)</option>)}
            </optgroup>
          )}
        </Select>
      )}
    </Field>
  );
}
