import { useState } from 'react';
import { Calendar, ChevronRight, Download, FileText, MapPin, Search, X } from 'lucide-react';
import { isExpiredDiversion } from '../lib/diversions';
import type { Diversion } from '../types';
import { formatDateHuman, formatSyncedTime } from '../lib/format';
import { cn, openPdfInNewTab, safeDocumentHref } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, IconButton } from '../components/primitives';
import { Card } from '../components/Card';
import { Input, Select } from '../components/Field';
import { DetailPaneel, MasterDetail, useInlinePaneel } from '../components/DetailPaneel';

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
  const uniqueLines = Array.from(new Set(diversions.map(div => div.line))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const sortedForList = [...diversions].sort((a, b) => {
    const ea = isExpiredDiversion(a) ? 1 : 0;
    const eb = isExpiredDiversion(b) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    return String(b.startDate || '').localeCompare(String(a.startDate || ''));
  });
  const filteredDiversions = sortedForList.filter(div => {
    const matchesSearch = div.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      div.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      div.line.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesLine = selectedLine === 'all' || div.line === selectedLine;

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
                <option key={line} value={line}>Lijn {line}</option>
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
        <p className="-mt-2 text-2xs font-medium text-slate-500">Bijgewerkt om {formatSyncedTime(lastSyncedAt)} · sleep omlaag om te verversen</p>
      )}

      <MasterDetail
        lijst={filteredDiversions.length > 0 ? (
          <ul className="space-y-2" aria-label="Omleidingen">
            {filteredDiversions.map(div => {
              const isCurrent = detail?.id === div.id;
              return (
                <Card
                  key={div.id}
                  as="li"
                  padding="none"
                  interactive
                  aria-current={isCurrent ? 'true' : undefined}
                  className={cn('overflow-hidden', isExpiredDiversion(div) && 'opacity-60', isCurrent && 'ring-1 ring-oker-400 bg-oker-50/40')}
                >
                  {/* Compacte rij (verzoek Jarno): kleiner icoon, één titelregel,
                      geen hulpregel — de chevron is de affordance. */}
                  {/* rauw: lijstrij van het master-detail (kaart als knop: icoontegel + titel + badges + chevron) */}
                  <button
                    type="button"
                    onClick={() => setSelectedId(div.id)}
                    className="w-full px-3.5 py-3 md:px-4 cursor-pointer hover:bg-slate-50/50 transition-colors flex items-center justify-between gap-3 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl border border-oker-100 bg-oker-50 text-oker-700 flex items-center justify-center shrink-0">
                        <MapPin size={16} />
                      </div>
                      <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <h4 className="text-card-title leading-snug">{div.title}</h4>
                        <Badge tone="slate">{div.line}</Badge>
                        {isExpiredDiversion(div) && <Badge tone="slate">Verlopen</Badge>}
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
            icon={<Search size={24} />}
            title={searchQuery ? 'Geen resultaten' : 'Geen actieve omleidingen'}
            message={searchQuery ? `Geen omleidingen gevonden voor "${searchQuery}"` : 'Er zijn op dit moment geen omleidingen. Zodra er een wordt toegevoegd, verschijnt ze hier.'}
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
            icon={(
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-oker-100 bg-oker-50 text-oker-700">
                <MapPin size={16} />
              </span>
            )}
          >
            {detail && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="oker">Lijn {detail.line}</Badge>
                  {isExpiredDiversion(detail) ? <Badge tone="slate">Verlopen</Badge> : <Badge tone="emerald" dot>Actief</Badge>}
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

      <div className="flex flex-wrap items-center gap-4 md:gap-6">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 tabular-nums">
          <Calendar size={14} className="text-oker-400" />
          <span>Start: {formatDateHuman(div.startDate)}</span>
        </div>
        {div.endDate && (
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 tabular-nums">
            <Calendar size={14} className="text-oker-400" />
            <span>Eind: {formatDateHuman(div.endDate)}</span>
          </div>
        )}
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
