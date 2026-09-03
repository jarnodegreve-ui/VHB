import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, ChevronRight, Download, FileText, MapPin, Search, X } from 'lucide-react';
import { isExpiredDiversion } from '../lib/diversions';
import type { Diversion } from '../types';
import { formatDateHuman, formatSyncedTime } from '../lib/format';
import { cn, openPdfInNewTab, safeDocumentHref } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, IconButton } from '../components/primitives';
import { Card } from '../components/Card';
import { Input, Select } from '../components/Field';


export function DiversionsView({ diversions, lastSyncedAt = null }: { diversions: Diversion[]; lastSyncedAt?: number | null }) {
  const [selectedDiversion, setSelectedDiversion] = useState<Diversion | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLine, setSelectedLine] = useState<string>('all');

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
                placeholder="Zoek..."
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
        <p className="-mt-2 text-2xs font-medium text-slate-400">Bijgewerkt om {formatSyncedTime(lastSyncedAt)} · sleep omlaag om te verversen</p>
      )}

      <div className="space-y-2">
        {filteredDiversions.length > 0 ? (
          filteredDiversions.map(div => (
            <Card key={div.id} padding="none" interactive className={cn('overflow-hidden group duration-300', isExpiredDiversion(div) && 'opacity-60')}>
            {/* Compacte rij (verzoek Jarno): kleiner icoon, één titelregel,
                geen "Tik voor meer info"-hulpregel — de chevron is de
                affordance. Het uitklapdetail blijft ongewijzigd. */}
            <div
              onClick={() => setSelectedDiversion(selectedDiversion?.id === div.id ? null : div)}
              className="px-3.5 py-3 md:px-4 cursor-pointer hover:bg-slate-50/50 transition-colors flex items-center justify-between gap-3"
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
                animate={{ rotate: selectedDiversion?.id === div.id ? 90 : 0 }}
                className="p-1.5 text-slate-300 shrink-0"
              >
                <ChevronRight size={20} />
              </motion.div>
            </div>

            <AnimatePresence>
              {selectedDiversion?.id === div.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden bg-paper/35 border-t border-rim"
                >
                  <div className="p-5 md:p-6 space-y-6">
                    <div className="grid md:grid-cols-2 gap-8">
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

                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        ))
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
    </div>
  </PageShell>
);
}
