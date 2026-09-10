import { useState } from 'react';
import { Calendar, ChevronRight, Download, FileText, Search, X } from 'lucide-react';
import { LijnTegel } from '../components/LijnTegel';
import { isAlleLijnen, lijnLabel, lijnenVan, raaktLijn } from '../../shared/lijnen';
import { isExpiredDiversion, omleidingsFase, omleidingsPeriode, sorteerOmleidingen } from '../lib/diversions';
import type { Diversion } from '../types';
import { formatSyncedTime } from '../lib/format';
import { cn, openPdfInNewTab, safeDocumentHref } from '../lib/ui';
import { kiesRecord } from '../lib/overgang';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, IconButton } from '../components/primitives';
import { Card } from '../components/Card';
import { Input, Select } from '../components/Field';
import { DetailPaneel, MasterDetail, useInlinePaneel } from '../components/DetailPaneel';
import { LegeLijst, NietGevonden } from '../components/illustraties';

/**
 * Lijst + detail via het gedeelde DetailPaneel: op desktop staat de
 * omleiding rechts naast de lijst, op mobiel opent ze in een SlideOver.
 */
export function DiversionsView({ diversions, lastSyncedAt = null }: { diversions: Diversion[]; lastSyncedAt?: number | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLine, setSelectedLine] = useState<string>('all');
  const inline = useInlinePaneel();

  // Get unique line numbers for the filter
  // Per lijn, niet per omleiding: "883, 884" telt als twee lijnen in de filter.
  // "Alle" is geen lijn maar een bereik; die omleidingen vallen onder elke filterkeuze.
  const uniqueLines = Array.from(new Set(diversions.flatMap((div) => lijnenVan(div.line)).filter((l) => !isAlleLijnen(l)))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // Chronologisch: lopend, komend, verlopen (zie sorteerOmleidingen).
  const sortedForList = sorteerOmleidingen(diversions);
  const filteredDiversions = sortedForList.filter(div => {
    const matchesSearch = div.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      div.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      div.line.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesLine = selectedLine === 'all' || raaktLijn(div.line, selectedLine);

    return matchesSearch && matchesLine;
  });

  // Mobiel: alleen wat de chauffeur zelf opentikte (SlideOver). Desktop: valt
  // terug op de eerste actieve omleiding in de (gefilterde) lijst, zodat het
  // paneel nooit leeg opent; verdwijnt de keuze uit de lijst door een filter,
  // dan springt het paneel mee naar de eerste die overblijft.
  const gekozen = filteredDiversions.find((d) => d.id === selectedId) ?? null;
  const detail = inline
    ? gekozen ?? filteredDiversions.find((d) => !isExpiredDiversion(d)) ?? filteredDiversions[0] ?? null
    : gekozen;

  return (
    <PageShell>
      <PageHeader
        title="Omleidingen"
        description="Actuele omleidingen."
        actions={(
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <Select
              value={selectedLine}
              onChange={(e) => setSelectedLine(e.target.value)}
              aria-label="Filter op lijn"
              className="sm:w-40 font-semibold cursor-pointer"
            >
              <option value="all">Alle lijnen</option>
              {uniqueLines.map(line => (
                <option key={line} value={line}>{lijnLabel(line)}</option>
              ))}
            </Select>
            <div className="relative flex-1 md:w-72 group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={16} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
              </div>
              <Input
                type="text"
                placeholder="Zoek…"
                aria-label="Zoek in omleidingen"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={cn('pl-9', searchQuery && 'pr-11')}
              />
              {searchQuery && (
                <IconButton
                  label="Wis zoekopdracht"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
                >
                  <X size={16} />
                </IconButton>
              )}
            </div>
          </div>
        )}
      />

      {lastSyncedAt && (
        <p className="-mt-2 text-2xs font-medium text-slate-500">Bijgewerkt om {formatSyncedTime(lastSyncedAt)} · sleep naar beneden om te vernieuwen</p>
      )}

      <MasterDetail
        lijst={filteredDiversions.length > 0 ? (
          <ul className="space-y-2" aria-label="Omleidingen">
            {filteredDiversions.map(div => {
              const isCurrent = detail?.id === div.id;
              const fase = omleidingsFase(div);
              return (
                <Card
                  key={div.id}
                  as="li"
                  padding="none"
                  interactive
                  aria-current={isCurrent ? 'true' : undefined}
                  className={cn('overflow-hidden', isExpiredDiversion(div) && 'opacity-60', isCurrent && 'ring-1 ring-oker-400 bg-oker-50/40')}
                >
                  {/* Compacte rij: kleiner icoon, titelregel + periode eronder
                      (verzoek Jarno 10-09: begin en einde zichtbaar zonder te openen). */}
                  {/* rauw: lijstrij van het master-detail (kaart als knop: icoontegel + titel + badges + periode + chevron) */}
                  <button
                    type="button"
                    onClick={() => kiesRecord(div.id, detail?.id ?? null, () => setSelectedId(div.id))}
                    className="w-full px-3.5 py-3 md:px-4 cursor-pointer hover:bg-slate-50/50 transition-colors flex items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <LijnTegel line={div.line} size="sm" tone={fase === 'verlopen' ? 'muted' : 'accent'} />
                      <div className="min-w-0">
                        {/* Titel alleen op regel 1; status en periode samen op regel 2 zodat
                            het oog per rij één datumregel vindt (Jarno 10-09). */}
                        <h4 className="text-card-title leading-snug" data-vt-record={div.id}>{div.title}</h4>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold tabular-nums">
                          {fase === 'komend' && <Badge tone="oker" icon={<Calendar size={12} />}>Komend</Badge>}
                          {fase === 'verlopen' && <Badge tone="slate">Verlopen</Badge>}
                          {fase === 'lopend' && <Calendar size={14} className="text-oker-500" />}
                          <span className={fase === 'verlopen' ? 'text-slate-500' : 'text-slate-700'}>{omleidingsPeriode(div)}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={20} className={cn('shrink-0', isCurrent ? 'text-oker-500' : 'text-slate-300')} />
                  </button>
                </Card>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            illustratie={searchQuery ? <NietGevonden /> : <LegeLijst />}
            title={searchQuery ? 'Geen resultaten' : 'Geen actieve omleidingen'}
            message={searchQuery ? `Geen omleidingen gevonden voor “${searchQuery}”` : 'Er zijn op dit moment geen omleidingen. Zodra er een wordt toegevoegd, verschijnt ze hier.'}
            action={searchQuery ? (
              <Button variant="secondary" size="sm" onClick={() => setSearchQuery('')}>
                Wis zoekopdracht
              </Button>
            ) : undefined}
          />
        )}
        paneel={filteredDiversions.length > 0 ? (
          <DetailPaneel
            open={!!detail}
            onClose={() => setSelectedId(null)}
            title={detail?.title ?? 'Omleiding'}
            sleutel={detail?.id}
            leegTekst="Kies een omleiding."
            icon={detail ? <LijnTegel line={detail.line} /> : undefined}
          >
            {detail && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="oker">{lijnLabel(detail.line)}</Badge>
                  {omleidingsFase(detail) === 'verlopen' && <Badge tone="slate">Verlopen</Badge>}
                  {omleidingsFase(detail) === 'komend' && <Badge tone="oker" icon={<Calendar size={12} />}>Komend</Badge>}
                  {omleidingsFase(detail) === 'lopend' && <Badge tone="emerald" stil>Actief</Badge>}
                </div>
                <DiversionBody diversion={detail} />
              </div>
            )}
          </DetailPaneel>
        ) : undefined}
      />
    </PageShell>
  );
}

/**
 * Inhoud van één omleiding — omschrijving, periode en PDF-acties.
 */
function DiversionBody({ diversion: div }: { diversion: Diversion }) {
  return (
    <div className="space-y-5">
      <p className="text-sm font-normal text-slate-700 leading-relaxed">{div.description}</p>

      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 tabular-nums">
        <Calendar size={14} className="text-oker-400" />
        <span>{omleidingsPeriode(div)}{!div.endDate && ', geen einddatum'}</span>
      </div>

      {div.pdfUrl ? (
        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="flex-1"
            icon={<FileText size={16} className="text-red-500" />}
            onClick={() => openPdfInNewTab(div.pdfUrl)}
          >
            Bekijk PDF
          </Button>
          <a
            href={safeDocumentHref(div.pdfUrl)}
            download
            className="ios-pressable control-button-soft inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-700 hover:text-slate-900 transition-all"
          >
            <Download size={16} />
            Download PDF
          </a>
        </div>
      ) : (
        <Card tone="dashed" padding="sm" className="text-center">
          <p className="text-sm text-slate-500">Geen PDF bijlage beschikbaar</p>
        </Card>
      )}
    </div>
  );
}
