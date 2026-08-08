import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, ChevronDown, ChevronRight, Download, FileText, MapPin, Search, X } from 'lucide-react';
import { isExpiredDiversion } from '../lib/diversions';
import type { Diversion } from '../types';
import { formatDateHuman, formatSyncedTime } from '../lib/format';
import { openPdfInNewTab, safeDocumentHref } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button } from '../components/primitives';



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
            <div className="relative group">
              <select
                value={selectedLine}
                onChange={(e) => setSelectedLine(e.target.value)}
                className="control-input appearance-none w-full sm:w-40 pl-4 pr-10 py-3 rounded-2xl focus:outline-none transition-all font-semibold text-sm cursor-pointer"
              >
                <option value="all">Alle Lijnen</option>
                {uniqueLines.map(line => (
                  <option key={line} value={line}>Lijn {line}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-slate-400">
                <ChevronDown size={16} />
              </div>
            </div>
            <div className="relative flex-1 md:w-72 group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search size={18} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
              </div>
              <input
                type="text"
                placeholder="Zoek..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="control-input w-full pl-11 pr-4 py-3 rounded-2xl focus:outline-none transition-all font-medium text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="Wis zoekopdracht"
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-300 hover:text-slate-500"
                >
                  <X size={16} />
                </button>
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
            <div key={div.id} className={`surface-card surface-card-hover rounded-2xl overflow-hidden group duration-300 ${isExpiredDiversion(div) ? 'opacity-60' : ''}`}>
            {/* Compacte rij (verzoek Jarno): kleiner icoon, één titelregel,
                geen "Tik voor meer info"-hulpregel — de chevron is de
                affordance. Het uitklapdetail blijft ongewijzigd. */}
            <div
              onClick={() => setSelectedDiversion(selectedDiversion?.id === div.id ? null : div)}
              className="px-3.5 py-3 md:px-4 cursor-pointer hover:bg-slate-50/50 transition-colors flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl border border-oker-100 bg-oker-50 text-oker-600 flex items-center justify-center shrink-0">
                  <MapPin size={17} />
                </div>
                <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <h4 className="font-bold text-[15px] text-slate-800 tracking-tight leading-snug">{div.title}</h4>
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
                  className="overflow-hidden bg-white/35 border-t border-white/60"
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
                          <div className="p-4 bg-surface-soft rounded-2xl border border-dashed border-slate-200 text-center">
                            <p className="text-xs font-medium text-slate-400">Geen PDF bijlage beschikbaar</p>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))
      ) : (
        <EmptyState
          icon={<Search size={28} />}
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
