import type { RapportDefinitie, RapportFilters } from '../../shared/rapporten/types';
import { Field, Select } from './Field';
import { FilterChip } from './primitives';
import { JaarKiezer, Periodekiezer } from './Periodekiezer';
import { Chauffeurkiezer } from './Chauffeurkiezer';
import { Voertuigkiezer, type KiesbaarVoertuig } from './Voertuigkiezer';

/**
 * De filters van een rapport, in de volgorde van de definitie. Elke soort is
 * een eigen bouwsteen (Periodekiezer, JaarKiezer, Chauffeurkiezer,
 * Voertuigkiezer, een gewone Select voor een keuzelijst, een FilterChip voor
 * een vinkje); deze balk zet ze
 * alleen naast elkaar en geeft wijzigingen door als deelwijziging van de
 * filters. Telefoon: twee kolommen (een periode neemt de volle breedte), zodat
 * er geen rafelige rij ontstaat; vanaf sm vloeien de velden op één regel.
 */
type Persoon = { id: string; name: string; isActive?: boolean };

export function RapportFilterbalk({ def, filters, onChange, users, voertuigen, vandaag, jaarVanaf }: {
  def: RapportDefinitie;
  filters: RapportFilters;
  onChange: (wijziging: Partial<Omit<RapportFilters, 'keuzes' | 'vinkjes'>> & { keuzes?: Record<string, string>; vinkjes?: Record<string, boolean> }) => void;
  users: readonly Persoon[];
  voertuigen: readonly KiesbaarVoertuig[];
  /** Lokale kalenderdag van de gebruiker (ISO). */
  vandaag: string;
  /** Eerste jaar met gegevens, voor de jaarkeuze. */
  jaarVanaf?: number;
}) {
  if (def.filters.length === 0) return null;
  const veld = 'sm:w-52';
  return (
    <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-start">
      {def.filters.map((f) => {
        switch (f.soort) {
          case 'periode':
            return (
              <Periodekiezer
                key="periode"
                className="col-span-2 sm:w-full sm:max-w-xl"
                vandaag={vandaag}
                waarde={{ van: filters.van ?? '', tot: filters.tot ?? '' }}
                onChange={(p) => onChange({ van: p.van, tot: p.tot })}
              />
            );
          case 'jaar':
            return <JaarKiezer key="jaar" className="sm:w-32" huidigJaar={Number(vandaag.slice(0, 4))} vanaf={jaarVanaf} waarde={filters.jaar ?? Number(vandaag.slice(0, 4))} onChange={(jaar) => onChange({ jaar })} />;
          case 'chauffeur':
            return <Chauffeurkiezer key="chauffeur" className={veld} label={f.label} users={users} waarde={filters.chauffeur ?? ''} onChange={(id) => onChange({ chauffeur: id || undefined })} />;
          case 'voertuig':
            return <Voertuigkiezer key="voertuig" className={veld} voertuigen={voertuigen} waarde={filters.voertuig ?? ''} onChange={(id) => onChange({ voertuig: id || undefined })} />;
          case 'keuze':
            return (
              <Field key={f.id} label={f.label} className={veld}>
                {({ id }) => (
                  <Select id={id} value={filters.keuzes[f.id] ?? ''} onChange={(e) => onChange({ keuzes: { [f.id]: e.target.value } })}>
                    {f.opties.map((o) => <option key={o.waarde} value={o.waarde}>{o.label}</option>)}
                  </Select>
                )}
              </Field>
            );
          case 'vinkje':
            return (
              // Geen veldlabel: de chip zegt zelf wat hij doet. Hij staat op de
              // onderlijn van de velden, zodat hij naast de invoervakken uitkomt.
              <div key={f.id} className="col-span-2 flex items-end sm:self-end">
                <FilterChip active={Boolean(filters.vinkjes?.[f.id])} onClick={() => onChange({ vinkjes: { [f.id]: !filters.vinkjes?.[f.id] } })}>
                  {f.label}
                </FilterChip>
              </div>
            );
        }
      })}
    </div>
  );
}
