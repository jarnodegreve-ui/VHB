import React from 'react';

/**
 * KPI-tegel voor beheerschermen. Mobiel-eerst: onder `sm` stapelen icoon en
 * tekst verticaal — de horizontale vorm liet in een 2-koloms grid op een
 * telefoon maar ±70px over voor de tekst, waardoor labels en subwaarden
 * over drie regels wikkelden. Vanaf `sm` de vertrouwde horizontale kaart.
 */
export function StatCard({ icon, label, value, subValue }: { icon: React.ReactNode, label: string, value: string, subValue: string }) {
  return (
    <div className="panel relative flex flex-col items-start gap-3 overflow-hidden rounded-3xl p-4 transition-all duration-200 group hover:-translate-y-0.5 sm:flex-row sm:items-center sm:gap-4 sm:p-5 md:p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/0 via-white/80 dark:via-white/10 to-white/0" />
      <div className="p-2.5 bg-slate-50/90 rounded-2xl relative z-10 ring-1 ring-slate-100 shadow-sm shrink-0 sm:p-3">
        {icon}
      </div>
      <div className="relative z-10 min-w-0 w-full flex-1">
        <p className="truncate text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em]">{label}</p>
        <p className="section-title text-xl sm:text-2xl md:text-[1.75rem] font-black text-slate-900 mt-1 tracking-tight leading-none tabular-nums">{value}</p>
        <p className="text-[11px] sm:text-xs text-slate-500 mt-1.5 font-medium leading-snug">{subValue}</p>
      </div>
    </div>
  );
}
