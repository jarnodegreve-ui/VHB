import { useId, useState } from 'react';
import { CalendarDays, ChevronRight, Search } from 'lucide-react';
import type { LeaveRequest, User } from '../types';
import { daysBetween } from '../lib/leaveBalance';
import { formatShortDay } from '../lib/format';
import { cn } from '../lib/ui';
import { Avatar } from './Avatar';
import { Card, CardHeader } from './Card';
import { Input, Select } from './Field';
import { Badge, Button, FilterChip, Segmented } from './primitives';
import { Paginering } from './Table';
import { EmptyState } from './ui';

type ZiekteFilter = 'nu' | 'alles';
const PER_PAGINA = 10;

/** Elke rij gaat over één registratie. De samenvatting erboven telt personen. */
export function ZiekteMeldingen({ meldingen, users, vandaag, dienstenVan, onOpen, historiek = false }: {
  meldingen: LeaveRequest[];
  users: User[];
  vandaag: string;
  dienstenVan: (melding: LeaveRequest) => number;
  onOpen: (melding: LeaveRequest) => void;
  historiek?: boolean;
}) {
  const [zoek, setZoek] = useState('');
  const [filter, setFilter] = useState<ZiekteFilter>('nu');
  const [status, setStatus] = useState('alle');
  const [metDiensten, setMetDiensten] = useState(false);
  const [pagina, setPagina] = useState(1);
  const namen = new Map(users.map((u) => [String(u.id), u.name]));
  const naamVan = (id: string) => namen.get(String(id)) ?? 'Onbekende chauffeur';
  const nu = meldingen.filter((r) => r.startDate <= vandaag).length;
  const query = zoek.trim().toLocaleLowerCase('nl');
  const resultaat = meldingen.filter((r) => {
    if (query && !naamVan(r.userId).toLocaleLowerCase('nl').includes(query)) return false;
    if (historiek) return status === 'alle' || (status === 'ingetrokken' ? r.status === 'cancelled' : r.status === 'approved');
    if (filter === 'nu' && r.startDate > vandaag) return false;
    return !metDiensten || dienstenVan(r) > 0;
  }).sort((a, b) => historiek
    ? b.startDate.localeCompare(a.startDate) || naamVan(a.userId).localeCompare(naamVan(b.userId), 'nl')
    : Number(dienstenVan(b) > 0) - Number(dienstenVan(a) > 0) || a.endDate.localeCompare(b.endDate) || naamVan(a.userId).localeCompare(naamVan(b.userId), 'nl'));
  const huidigePagina = Math.min(pagina, Math.max(1, Math.ceil(resultaat.length / PER_PAGINA)));
  const zichtbaar = resultaat.slice((huidigePagina - 1) * PER_PAGINA, huidigePagina * PER_PAGINA);
  const titel = historiek ? 'Historiek' : 'Actueel';
  const wisFilters = () => { setZoek(''); setFilter('alles'); setStatus('alle'); setMetDiensten(false); setPagina(1); };

  return (
    <section aria-label={titel} className="space-y-4">
      <CardHeader
        title={titel}
        description={historiek ? 'Afgelopen en ingetrokken registraties, van nieuw naar oud.' : undefined}
        aside={<span className="text-xs text-slate-500">{resultaat.length} {resultaat.length === 1 ? 'melding' : 'meldingen'}</span>}
      />
      <Card padding="none" className="@container overflow-hidden">
        <div className="space-y-3 border-b border-hairline p-4">
          {!historiek && (
            <Segmented
              label="Actuele ziekmeldingen filteren"
              waarde={filter}
              opties={[
                { waarde: 'nu', label: `Nu ziek (${nu})` },
                { waarde: 'alles', label: 'Alles' },
              ]}
              onChange={(waarde) => { setFilter(waarde); setPagina(1); }}
              className="flex w-full flex-wrap sm:w-fit"
              itemClassName="min-w-0 flex-1 px-2 text-xs sm:flex-none sm:whitespace-nowrap sm:px-3"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-[1_1_15rem]">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                aria-label={historiek ? 'Zoek in ziektehistoriek' : 'Zoek actuele ziekmeldingen'}
                placeholder="Zoek op chauffeur…"
                value={zoek}
                onChange={(e) => { setZoek(e.target.value); setPagina(1); }}
                className="pl-9"
              />
            </div>
            {historiek ? (
              <Select aria-label="Status ziektehistoriek" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }} className="w-full sm:w-44">
                <option value="alle">Alle registraties</option>
                <option value="afgelopen">Afgelopen</option>
                <option value="ingetrokken">Ingetrokken</option>
              </Select>
            ) : (
              <FilterChip active={metDiensten} onClick={() => { setMetDiensten((v) => !v); setPagina(1); }}>Met diensten op naam</FilterChip>
            )}
          </div>
        </div>

        {zichtbaar.length === 0 ? (
          <div className="p-4">
            <EmptyState
              compact
              title={historiek ? 'Geen meldingen gevonden' : 'Geen meldingen in deze selectie'}
              message={historiek ? 'Pas de zoekopdracht of het statusfilter aan.' : 'Kies een ander filter om de overige registraties te bekijken.'}
              action={meldingen.length > 0 ? <Button size="sm" onClick={wisFilters}>Toon alle meldingen</Button> : undefined}
            />
          </div>
        ) : (
          <>
            <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.9fr)_1rem] gap-4 border-b border-hairline-subtle bg-surface-soft px-4 py-2.5 text-xs font-medium text-slate-500 @[46rem]:grid">
              <span>Chauffeur</span><span>Geregistreerde periode</span><span>Kalenderdagen</span><span>{historiek ? 'Status' : 'Opvolging'}</span><span />
            </div>
            <ul className="divide-y divide-hairline-subtle" aria-label={historiek ? 'Eerdere ziekmeldingen' : 'Actuele ziekmeldingen'}>
              {zichtbaar.map((r) => <ZiekteRij key={r.id} melding={r} naam={naamVan(r.userId)} vandaag={vandaag} diensten={historiek ? 0 : dienstenVan(r)} historiek={historiek} onOpen={onOpen} />)}
            </ul>
            <Paginering totaal={resultaat.length} perPagina={PER_PAGINA} pagina={huidigePagina} onPagina={setPagina} className="border-t border-hairline" />
          </>
        )}
      </Card>
    </section>
  );
}

function ZiekteRij({ melding: r, naam, vandaag, diensten, historiek, onOpen }: {
  melding: LeaveRequest; naam: string; vandaag: string; diensten: number; historiek: boolean; onOpen: (r: LeaveRequest) => void;
}) {
  const beschrijvingId = useId();
  const komend = r.startDate > vandaag;
  const dagen = daysBetween(r.startDate, !historiek && !komend ? vandaag : r.endDate);
  const kort = (datum: string) => `${formatShortDay(datum)} ${datum.slice(0, 4)}`;
  return (
    <li className="min-w-0">
      {/* rauw: complete ziekmelding als één knop, opent het bestaande detail */}
      <button
        type="button"
        aria-label={`Bekijk ziekmelding van ${naam} vanaf ${r.startDate}`}
        aria-describedby={`${beschrijvingId}-periode ${beschrijvingId}-dagen ${beschrijvingId}-status`}
        onClick={() => onOpen(r)}
        className="ios-pressable grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 p-4 text-left transition-colors hover:bg-surface-row-hover @[46rem]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.9fr)_1rem] @[46rem]:items-center @[46rem]:gap-4"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar naam={naam} size="sm" />
          <span className="min-w-0 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{naam}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 self-center text-slate-400 @[46rem]:col-start-5 @[46rem]:row-start-1" aria-hidden="true" />
        <span id={`${beschrijvingId}-periode`} className="col-span-2 min-w-0 text-body-sm text-slate-600 @[46rem]:col-span-1 @[46rem]:col-start-2 @[46rem]:row-start-1">
          <span className="mb-1 block text-xs text-slate-500 @[46rem]:hidden">Geregistreerde periode</span>
          <span className="flex items-start gap-1.5"><CalendarDays size={14} className="mt-0.5 shrink-0 @[46rem]:hidden" /><span>{kort(r.startDate)}{r.startDate !== r.endDate && <><span className="text-slate-500"> t/m </span>{kort(r.endDate)}</>}</span></span>
        </span>
        <span id={`${beschrijvingId}-dagen`} className="min-w-0 text-sm text-slate-700 @[46rem]:col-start-3 @[46rem]:row-start-1">
          <span className="font-semibold">{dagen} {dagen === 1 ? 'dag' : 'dagen'}</span>
          <span className="block text-xs text-slate-500">{historiek || komend ? 'geregistreerd' : 't/m vandaag'}</span>
        </span>
        <span id={`${beschrijvingId}-status`} className="flex min-w-0 flex-col items-end gap-1.5 @[46rem]:col-start-4 @[46rem]:row-start-1 @[46rem]:items-start">
          {historiek ? <Badge tone="slate">{r.status === 'cancelled' ? 'Ingetrokken' : 'Afgelopen'}</Badge> : (
            <>
              {diensten > 0 ? <Badge tone="amber">{diensten} {diensten === 1 ? 'dienst' : 'diensten'} op naam</Badge> : <span className="text-xs text-slate-500">Geen diensten op naam</span>}
              <span className={cn('text-xs', r.endDate === vandaag ? 'font-semibold text-amber-800' : 'text-slate-500')}>
                {r.endDate === vandaag ? 'Melding loopt vandaag af' : komend ? 'Start nog niet bereikt' : `Gemeld t/m ${formatShortDay(r.endDate)}`}
              </span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}
