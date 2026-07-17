import { lazy, Suspense, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, ChevronDown, ChevronRight, Download, FileText, MapPin, Search, X } from 'lucide-react';
import type { Diversion } from '../types';
import { formatDateHuman } from '../lib/format';
import { openPdfInNewTab } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, MicroLabel } from '../components/primitives';

const DiversionMap = lazy(() => import('../components/DiversionMap').then((module) => ({ default: module.DiversionMap })));

/**
 * Veilig parsen van de opgeslagen kaart-coördinaten. mapCoordinates is een
 * vrije tekst-string; ongeldige/legacy data zou anders JSON.parse laten
 * gooien middenin de render (crash). Geeft alleen een geldige, niet-lege
 * lijst [lat,lng]-paren terug — anders null (kaart wordt dan niet getoond).
 */
function safeParseCoordinates(raw?: string): [number, number][] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number',
      )
    ) {
      return parsed as [number, number][];
    }
    return null;
  } catch {
    return null;
  }
}

export function DiversionsView({ diversions }: { diversions: Diversion[] }) {
  const [selectedDiversion, setSelectedDiversion] = useState<Diversion | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLine, setSelectedLine] = useState<string>('all');

  // Get unique line numbers for the filter
  const uniqueLines = Array.from(new Set(diversions.map(div => div.line))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const filteredDiversions = diversions.filter(div => {
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
        description="Actuele hinder en omleidingen op het netwerk."
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

      <div className="space-y-4">
        {filteredDiversions.length > 0 ? (
          filteredDiversions.map(div => (
            <div key={div.id} className="surface-card surface-card-hover rounded-3xl overflow-hidden group duration-300">
            <div
              onClick={() => setSelectedDiversion(selectedDiversion?.id === div.id ? null : div)}
              className="p-5 md:p-6 cursor-pointer hover:bg-slate-50/50 transition-colors flex items-start justify-between gap-4"
            >
              <div className="flex gap-4 md:gap-5">
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl border border-oker-100 bg-oker-50 text-oker-600 flex items-center justify-center shrink-0">
                  <MapPin size={24} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h4 className="font-bold text-lg md:text-xl text-slate-800 tracking-tight">{div.title}</h4>
                    <Badge tone="slate">{div.line}</Badge>
                  </div>
                  <p className="text-xs font-medium text-slate-400">
                    {selectedDiversion?.id === div.id ? 'Tik om te sluiten' : 'Tik voor meer info'}
                  </p>
                </div>
              </div>
              <motion.div
                animate={{ rotate: selectedDiversion?.id === div.id ? 90 : 0 }}
                className="p-2 text-slate-300 mt-1"
              >
                <ChevronRight size={24} />
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
                              href={div.pdfUrl}
                              download
                              className="ios-pressable control-button-soft inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-700 hover:text-slate-900 transition-all"
                            >
                              <Download size={16} />
                              Download PDF
                            </a>
                          </div>
                        ) : (
                          <div className="p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center">
                            <p className="text-xs font-medium text-slate-400">Geen PDF bijlage beschikbaar</p>
                          </div>
                        )}
                      </div>

                      {(() => {
                        const coords = safeParseCoordinates(div.mapCoordinates);
                        if (!coords) return null;
                        return (
                          <div className="space-y-2">
                            <MicroLabel className="mb-1">Visuele Omleiding</MicroLabel>
                            <div className="h-64 rounded-3xl overflow-hidden border border-slate-100 shadow-inner z-0">
                              <Suspense
                                fallback={
                                  <div className="flex h-full items-center justify-center bg-white/60 text-sm font-medium text-slate-500">
                                    Kaart laden...
                                  </div>
                                }
                              >
                                <DiversionMap coordinates={coords} />
                              </Suspense>
                            </div>
                          </div>
                        );
                      })()}
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
