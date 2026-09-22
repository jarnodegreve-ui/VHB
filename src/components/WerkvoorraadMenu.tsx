import { AlertTriangle, ArrowUpRight, CalendarClock, CalendarDays, CheckCircle2, IdCard, ListChecks, Repeat, Smartphone, UserX } from 'lucide-react';
import { cn } from '../lib/ui';
import type { View } from '../types';
import type { Werkvoorraad } from '../lib/werkvoorraad';
import { EXPIRY_SOORT_LABELS, formatShortDay } from '../lib/format';
import { useDropdown } from './useDropdown';
import { IconButton } from './primitives';
import { MenuItem, Popover, PopoverKop, PopoverVoet } from './Popover';

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
        : `Planning t/m ${formatShortDay(wv.planningHorizon)}, nog ${enkelvoud(wv.horizonDagenOver!, 'dag', 'dagen')}`,
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

      {/* Mobiel: losgekoppeld van de knop en over de volle breedte (mobielVol),
          anders viel het paneel links buiten beeld (melding Jarno 01-09). */}
      <Popover open={open} rol="menu" label="Open taken" laag="menu" breedte="xl" mobielVol>
          <PopoverKop
            titel="Open taken"
            aside={wv.attentionCount > 0 ? <span className="text-xs font-semibold text-slate-500">{enkelvoud(wv.attentionCount, 'item', 'items')}</span> : undefined}
          />
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
              <MenuItem key={r.key} icon={r.icon} iconClassName={toonKleur[r.tone]} sub={r.sub} onClick={ga(r.view)}>
                {r.label}
              </MenuItem>
            ))
          )}
          {/* Voet: het volledige scherm (15-09). Het menu blijft een samenvatting
              per soort; wie álles wil zien (of sorteren, filteren, zoeken) gaat
              naar /werkvoorraad. */}
          <PopoverVoet>
            <MenuItem icon={<ListChecks size={16} />} iconClassName="text-slate-500" trailing={<ArrowUpRight size={14} />} onClick={ga('werkvoorraad')}>
              Volledig overzicht
            </MenuItem>
          </PopoverVoet>
      </Popover>
    </div>
  );
}
