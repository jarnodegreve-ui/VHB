import { useMemo } from 'react';
import { Field, Select } from './Field';
import { onbekendLabel } from '../../shared/rapporten/filters';

/**
 * Chauffeurkiezer: één persoon of "Alle", alfabetisch, wie uit dienst is
 * staat onderaan in een eigen groep en draagt "(uit dienst)". Bewust een
 * gewone Select (geen zoekveld): de lijst is enkele tientallen namen en de
 * native kiezer is op de telefoon het snelst.
 *
 * `waarde` = id of '' (alle). Een id dat niet (meer) in de lijst staat blijft
 * als "Onbekend (<id>)" kiesbaar, zodat een gedeelde link naar een verwijderd
 * account niet stil op "Alle" terugvalt.
 */
type Persoon = { id: string; name: string; isActive?: boolean };

export function Chauffeurkiezer({ users, waarde, onChange, label = 'Chauffeur', alleLabel = 'Alle', className }: {
  users: readonly Persoon[];
  waarde: string;
  onChange: (id: string) => void;
  label?: string;
  alleLabel?: string;
  className?: string;
}) {
  const { actief, uitDienst } = useMemo(() => {
    const opNaam = (a: Persoon, b: Persoon) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });
    return {
      actief: users.filter((u) => u.isActive !== false).sort(opNaam),
      uitDienst: users.filter((u) => u.isActive === false).sort(opNaam),
    };
  }, [users]);
  const onbekend = waarde !== '' && !users.some((u) => u.id === waarde);
  return (
    <Field label={label} className={className}>
      {({ id }) => (
        <Select id={id} value={waarde} onChange={(e) => onChange(e.target.value)}>
          <option value="">{alleLabel}</option>
          {onbekend && <option value={waarde}>{onbekendLabel(waarde)}</option>}
          {actief.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          {uitDienst.length > 0 && (
            <optgroup label="Uit dienst">
              {uitDienst.map((u) => <option key={u.id} value={u.id}>{u.name} (uit dienst)</option>)}
            </optgroup>
          )}
        </Select>
      )}
    </Field>
  );
}
