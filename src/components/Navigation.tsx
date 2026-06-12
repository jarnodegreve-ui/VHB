import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/ui';


export function NavItem({ icon, label, active, onClick, badge }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, badge?: number }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] transition-colors duration-150",
        active
          ? "bg-oker-50/80 text-slate-900 font-semibold"
          : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 font-medium"
      )}
    >
      {/* Actieve accent-rail links — subtiel merk-moment i.p.v. icoon-box */}
      {active && (
        <motion.span
          layoutId="nav-active-rail"
          transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-oker-500"
        />
      )}
      <span className={cn(
        "shrink-0 transition-colors duration-150",
        active ? "text-oker-600" : "text-slate-400 group-hover:text-slate-600"
      )}>
        {icon}
      </span>
      <span className="flex-1 leading-none truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto inline-flex items-center justify-center min-w-[19px] h-[19px] px-1.5 text-[10px] font-bold bg-oker-500 text-white rounded-full">
          {badge}
        </span>
      )}
    </button>
  );
}
