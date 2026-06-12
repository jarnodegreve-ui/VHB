import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { LayoutDashboard, Calendar, MapPin, Bell, FileText } from 'lucide-react';
import type { View } from '../types';
import { cn } from '../lib/ui';

type NavSlot = {
  view: View;
  label: string;
  icon: ReactNode;
  badge?: number;
};

/**
 * Mobile bottom-tab-bar voor chauffeurs. Vervangt de hamburger op
 * kleine schermen. 5 hoofdacties — sneller dan een menu openen.
 *
 * - Floating glass-card stijl, sticky aan de onderkant
 * - Actief item heeft oker-fill + animated layoutId-pill
 * - Badges (bv. ongelezen updates) tonen rechtsboven
 * - Alleen rendered op md:hidden (mobile/tablet portrait)
 */
export function BottomNav({
  currentView,
  onSelect,
  unseenLeaveCount = 0,
  hidden = false,
}: {
  currentView: View;
  onSelect: (view: View) => void;
  unseenLeaveCount?: number;
  /** Verberg de balk wanneer er bv. een sidebar/sheet open is, zodat
   *  hij niet onder de overlay door piept. */
  hidden?: boolean;
}) {
  const slots: NavSlot[] = [
    { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { view: 'rooster', label: 'Rooster', icon: <Calendar size={20} /> },
    { view: 'omleidingen', label: 'Omleidingen', icon: <MapPin size={20} /> },
    { view: 'ritblaadjes', label: 'Ritblaadjes', icon: <FileText size={20} /> },
    { view: 'updates', label: 'Updates', icon: <Bell size={20} />, badge: unseenLeaveCount },
  ];

  return (
    <nav
      className={cn(
        'md:hidden fixed bottom-3 left-3 right-3 z-40 rounded-2xl px-2 py-2 transition-all duration-300',
        'bg-white/90 border border-slate-200/80 backdrop-blur-xl shadow-[0_8px_28px_rgba(13,13,15,0.12)]',
        hidden && 'pointer-events-none opacity-0 translate-y-4',
      )}
      aria-hidden={hidden || undefined}
      style={{
        paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
      }}
      aria-label="Hoofdnavigatie"
    >
      <ul className="flex items-center justify-around gap-1">
        {slots.map((slot) => {
          const isActive = currentView === slot.view;
          return (
            <li key={slot.view} className="flex-1">
              <button
                onClick={() => onSelect(slot.view)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={slot.label}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-0.5 w-full py-1.5 rounded-xl transition-colors',
                  isActive ? 'text-oker-700' : 'text-slate-400 hover:text-slate-700',
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="bottom-nav-active"
                    transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.7 }}
                    className="absolute inset-0 rounded-xl bg-oker-100"
                  />
                )}
                <span className="relative z-10">{slot.icon}</span>
                <span className="relative z-10 text-[9px] font-semibold tracking-tight leading-tight truncate max-w-full px-1">
                  {slot.label}
                </span>
                {slot.badge !== undefined && slot.badge > 0 && (
                  <span className="absolute top-0.5 right-2 z-10 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold bg-oker-500 text-slate-950 rounded-full">
                    {slot.badge > 9 ? '9+' : slot.badge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
