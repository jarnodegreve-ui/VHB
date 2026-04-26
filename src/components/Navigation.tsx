import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/ui';

export function MobileNavItem({ icon, active, onClick }: { icon: React.ReactNode, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "ios-pressable p-3 rounded-2xl transition-all duration-300 relative",
        active ? "text-oker-600 bg-oker-50 shadow-inner" : "text-slate-400 hover:text-slate-600"
      )}
    >
      {active && (
        <motion.div
          layoutId="activeTab"
          transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }}
          className="absolute inset-0 bg-oker-500/10 rounded-2xl -z-10"
        />
      )}
      {icon}
    </button>
  );
}

export function NavItem({ icon, label, active, onClick, badge }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "ios-pressable flex items-center gap-3 w-full px-3 py-2.5 rounded-2xl transition-all duration-300 group text-left",
        active
          ? "bg-white/90 text-slate-900 shadow-sm font-semibold"
          : "text-slate-500 hover:text-slate-800 hover:bg-white/50 font-medium"
      )}
    >
      <span className={cn(
        "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200",
        active ? "bg-oker-500 text-white shadow-sm shadow-oker-500/30" : "text-slate-400 group-hover:text-oker-500"
      )}>
        {icon}
      </span>
      <span className="text-[14px] leading-none flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-black bg-oker-500 text-white rounded-full shadow-sm shadow-oker-500/30">
          {badge}
        </span>
      )}
    </button>
  );
}
