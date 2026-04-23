import { lazy, Suspense, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, ChevronDown, ChevronRight, Download, FileText, MapPin, Search, X } from 'lucide-react';
import type { Diversion } from '../types';
import { cn } from '../lib/ui';

const DiversionMap = lazy(() => import('../components/DiversionMap').then((module) => ({ default: module.DiversionMap })));

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
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h3 className="text-2xl font-black tracking-tight">Actuele Omleidingen</h3>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <div className="relative group">
            <select
              value={selectedLine}
              onChange={(e) => setSelectedLine(e.target.value)}
              className="control-input appearance-none w-full sm:w-40 pl-4 pr-10 py-3 rounded-2xl focus:outline-none transition-all font-bold text-sm cursor-pointer"
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
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-300 hover:text-slate-500"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        {filteredDiversions.length > 0 ? (
          filteredDiversions.map(div => (
            <div key={div.id} className="surface-card surface-card-hover rounded-[32px] overflow-hidden group duration-300">
            <div 
              onClick={() => setSelectedDiversion(selectedDiversion?.id === div.id ? null : div)}
              className="p-6 md:p-8 cursor-pointer hover:bg-slate-50/50 transition-colors flex items-start justify-between gap-4"
            >
              <div className="flex gap-4 md:gap-6">
                <div className={cn(
                  "w-12 h-12 md:w-16 md:h-16 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-500 group-hover:scale-110",
                  div.severity === 'high' ? "bg-red-50 text-red-600 border border-red-100" : 
                  div.severity === 'medium' ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-blue-50 text-blue-600 border border-blue-100"
                )}>
                  <MapPin size={24} className="md:size-8" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h4 className="font-black text-lg md:text-xl text-slate-800 tracking-tight">{div.title}</h4>
                    <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase tracking-widest">{div.line}</span>
                  </div>
                  <p className="text-slate-400 text-xs md:text-sm font-bold uppercase tracking-widest">
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
                  <div className="p-6 md:p-8 space-y-6">
                    <div className="grid md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="prose prose-slate max-w-none">
                          <p className="text-slate-700 leading-relaxed font-medium text-sm md:text-base">{div.description}</p>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-4 md:gap-8">
                          <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-400 font-black uppercase tracking-widest">
                            <Calendar size={14} className="text-oker-400" />
                            <span>Start: {div.startDate}</span>
                          </div>
                          {div.endDate && (
                            <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-400 font-black uppercase tracking-widest">
                              <Calendar size={14} className="text-oker-400" />
                              <span>Eind: {div.endDate}</span>
                            </div>
                          )}
                        </div>
                        
                        {div.pdfUrl ? (
                          <div className="pt-2 flex flex-col sm:flex-row gap-3">
                            <a 
                              href={div.pdfUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="control-button-soft flex-1 flex items-center justify-center gap-3 px-6 py-4 rounded-2xl text-sm font-black text-slate-700 transition-all active:scale-95"
                            >
                              <FileText size={18} className="text-red-500" />
                              BEKIJK PDF
                            </a>
                            <a 
                              href={div.pdfUrl} 
                              download
                              className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-emerald-500 rounded-2xl text-sm font-black text-white hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                            >
                              <Download size={18} />
                              DOWNLOAD PDF
                            </a>
                          </div>
                        ) : (
                          <div className="p-4 bg-slate-100/50 rounded-2xl border border-dashed border-slate-200 text-center">
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Geen PDF bijlage beschikbaar</p>
                          </div>
                        )}
                      </div>

                      {div.mapCoordinates && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Visuele Omleiding</p>
                          <div className="h-64 rounded-3xl overflow-hidden border border-slate-100 shadow-inner z-0">
                            <Suspense
                              fallback={
                                <div className="flex h-full items-center justify-center bg-white/60 text-sm font-bold text-slate-500">
                                  Kaart laden...
                                </div>
                              }
                            >
                              <DiversionMap
                                coordinates={JSON.parse(div.mapCoordinates)}
                                severity={div.severity}
                              />
                            </Suspense>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))
      ) : (
        <div className="text-center py-20 surface-card rounded-[40px] border border-dashed border-white/80">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Search size={32} className="text-slate-300" />
          </div>
          <h4 className="text-xl font-black text-slate-800 tracking-tight">Geen resultaten</h4>
          <p className="text-slate-400 font-medium mt-2">Geen omleidingen gevonden voor "{searchQuery}"</p>
          <button 
            onClick={() => setSearchQuery('')}
            className="mt-6 text-oker-500 font-black uppercase tracking-widest text-xs hover:text-oker-600 transition-colors"
          >
            Wis zoekopdracht
          </button>
        </div>
      )}
    </div>
  </div>
);
}

