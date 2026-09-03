import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Menu } from 'lucide-react';
import { routeVan } from '../app/routes';
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
  // Tabs per rol; naam en icoon komen uit de routetabel zodat een scherm
  // hier niet anders heet dan in de zijbalk (was "Dekking" vs
  // "Openstaande diensten").
  const tab = (view: View, badge?: number): NavSlot => {
    const r = routeVan(view);
    const Icoon = r.icoon;
    return { view, label: r.kort ?? r.label, icon: <Icoon size={18} />, badge };
  };
  const slots: NavSlot[] = isPlanner
    ? [tab('dashboard'), tab('dekking'), tab('verlof', pendingLeaveCount), tab('ruil-verzoeken', pendingSwapsCount), tab('vervaldata')]
    // Verlof i.p.v. Updates: de badge telt verlofbeslissingen (unseenLeaveCount).
    : [tab('dashboard'), tab('rooster'), tab('omleidingen'), tab('ritblaadjes'), tab('verlof', unseenLeaveCount)];

  return (
    <nav
      className={cn(
        // left/right respecteren de safe-area (landscape/notch) — iOS negeert
        // de portrait-lock uit het manifest, dus landscape kán voorkomen.
        'md:hidden fixed left-[max(0.5rem,env(safe-area-inset-left))] right-[max(0.5rem,env(safe-area-inset-right))] z-40 rounded-2xl px-1.5 py-2 transition-all duration-300',
        // Opaak oppervlak + schaduw in index.css (.bottom-dock): blur jankt op
        // een fixed balk, en doorschijnend-zonder-blur liet de content er
        // rommelig doorheen schemeren.
        'bottom-dock',
        hidden && 'pointer-events-none opacity-0 translate-y-4',
      )}
      aria-hidden={hidden || undefined}
      // Safe-area als zwevende offset ÓNDER de kaart, niet als padding erin:
      // als binnenruimte gaf de home-indicator-zone (34px op een notch-
      // iPhone) een lege band ín het dock, bovenop de zweefmarge.
      style={{
        bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
      aria-label="Hoofdnavigatie"
    >
      {/* flex-auto + min-w-0 (niet flex-1): tabs krijgen ruimte naar de
          breedte van hun label, maar mógen krimpen. Met flex-1 zonder
          min-w-0 duwde "Vervaldata"/"Omleidingen" op smalle toestellen
          (Galaxy Fold 280, oude iPhones 320, Androids 360) de "Meer"-tab
          deels of volledig buiten de kaart. Nu leveren de breedste labels
          het eerst in (ellipsis) en blijft elke tab zichtbaar en tikbaar. */}
      <ul className="flex items-center justify-around">
        {slots.map((slot) => {
          const isActive = currentView === slot.view;
          return (
            <li key={slot.view} className="flex-auto min-w-0">
              <button
                onClick={() => onSelect(slot.view)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={slot.label}
                className={cn(
                  // Hover alleen op een echte muis (pointer-fine): op touch
                  // blijft :hover na een tik plakken, waardoor een inactieve
                  // tab er permanent "half actief" uitzag.
                  'relative flex flex-col items-center justify-center gap-0.5 w-full py-1 min-h-11 rounded-lg transition-colors',
                  isActive ? 'text-oker-800' : 'text-slate-500 pointer-fine:hover:text-slate-700',
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="bottom-nav-active"
                    transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.7 }}
                    className="absolute inset-0 rounded-lg bg-oker-100"
                  />
                )}
                {/* Badge aan het icoon verankerd, niet aan de tab-rand: op een
                    smalle tab zweefde hij anders óp het icoon of erbuiten. */}
                <span className="relative z-10">
                  {slot.icon}
                  {slot.badge !== undefined && slot.badge > 0 && (
                    <span className="absolute -top-1.5 -right-3 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-2xs font-bold bg-oker-500 text-slate-950 rounded-full">
                      {slot.badge > 9 ? '9+' : slot.badge}
                    </span>
                  )}
                </span>
                <span className="relative z-10 max-[339px]:sr-only text-2xs font-semibold tracking-tight leading-tight truncate max-w-full px-0.5">
                  {slot.label}
                </span>
              </button>
            </li>
          );
        })}
        {onMore && (
          <li className="flex-auto min-w-0">
            <button
              onClick={onMore}
              aria-label="Meer"
              className="relative flex flex-col items-center justify-center gap-0.5 w-full py-1 min-h-11 rounded-lg transition-colors text-slate-500 pointer-fine:hover:text-slate-700"
            >
              <span className="relative z-10">
                <Menu size={18} />
                {moreDot && (
                  <span className="absolute -top-0.5 -right-1.5 h-2 w-2 rounded-full bg-oker-500" aria-label="Nieuwe melding in het menu" />
                )}
              </span>
              <span className="relative z-10 max-[339px]:sr-only text-2xs font-semibold tracking-tight leading-tight truncate max-w-full px-0.5">Meer</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
