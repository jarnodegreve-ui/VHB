import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { LayoutDashboard, Calendar, MapPin, CalendarCheck, FileText, Menu, AlertTriangle, RotateCcw, IdCard } from 'lucide-react';
import type { Role, View } from '../types';
import { cn } from '../lib/ui';

type NavSlot = {
  view: View;
  label: string;
  icon: ReactNode;
  badge?: number;
};

/**
 * Mobile bottom-tab-bar. Vervangt de hamburger op kleine schermen.
 * 5 hoofdacties — sneller dan een menu openen.
 *
 * Rolbewust: chauffeurs krijgen hun rij-tabs, planners/admins hun
 * dagelijkse plannerwerk (dekking, verlof- en ruilaanvragen, vervaldata) —
 * die zaten eerst allemaal achter "Meer". De preview-schakelaar ("bekijk
 * als chauffeur") stuurt hier de effectieve rol in, dus de balk wisselt mee.
 *
 * - Floating glass-card stijl, sticky aan de onderkant
 * - Actief item heeft oker-fill + animated layoutId-pill
 * - Badges (bv. openstaande aanvragen) tonen rechtsboven
 * - Alleen rendered op md:hidden (mobile/tablet portrait)
 */
export function BottomNav({
  currentView,
  onSelect,
  role = 'chauffeur',
  unseenLeaveCount = 0,
  pendingLeaveCount = 0,
  pendingSwapsCount = 0,
  onMore,
  moreDot = false,
  hidden = false,
}: {
  currentView: View;
  onSelect: (view: View) => void;
  /** Effectieve rol (dus mét preview-modus verrekend). */
  role?: Role;
  unseenLeaveCount?: number;
  /** Openstaande verlofaanvragen (badge op de planner-tab Verlof). */
  pendingLeaveCount?: number;
  /** Openstaande dienstruilen (badge op de planner-tab Ruil). */
  pendingSwapsCount?: number;
  /** Opent het "Meer"-menu (de volledige sidebar-sheet) op de telefoon,
   *  zodat de bottom-nav het enige nav-systeem is (geen aparte hamburger). */
  onMore?: () => void;
  /** Attentie-dot op de "Meer"-tab: er wacht iets in een view achter het
   *  menu (bv. een aan jou gerichte dienstruil). */
  moreDot?: boolean;
  /** Verberg de balk wanneer er bv. een sidebar/sheet open is, zodat
   *  hij niet onder de overlay door piept. */
  hidden?: boolean;
}) {
  const isPlanner = role === 'planner' || role === 'admin';
  const slots: NavSlot[] = isPlanner
    ? [
        { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
        { view: 'dekking', label: 'Dekking', icon: <AlertTriangle size={20} /> },
        { view: 'verlof', label: 'Verlof', icon: <CalendarCheck size={20} />, badge: pendingLeaveCount },
        { view: 'ruil-verzoeken', label: 'Ruil', icon: <RotateCcw size={20} />, badge: pendingSwapsCount },
        { view: 'vervaldata', label: 'Vervaldata', icon: <IdCard size={20} /> },
      ]
    : [
        { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
        { view: 'rooster', label: 'Rooster', icon: <Calendar size={20} /> },
        { view: 'omleidingen', label: 'Omleidingen', icon: <MapPin size={20} /> },
        { view: 'ritblaadjes', label: 'Ritbladen', icon: <FileText size={20} /> },
        // Verlof i.p.v. Updates: de badge telt verlofbeslissingen (unseenLeaveCount),
        // dus die hoort hier — op 'Updates' was hij misleidend. Updates blijven op
        // het dashboard zichtbaar.
        { view: 'verlof', label: 'Verlof', icon: <CalendarCheck size={20} />, badge: unseenLeaveCount },
      ];

  return (
    <nav
      className={cn(
        // left/right respecteren de safe-area (landscape/notch) — iOS negeert
        // de portrait-lock uit het manifest, dus landscape kán voorkomen.
        'md:hidden fixed bottom-3 left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-40 rounded-2xl px-2 py-2 transition-all duration-300',
        // Opaak oppervlak + schaduw in index.css (.bottom-dock): blur jankt op
        // een fixed balk, en doorschijnend-zonder-blur liet de content er
        // rommelig doorheen schemeren.
        'bottom-dock',
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
                  // Hover alleen op een echte muis (pointer-fine): op touch
                  // blijft :hover na een tik plakken, waardoor een inactieve
                  // tab er permanent "half actief" uitzag.
                  'relative flex flex-col items-center justify-center gap-0.5 w-full py-1.5 rounded-[10px] transition-colors',
                  isActive ? 'text-oker-700' : 'text-slate-400 pointer-fine:hover:text-slate-700',
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="bottom-nav-active"
                    transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.7 }}
                    className="absolute inset-0 rounded-[10px] bg-oker-100"
                  />
                )}
                <span className="relative z-10">{slot.icon}</span>
                <span className="relative z-10 text-2xs font-semibold tracking-tight leading-tight truncate max-w-full px-1">
                  {slot.label}
                </span>
                {slot.badge !== undefined && slot.badge > 0 && (
                  <span className="absolute top-0.5 right-2 z-10 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-2xs font-bold bg-oker-500 text-slate-950 rounded-full">
                    {slot.badge > 9 ? '9+' : slot.badge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {onMore && (
          <li className="flex-1">
            <button
              onClick={onMore}
              aria-label="Meer"
              className="relative flex flex-col items-center justify-center gap-0.5 w-full py-1.5 rounded-[10px] transition-colors text-slate-400 pointer-fine:hover:text-slate-700"
            >
              <span className="relative z-10"><Menu size={20} /></span>
              <span className="relative z-10 text-2xs font-semibold tracking-tight leading-tight truncate max-w-full px-1">Meer</span>
              {moreDot && (
                <span className="absolute top-1 right-3 z-10 h-2 w-2 rounded-full bg-oker-500" aria-label="Nieuwe melding in het menu" />
              )}
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
