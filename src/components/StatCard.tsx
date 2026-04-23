import React from 'react';

export function StatCard({ icon, label, value, subValue }: { icon: React.ReactNode, label: string, value: string, subValue: string }) {
  return (
    <div className="panel relative flex items-center gap-4 overflow-hidden rounded-[22px] p-5 transition-all duration-200 group hover:-translate-y-0.5 md:p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/0 via-white/80 to-white/0" />
      <div className="p-3 bg-slate-50/90 rounded-2xl relative z-10 ring-1 ring-slate-100 shadow-sm shrink-0">
        {icon}
      </div>
      <div className="relative z-10 min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
        <p className="section-title text-2xl md:text-[1.75rem] font-black text-slate-900 mt-1 tracking-tight leading-none">{value}</p>
        <p className="text-xs text-slate-500 mt-1.5 font-medium">{subValue}</p>
      </div>
    </div>
  );
}
