import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, ChevronRight, Download, FileText, MapPin, Search, X } from 'lucide-react';
import { isExpiredDiversion } from '../lib/diversions';
import type { Diversion } from '../types';
import { formatDateHuman, formatSyncedTime } from '../lib/format';
import { cn, openPdfInNewTab, safeDocumentHref } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, IconButton, MicroLabel } from '../components/primitives';
import { Card } from '../components/Card';
import { Input, Select } from '../components/Field';
import { useMinWidth } from '../lib/useMinWidth';

/**
 * Breekpunt als React-state (Tailwind `lg` = 1024 px). Onder `lg` blijft het
 * uitklap-gedrag in de lijst; daarboven staat het detail rechts naast de lijst
 * (master-detail). Lokaal in deze view — een gedeelde useMediaQuery ontbreekt
 * nog in src/lib (zie rapport fase C10).
 */

export function DiversionsView({ diversions, lastSyncedAt = null }: { diversions: Diversion[]; lastSyncedAt?: number | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLine, setSelectedLine] = useState<string>('all');
  const lg = useMinWidth(1024);

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

  // Mobiel: alleen wat de chauffeur zelf opentikte. Desktop: valt terug op de
  // eerste actieve omleiding in de (gefilterde) lijst, zodat het detailpaneel
  // nooit leeg opent; verdwijnt de keuze uit de lijst door een filter, dan
  // springt het paneel mee naar de eerste die overblijft.
  const expanded = filteredDiversions.find((d) => d.id === selectedId) ?? null;
  const detail = lg
    ? expanded ?? filteredDiversions.find((d) => !isExpiredDiversion(d)) ?? filteredDiversions[0] ?? null
    : expanded;

  const kies = (div: Diversion) => {
    if (lg) setSelectedId(div.id);
    else setSelectedId(selectedId === div.id ? null : div.id);
  };

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
              <option value="all">Alle Lijnen</option>
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

      {/* Master-detail vanaf lg: lijst links (38 %), detail rechts. Onder lg is
          het de bestaande gestapelde lijst met uitklapdetail. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,38%)_1fr] lg:items-start lg:gap-5">
        <div className="space-y-2">
          {filteredDiversions.length > 0 ? (
            filteredDiversions.map(div => {
              const isOpen = !lg && expanded?.id === div.id;
              const isCurrent = lg && detail?.id === div.id;
              return (
                <Card
                  key={div.id}
                  padding="none"
                  interactive
                  aria-current={isCurrent ? 'true' : undefined}
                  className={cn('overflow-hidden group duration-300', isExpiredDiversion(div) && 'opacity-60', isCurrent && 'ring-1 ring-oker-400 bg-oker-50/40')}
                >
                  {/* Compacte rij (verzoek Jarno): kleiner icoon, één titelregel,
                      geen "Tik voor meer info"-hulpregel — de chevron is de
                      affordance. Het uitklapdetail blijft ongewijzigd. */}
                  {/* rauw: lijstrij van het master-detail (kaart als knop: icoontegel + titel + badges + chevron) */}
                  <button
                    type="button"
                    onClick={() => kies(div)}
                    aria-expanded={lg ? undefined : isOpen}
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
                    <motion.div
                      animate={{ rotate: isOpen ? 90 : 0 }}
                      className={cn('p-1.5 shrink-0', isCurrent ? 'text-oker-500' : 'text-slate-300')}
                    >
                      <ChevronRight size={20} />
                    </motion.div>
                  </button>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-paper/35 border-t border-rim"
                      >
                        <div className="p-5 md:p-6 space-y-6">
                          <div className="grid md:grid-cols-2 gap-8">
                            <DiversionBody diversion={div} />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })
          ) : (
            <div className="lg:col-span-2">
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
            </div>
          )}
        </div>

        {/* Detailpaneel (alleen lg+): blijft in beeld terwijl de lijst scrolt. */}
        {lg && filteredDiversions.length > 0 && (
          <div className="hidden lg:block lg:sticky lg:top-16" aria-live="polite">
            {detail ? (
              <Card key={detail.id} as="section" padding="lg" aria-label={`Omleiding ${detail.title}`}>
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl border border-oker-100 bg-oker-50 text-oker-700 flex items-center justify-center shrink-0">
                    <MapPin size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <MicroLabel>Omleiding</MicroLabel>
                    <h2 className="mt-1 text-section-title">{detail.title}</h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone="oker">Lijn {detail.line}</Badge>
                      {isExpiredDiversion(detail) ? <Badge tone="slate">Verlopen</Badge> : <Badge tone="emerald" dot>Actief</Badge>}
                    </div>
                  </div>
                </div>
                <div className="mt-6 border-t border-slate-100 pt-6">
                  <DiversionBody diversion={detail} />
                </div>
              </Card>
            ) : (
              <Card tone="dashed" padding="lg" className="text-center">
                <p className="text-sm text-slate-500">Kies een omleiding</p>
              </Card>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}

/**
 * Inhoud van één omleiding — omschrijving, periode en PDF-acties. Eén bron
 * voor het uitklapdetail (mobiel) en het detailpaneel (desktop).
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
