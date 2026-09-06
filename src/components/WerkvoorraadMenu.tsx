import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, IdCard, ListChecks, Repeat, Smartphone, UserX } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/ui';
import type { View } from '../types';
import type { Werkvoorraad } from '../lib/werkvoorraad';
import { EXPIRY_SOORT_LABELS, formatShortDay } from '../lib/format';
import { useDropdown } from './useDropdown';
import { IconButton } from './primitives';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';

/**
 * Werkvoorraad-knop in de topbar (idee Jarno 31-08): één plek die vanuit élk
 * scherm toont wat er open staat — de statuspil op het dashboard is hiermee
 * vervallen. Badge met teller zolang er iets open staat; uitklapmenu somt de
 * werkvoorraad per soort op (met een detail-subregel zodat je zonder
 * doorklikken weet wát er speelt) en navigeert rechtstreeks naar het juiste
 * scherm. Dropdown-gedrag gedeeld met UserMenu via useDropdown.
 */

type Rij = {
  key: string;
  icon: ReturnType<typeof AlertTriangle>;
  tone: 'red' | 'amber' | 'blue';
  label: string;
  sub?: string;
  view: View;
};

/** "Naam A, Naam B +3" — compacte opsomming voor de subregel. */
function somOp(namen: string[], max = 2): string {
  const kop = namen.slice(0, max).join(', ');
  return namen.length > max ? `${kop} +${namen.length - max}` : kop;
}

export function WerkvoorraadMenu({
  werkvoorraad,
  userNaam,
  onNavigate,
}: {
  werkvoorraad: Werkvoorraad;
  /** Naam bij een user-id (App heeft de users-lijst). */
  userNaam: (id: string) => string;
  onNavigate: (view: View) => void;
}) {
  const { open, setOpen, wortel } = useDropdown();

  const wv = werkvoorraad;
  const enkelvoud = (n: number, ev: string, mv: string) => `${n} ${n === 1 ? ev : mv}`;

  // Samenvatting per soort — de detail-rijen wonen op het dashboard en in de
  // doel-schermen; hier telt de kortste route naar de actie.
  const rijen: Rij[] = [];
  if (wv.planningStale) {
    rijen.push({ key: 'stale', icon: <CalendarClock size={16} />, tone: 'amber', label: `Planning al ${wv.daysSinceImport} dagen niet bijgewerkt`, view: 'beheer-roosters' });
  }
  if (wv.horizonKrap) {
    rijen.push({
      key: 'horizon',
      icon: <CalendarClock size={16} />,
      tone: wv.horizonDagenOver! <= 0 ? 'red' : 'amber',
      label: wv.horizonDagenOver! <= 0
        ? 'De geladen planning is op'
        : `Planning t/m ${formatShortDay(wv.planningHorizon)} — nog ${enkelvoud(wv.horizonDagenOver!, 'dag', 'dagen')}`,
      view: 'beheer-roosters',
    });
  }
  if (wv.importIssueCount > 0 && wv.lastImport) {
    rijen.push({
      key: 'import',
      icon: <AlertTriangle size={16} />,
      tone: 'red',
      label: `Laatste import: ${enkelvoud(wv.importIssueCount, 'aandachtspunt', 'aandachtspunten')}`,
      sub: [
        wv.lastImport.unknownCodes.length > 0 ? `${wv.lastImport.unknownCodes.length} onbekende codes` : null,
        wv.lastImport.unmatchedDrivers.length > 0 ? `${wv.lastImport.unmatchedDrivers.length} niet-gematchte chauffeurs` : null,
      ].filter(Boolean).join(' · '),
      view: 'beheer-roosters',
    });
  }
  if (wv.teHerverdelen.length > 0) {
    rijen.push({
      key: 'herverdeel',
      icon: <UserX size={16} />,
      tone: 'red',
      label: `${enkelvoud(wv.teHerverdelen.length, 'dienst', 'diensten')} te herverdelen`,
      sub: somOp(wv.herverdeelPerChauffeur.map((g) => `${g.naam} (${g.diensten.length})`)),
      view: 'ziekte',
    });
  }
  if (wv.gapDays.length > 0) {
    rijen.push({
      key: 'gaten',
      icon: <AlertTriangle size={16} />,
      tone: 'red',
      label: `Open diensten op ${enkelvoud(wv.gapDays.length, 'dag', 'dagen')}`,
      sub: somOp(wv.gapDays.map((d) => `${formatShortDay(d.date)} · ${d.missing.length} open`)),
      view: 'dekking',
    });
  }
  if (wv.pendingLeave.length > 0) {
    rijen.push({
      key: 'verlof',
      icon: <CalendarDays size={16} />,
      tone: 'amber',
      label: enkelvoud(wv.pendingLeave.length, 'verlofaanvraag', 'verlofaanvragen'),
      sub: somOp(wv.pendingLeave.map((r) => userNaam(r.userId))),
      view: 'verlof',
    });
  }
  if (wv.pendingSwaps.length > 0) {
    rijen.push({
      key: 'ruil',
      icon: <Repeat size={16} />,
      tone: 'blue',
      label: enkelvoud(wv.pendingSwaps.length, 'ruilverzoek', 'ruilverzoeken'),
      sub: somOp(wv.pendingSwaps.map((s) => userNaam(s.requesterId))),
      view: 'ruil-verzoeken',
    });
  }
  if (wv.pendingDevices.length > 0) {
    rijen.push({
      key: 'toestellen',
      icon: <Smartphone size={16} />,
      tone: 'amber',
      label: `${enkelvoud(wv.pendingDevices.length, 'toestel wacht', 'toestellen wachten')} op goedkeuring`,
      sub: somOp(wv.pendingDevices.map((d) => userNaam(d.userId))),
      view: 'toestellen',
    });
  }
  if (wv.vervalTaken.length > 0) {
    const urgentste = wv.vervalTaken[0];
    rijen.push({
      key: 'vervaldata',
      icon: <IdCard size={16} />,
      tone: wv.vervalTaken.some((e) => e.dagen < 0) ? 'red' : 'amber',
      label: `${enkelvoud(wv.vervalTaken.length, 'vervaldatum', 'vervaldata')} binnen 30 dagen`,
      sub: `${EXPIRY_SOORT_LABELS[urgentste.soort] ?? urgentste.soort} · ${userNaam(urgentste.userId)} · ${
        urgentste.dagen < 0 ? 'verlopen' : urgentste.dagen === 0 ? 'vandaag' : `over ${enkelvoud(urgentste.dagen, 'dag', 'dagen')}`
      }`,
      view: 'vervaldata',
    });
  }

  const toonKleur: Record<Rij['tone'], string> = {
    red: 'text-red-700',
    amber: 'text-amber-700',
    blue: 'text-blue-700',
  };

  const ga = (view: View) => () => { setOpen(false); onNavigate(view); };

  // Urgentie zichtbaar zonder het menu te openen: zit er een rode categorie
  // in (herverdelen, open diensten, verlopen documenten, kapotte import),
  // dan kleurt de teller-badge mee (vraag Jarno 01-09).
  const heeftRood = rijen.some((r) => r.tone === 'red');

  return (
    <div ref={wortel} className="relative">
      <IconButton
        label={wv.attentionCount > 0 ? `Open taken (${wv.attentionCount})` : 'Open taken'}
        title="Open taken"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn('relative', open && 'bg-slate-100 text-slate-800')}
      >
        <ListChecks size={16} />
        {wv.attentionCount > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 inline-flex items-center justify-center rounded-full text-2xs font-bold ring-2 ring-paper',
              heeftRood
                ? 'bg-red-600 text-white'
                : 'bg-amber-500 text-slate-950',
            )}
          >
            {wv.attentionCount > 9 ? '9+' : wv.attentionCount}
          </span>
        )}
      </IconButton>

      <AnimatePresence>
      {open && (
        <motion.div
          role="menu"
          aria-label="Open taken"
          initial={{ opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: DUR.fast, ease: EASE_SPRING } }}
          exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: DUR.fast, ease: EASE } }}
          style={{ transformOrigin: 'top right' }}
          /* Mobiel: fixed met inset-x zodat het paneel de viewport volgt —
             absoluut verankerd aan de knop viel het links buiten beeld
             (melding Jarno 01-09); top-auto = de plek onder de knop. */
          className="absolute right-0 top-full mt-2 w-80 rounded-2xl bg-paper ring-1 ring-hairline shadow-xl p-1.5 z-50 max-sm:fixed max-sm:inset-x-3 max-sm:top-auto max-sm:w-auto"
        >
          <div className="flex items-center justify-between px-3 py-2 mb-1 border-b fine-divider">
            <span className="text-sm font-semibold text-slate-800">Open taken</span>
            {wv.attentionCount > 0 && (
              <span className="text-2xs font-semibold text-slate-500">
                {enkelvoud(wv.attentionCount, 'item', 'items')}
              </span>
            )}
          </div>
          {rijen.length === 0 ? (
            <div className="flex items-center gap-3 px-3 py-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-700">
                <CheckCircle2 size={16} />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">Alles operationeel</p>
                <p className="text-xs font-normal text-slate-500">Geen open taken of openstaande diensten.</p>
              </div>
            </div>
          ) : (
            rijen.map((r) => (
              // rauw: dropdown-menurij (role=menuitem) met tweeregelige eigen layout
              // (icoon + label + subregel, links uitgelijnd) — geen knop-uiterlijk.
              <button
                key={r.key}
                role="menuitem"
                onClick={ga(r.view)}
                className="flex items-start gap-3 w-full px-3 py-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 rounded-xl transition-colors duration-150 font-medium text-sm text-left"
              >
                <span className={cn('shrink-0 mt-0.5', toonKleur[r.tone])}>{r.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{r.label}</span>
                  {r.sub && (
                    <span className="block truncate text-xs font-normal text-slate-500">{r.sub}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
