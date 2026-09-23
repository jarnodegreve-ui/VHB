import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Download } from 'lucide-react';
import type { Service } from '../types';
import { downloadBlob } from '../lib/ui';
import { dienstoverzichtCsv } from '../lib/dienstoverzichtExport';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Button, Chip, MicroLabel, Segmented } from '../components/primitives';
import { Uitklap } from '../components/Uitklap';
import { RecordRij } from '../components/RecordRij';
import { SearchField } from '../components/Field';
import { Zijvak, ZijvakLayout, ZijvakRij } from '../components/Zijvak';
import { dienstStatistiek, formatDienstDuur } from '../lib/dienstStatistiek';
import { LegeLijst, NietGevonden } from '../components/illustraties';
import { Tabel, TableShell, Td, Th } from '../components/TabelBasis';
import { vandaagBrussel } from '../lib/brussel';

export function ServicesView({ services }: { services: Service[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'number' | 'time'>('number');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const hasValidTime = (start?: string, end?: string) =>
    !!start && !!end && /^\d{1,2}:\d{2}$/.test(start) && /^\d{1,2}:\d{2}$/.test(end);

  // Zoekt op dienstnummer én op loopnummer: "welke dienst bevat loop 4515?"
  // is een dagelijkse vraag sinds de loopnummers erin staan.
  const zoek = searchQuery.trim().toLowerCase();
  const filteredServices = services.filter((s) =>
    !zoek ||
    s.serviceNumber.toLowerCase().includes(zoek) ||
    [s.loopnr, s.loopnr2, s.loopnr3].some((l) => (l || '').toLowerCase().includes(zoek))
  ).sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'number') {
      comparison = a.serviceNumber.localeCompare(b.serviceNumber, undefined, { numeric: true });
    } else {
      comparison = a.startTime.localeCompare(b.startTime);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const toggleSort = (field: 'number' | 'time') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  /** "04:36–07:52": en-dash zonder spaties, zoals Beheer dienstoverzicht. */
  const tijdvak = (van: string, tot: string) => `${van}–${tot}`;

  const downloadCSV = () => {
    const blob = new Blob([dienstoverzichtCsv(filteredServices)], { type: 'text/csv;charset=utf-8;' });
    void downloadBlob(`dienstoverzicht_${vandaagBrussel()}.csv`, blob);
  };

  // Kerncijfers voor het zijvak — over álle diensten, niet het zoekresultaat.
  const stat = dienstStatistiek(services);
  const uiterste = (u: { serviceNumber: string; minuten: number } | null) =>
    u ? `${u.serviceNumber} · ${formatDienstDuur(u.minuten)}` : '—';

  return (
    <PageShell>
      <PageHeader
        view="dienstoverzicht"
        title="Dienstoverzicht"
        actions={(
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Nogmaals op het actieve item klikken wisselt de richting (toggleSort). */}
            <Segmented
              label="Sorteren"
              waarde={sortBy}
              opties={[
                { waarde: 'number' as const, label: <>Dienst #{sortBy === 'number' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</> },
                { waarde: 'time' as const, label: <>Starttijd{sortBy === 'time' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</> },
              ]}
              onChange={toggleSort}
            />
            <SearchField value={searchQuery} onChange={setSearchQuery} placeholder="Zoek op dienst- of loopnummer…" className="basis-full md:basis-auto md:flex-1 md:w-64" />
          </div>
        )}
      />

      {/* Desktop: tabel als hoofdkolom, kerncijfers + CSV in het zijvak
          (afwerkingsronde 04-09); zonder diensten voegt het vak niets toe.
          Pas vanaf xl: op iPad-landscape (lg) kneep het vak van 20 rem de
          tabel tot ±340 px (controle 05-09, nr. 18). */}
      <ZijvakLayout
        breekpunt="xl"
        zijvak={services.length > 0 ? (
          <Zijvak
            titel="Overzicht"
            voet={(
              <Button variant="secondary" size="sm" onClick={downloadCSV} icon={<Download size={14} />}>
                CSV downloaden
              </Button>
            )}
          >
            <ZijvakRij label="Diensten" waarde={stat.diensten} mono />
            <ZijvakRij label="Loops" waarde={stat.loops} mono />
            <ZijvakRij label="Langste dienst" waarde={uiterste(stat.langste)} mono />
            <ZijvakRij label="Kortste dienst" waarde={uiterste(stat.kortste)} mono />
          </Zijvak>
        ) : undefined}
      >
      {/* Standaardoverloop (schuiven in het kader, geen plakkende kop): naast
          de zijbalk en vanaf xl naast het zijvak is de tabel een paar
          pixels te breed, dus een scrollcontainer is nodig en dan kan de
          kop niet plakken (gemeten, tranche 3B). Telefoon (onder md): een
          lijst per dienst die openklapt. */}
      <TableShell label="Dienstoverzicht">
        <div className="hidden md:block">
          <Tabel>
            <thead className="bg-surface-soft border-b border-hairline-subtle">
              {/* Zelfde indeling als het totaaloverzicht van de planning:
                  per deel eerst het loopnummer, dan de uren. De sortering
                  kies je in de kop (Segmented); aria-sort volgt die keuze. */}
              <tr>
                <Th sort={sortBy === 'number' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}>Dienst</Th>
                <Th>Loop 1</Th>
                <Th sort={sortBy === 'time' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}>Deel 1</Th>
                <Th>Loop 2</Th>
                <Th>Deel 2</Th>
                <Th>Loop 3</Th>
                <Th>Deel 3</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-subtle">
              {filteredServices.map(s => (
                <tr key={s.id} className="hover:bg-surface-soft-hover transition-colors">
                  <Td nowrap>
                    <span className="font-semibold text-slate-800">{s.serviceNumber}</span>
                  </Td>
                  <Td nowrap><LoopCell loopnr={s.loopnr} /></Td>
                  <Td nowrap><TimeCell start={s.startTime} end={s.endTime} /></Td>
                  <Td nowrap><LoopCell loopnr={hasValidTime(s.startTime2, s.endTime2) ? s.loopnr2 : undefined} /></Td>
                  <Td nowrap>{hasValidTime(s.startTime2, s.endTime2) ? <TimeCell start={s.startTime2!} end={s.endTime2!} /> : null}</Td>
                  <Td nowrap><LoopCell loopnr={hasValidTime(s.startTime3, s.endTime3) ? s.loopnr3 : undefined} /></Td>
                  <Td nowrap>{hasValidTime(s.startTime3, s.endTime3) ? <TimeCell start={s.startTime3!} end={s.endTime3!} /> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Tabel>
        </div>

        {/* Telefoon: het rijrecept (RecordRij). De titel is het dienstnummer,
            de metaregel de uren van het eerste deel en het aantal delen, zodat
            je zonder openklappen al ziet wanneer de dienst begint. */}
        <ul className="md:hidden divide-y divide-hairline-subtle" aria-label="Diensten">
          {filteredServices.map((s) => {
            const isExpanded = expandedIds.has(s.id);
            const delen = [
              { start: s.startTime, end: s.endTime, loop: s.loopnr, geldig: true },
              { start: s.startTime2, end: s.endTime2, loop: s.loopnr2, geldig: hasValidTime(s.startTime2, s.endTime2) },
              { start: s.startTime3, end: s.endTime3, loop: s.loopnr3, geldig: hasValidTime(s.startTime3, s.endTime3) },
            ].filter((d) => d.geldig);
            return (
              <RecordRij
                key={s.id}
                titel={s.serviceNumber}
                meta={`${tijdvak(s.startTime, s.endTime)}${delen.length > 1 ? ` · ${delen.length} delen` : ''}`}
                richting="omlaag"
                open={isExpanded}
                onClick={() => toggleExpanded(s.id)}
              >
                <Uitklap open={isExpanded}>
                  <div className="grid grid-cols-1 gap-3 px-4 pb-4">
                    {delen.map((d, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <MicroLabel>Deel {i + 1}</MicroLabel>
                        <div className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-slate-700">
                          <Clock size={14} className="text-slate-500" />
                          {tijdvak(d.start ?? '', d.end ?? '')}
                          <LoopChip loopnr={d.loop} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Uitklap>
              </RecordRij>
            );
          })}
        </ul>

        {filteredServices.length === 0 && (
          <div className="px-6 py-6">
            <EmptyState
              illustratie={searchQuery ? <NietGevonden /> : <LegeLijst />}
              title="Geen diensten gevonden"
              message={searchQuery ? `Geen diensten gevonden voor “${searchQuery}”.` : 'Er zijn nog geen diensten beschikbaar.'}
            />
          </div>
        )}
      </TableShell>
      </ZijvakLayout>
    </PageShell>
  );
}

/** Loopnummer van een dienstdeel — het deel van de dienst waaronder bepaalde
 *  ritten vallen. Toont niets zolang er geen nummer ingevuld is. */
function LoopChip({ loopnr }: { loopnr?: string }) {
  if (!loopnr?.trim()) return null;
  return (
    <Chip>loop {loopnr.trim()}</Chip>
  );
}

/** Loopnummer als eigen tabelkolom (zoals in het totaaloverzicht). */
function LoopCell({ loopnr }: { loopnr?: string }) {
  const value = loopnr?.trim();
  if (!value) return <span className="text-slate-300">—</span>;
  return <span className="font-semibold text-slate-700">{value}</span>;
}

/** Uren van één dienstdeel. */
function TimeCell({ start, end }: { start: string; end: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium text-slate-700 whitespace-nowrap">
      <Clock size={14} className="text-slate-500" />
      {start}–{end}
    </span>
  );
}
