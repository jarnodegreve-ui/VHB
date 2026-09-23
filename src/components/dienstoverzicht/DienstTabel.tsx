import { useState, type ReactNode } from 'react';
import { Clock } from 'lucide-react';
import type { Service } from '../../types';
import { EmptyState } from '../ui';
import { Button, MicroLabel } from '../primitives';
import { CelKnop, SortTh, StickyThead, TableToolbar, rijKlik, useSort, useTabelVoorkeur } from '../Table';
import { Tabel, TableShell, Td, Th } from '../TabelBasis';
import { LegeLijst, NietGevonden } from '../illustraties';
import { Zijvak, ZijvakRij } from '../Zijvak';
import { dienstStatistiek, formatDienstDuur } from '../../lib/dienstStatistiek';
import { cn } from '../../lib/ui';
import { delenVan, dienstSorteerWaarde, hasValidTime, tijdvak, zoekDiensten, type DienstSortering } from './dienstDelen';

/**
 * De gedeelde kern van het Dienstoverzicht (3D.1, 23-09): zoeken, sorteren op
 * de kolomkoppen, de tabel en de kaartlijst uit één databron, de lege staten
 * en de kerncijfers. Het scherm houdt de toestand (`useDienstLijst`), zodat
 * zoekterm en sortering blijven staan als er iets naast de lijst opengaat.
 * Beheeracties komen er alleen in via `rijActies`; de kern kent geen rollen.
 */

export function useDienstLijst(services: Service[], standaard: DienstSortering = 'volgorde') {
  const [zoek, setZoek] = useState('');
  const sort = useSort<DienstSortering>(standaard);
  const volgorde = new Map(services.map((s, i) => [s.id, i]));
  const gesorteerd = sort.sorteer(zoekDiensten(services, zoek), (s, k) => dienstSorteerWaarde(s, k, volgorde));
  return { zoek, setZoek, sort, gesorteerd };
}

export type DienstLijst = ReturnType<typeof useDienstLijst>;

export function DienstTabel({ services, lijst, rijActies, onKies, gekozenId, leegTekst, leegActie, zijvak, boven }: {
  services: Service[];
  lijst: DienstLijst;
  /** Het "…"-menu per dienst; zonder dit geen kolom Acties. */
  rijActies?: (s: Service) => ReactNode;
  /** Dienst openen (detailpaneel): het dienstnummer wordt een knop en de
   *  hele rij of kaart klikbaar (rijKlik negeert knoppen en menu's). */
  onKies?: (s: Service) => void;
  /** De dienst die nu open staat (rij gemarkeerd, aria-current). */
  gekozenId?: string | null;
  /** Iets boven de tabel in dezelfde kolom, bv. de melding van een onbekende recordlink. */
  boven?: ReactNode;
  leegTekst: string;
  leegActie?: ReactNode;
  zijvak?: ReactNode;
}) {
  const { zoek, setZoek, sort, gesorteerd } = lijst;
  // Rijdichtheid, onthouden per toestel (zelfde sleutel als vroeger in Beheer).
  const voorkeur = useTabelVoorkeur('dienstoverzicht');
  const leeg = <span className="font-normal text-slate-300">—</span>;
  const nummer = (s: Service, className?: string) => onKies
    ? <CelKnop onClick={() => onKies(s)} label={`Dienst ${s.serviceNumber} openen`} className={className}>{s.serviceNumber}</CelKnop>
    : <span className={className}>{s.serviceNumber}</span>;

  return (
    // Acht kolommen hebben voorrang op het zijvak: op een laptop staat het
    // overzicht eronder, pas op een breed scherm ernaast.
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:items-start">
      {/* Container query i.p.v. md (bewust, tranche 3B): de kolom staat naast
          de zijbalk en vanaf 2xl naast het zijvak, dus de schermbreedte zegt
          niet hoeveel plaats de kolommen krijgen. Onder 42rem echte
          kolombreedte neemt de kaartlijst het over; de layout-e2e bewaakt
          390 tot 1536 px. */}
      <div className="@container min-w-0 space-y-4">
        {boven}
        {/* `past`: de tabel verschijnt pas vanaf 42rem en past daar in haar
            kader, dus geen scrollcontainer en de kolomkop plakt. */}
        <TableShell
          label="Diensten"
          past
          kop={(
            <TableToolbar
              zoek={zoek}
              onZoek={setZoek}
              placeholder="Zoek op dienst- of loopnummer…"
              telling={`${gesorteerd.length} van ${services.length}`}
              dichtheid={voorkeur.dichtheid}
              className="md:flex-wrap"
            />
          )}
        >
          {gesorteerd.length > 0 && (
            <div className="hidden @[42rem]:block">
              <Tabel className={voorkeur.tabelClass}>
                <StickyThead>
                  <tr>
                    {/* Zelfde indeling als het totaaloverzicht van de planning:
                        per deel eerst het loopnummer, dan de uren. */}
                    <SortTh kolom="dienst" sort={sort} className="[&_button]:px-3">Dienst</SortTh>
                    <SortTh kolom="loop1" sort={sort} className="[&_button]:px-3">Loop 1</SortTh>
                    <SortTh kolom="start" sort={sort} className="[&_button]:px-3">Deel 1</SortTh>
                    <Th className="px-3">Loop 2</Th>
                    <Th className="px-3">Deel 2</Th>
                    <Th className="px-3">Loop 3</Th>
                    <Th className="px-3">Deel 3</Th>
                    {rijActies && <Th className="px-3 text-right">Acties</Th>}
                  </tr>
                </StickyThead>
                <tbody>
                  {gesorteerd.map((s) => {
                    const deel2 = hasValidTime(s.startTime2, s.endTime2);
                    const deel3 = hasValidTime(s.startTime3, s.endTime3);
                    return (
                      <tr
                        key={s.id}
                        onClick={onKies ? rijKlik(() => onKies(s)) : undefined}
                        aria-current={gekozenId === s.id ? 'true' : undefined}
                        className={cn('border-b border-hairline-subtle last:border-b-0 hover:bg-surface-soft-hover transition-colors', onKies && 'cursor-pointer', gekozenId === s.id && 'bg-slate-100/60')}
                      >
                        {/* px-3 i.p.v. px-4: acht kolommen moeten vanaf 42rem
                            naast elkaar passen. Nummers en tijdvakken breken nooit af. */}
                        <Td nowrap className="px-3 font-semibold text-slate-800">{nummer(s)}</Td>
                        <Td nowrap className="px-3 font-semibold text-slate-700">{s.loopnr || leeg}</Td>
                        <Td nowrap className="px-3">{tijdvak(s.startTime, s.endTime)}</Td>
                        <Td nowrap className="px-3 font-semibold text-slate-700">{deel2 && s.loopnr2 ? s.loopnr2 : leeg}</Td>
                        <Td nowrap className="px-3">{deel2 ? tijdvak(s.startTime2!, s.endTime2!) : ''}</Td>
                        <Td nowrap className="px-3 font-semibold text-slate-700">{deel3 && s.loopnr3 ? s.loopnr3 : leeg}</Td>
                        <Td nowrap className="px-3">{deel3 ? tijdvak(s.startTime3!, s.endTime3!) : ''}</Td>
                        {rijActies && <Td className="w-14 px-3 text-right">{rijActies(s)}</Td>}
                      </tr>
                    );
                  })}
                </tbody>
              </Tabel>
            </div>
          )}

          {/* Smalle kolom: kaart per dienst; op tablet passen de drie delen
              naast elkaar zonder dienst- of loopgegevens te verbergen. */}
          <div className="@[42rem]:hidden divide-y divide-hairline-subtle">
            {gesorteerd.map((s) => (
              <div
                key={s.id}
                onClick={onKies ? rijKlik(() => onKies(s)) : undefined}
                aria-current={gekozenId === s.id ? 'true' : undefined}
                className={cn('p-5 space-y-4 hover:bg-surface-soft-hover transition-colors', onKies && 'cursor-pointer', gekozenId === s.id && 'bg-slate-100/60')}
              >
                <div className="flex justify-between items-center">
                  {nummer(s, 'text-card-title')}
                  {rijActies?.(s)}
                </div>
                <div className="grid grid-cols-1 gap-3 @[30rem]:grid-cols-3">
                  {delenVan(s).map((d) => (
                    <div key={d.nr} className="flex flex-col gap-1">
                      <MicroLabel>Deel {d.nr}{d.loop ? ` · loop ${d.loop}` : ''}</MicroLabel>
                      <div className="flex items-center gap-2 whitespace-nowrap text-slate-700 font-semibold text-sm">
                        <Clock size={14} className="text-slate-500" />
                        {tijdvak(d.start, d.eind)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {gesorteerd.length === 0 && (
            <div className="p-6">
              {zoek.trim() ? (
                <EmptyState
                  illustratie={<NietGevonden />}
                  title={`Geen resultaten voor “${zoek.trim()}”`}
                  message="Zoek op dienstnummer of loopnummer."
                  action={<Button variant="secondary" onClick={() => setZoek('')}>Zoekterm wissen</Button>}
                />
              ) : (
                <EmptyState illustratie={<LegeLijst />} title="Nog geen diensten" message={leegTekst} action={leegActie} />
              )}
            </div>
          )}
        </TableShell>
      </div>
      {zijvak && <aside className="min-w-0 self-start 2xl:sticky 2xl:top-[calc(var(--sticky-top)+1.25rem)]">{zijvak}</aside>}
    </div>
  );
}

/** Kerncijfers over álle diensten, niet over het zoekresultaat. */
export function DienstZijvak({ services, aside, voet }: { services: Service[]; aside?: ReactNode; voet?: ReactNode }) {
  const stat = dienstStatistiek(services);
  const uiterste = (u: { serviceNumber: string; minuten: number } | null) =>
    u ? `${u.serviceNumber} · ${formatDienstDuur(u.minuten)}` : '—';
  return (
    <Zijvak titel="Overzicht" aside={aside} voet={voet}>
      <ZijvakRij label="Diensten" waarde={stat.diensten} mono />
      <ZijvakRij label="Loops" waarde={stat.loops} mono />
      <ZijvakRij label="Langste dienst" waarde={uiterste(stat.langste)} mono />
      <ZijvakRij label="Kortste dienst" waarde={uiterste(stat.kortste)} mono />
    </Zijvak>
  );
}
