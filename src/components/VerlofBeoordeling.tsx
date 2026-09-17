import { useEffect, useState, type ReactNode } from 'react';
import { telDiensten } from '../lib/dienstTelling';
import { AlertTriangle, Check, History } from 'lucide-react';
import { teltInVerlofbezetting } from '../types';
import type { LeaveRequest, Shift, User } from '../types';
import { cn } from '../lib/ui';
import { apiJson } from '../lib/api';
import { isVerlofdag, verlofBalans, verlofDagen } from '../lib/leaveBalance';
import { shiftsConflictingWithLeave } from '../lib/conflicts';
import { formatDateHuman, formatLeaveType, formatPeriodeDMJ, formatShortDay } from '../lib/format';
import { limietVoorDag, parseVerlofLimieten, STANDAARD_VERLOF_LIMIETEN, type VerlofLimieten } from '../../shared/schemas/verlofLimieten';
import { DetailPaneel } from './DetailPaneel';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { Badge, Button, IconButton, MicroLabel, StatusBadge } from './primitives';

/**
 * Beoordeling van één verlofaanvraag: volledige context (saldo, dekking,
 * verloflimiet, dienstconflicten, toelichting) + de beslissing. Kwam uit
 * LeaveManagementView (`renderBeoordelingPaneel`) en is sinds punt 16 een
 * component, zodat de verlofkalender dezelfde beoordeling toont (een cel
 * aantikken was daar een dood einde).
 *
 * Drie lagen: `VerlofBeoordelingInhoud` (alleen de context), `VerlofBeoordelingKnoppen`
 * (de footer met beslissen/annuleren/sluiten) en `VerlofBeoordeling` (beide in
 * het gedeelde DetailPaneel, zoals Verlof het gebruikt). Een scherm dat de
 * beoordeling in een eigen paneel toont (verlofkalender: het dagpaneel)
 * gebruikt de eerste twee los.
 */

/** Alle kalenderdagen van een periode ('YYYY-MM-DD'), begrensd op 400. */
export const dagenVan = (van: string, tot: string): string[] => {
  const uit: string[] = [];
  const cur = new Date(`${van}T00:00:00`);
  const end = new Date(`${tot}T00:00:00`);
  for (let guard = 0; cur <= end && guard < 400; guard++) {
    uit.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return uit;
};

/** Bevat de periode een zondag of feestdag? Zo ja, dan verschilt het aantal
 *  verlofdagen van het aantal kalenderdagen en zetten we dat er expliciet
 *  bij, anders oogt een week van 5 of 6 dagen als een telfout. */
export const bevatVrijeDag = (van: string, tot: string) => dagenVan(van, tot).some((d) => !isVerlofdag(d));

/** Verlofrijen (geen ziekte): ziekmeldingen staan in dezelfde tabel maar
 *  tellen in de verlofbezetting nergens mee (Jarno 08-09). */
export const zonderZiekte = (leaveRequests: LeaveRequest[]) => leaveRequests.filter((r) => r.type !== 'ziekte');

/** Andere chauffeurs (niet `exclUserId`) met goedgekeurd verlof op deze dag;
 *  alleen rijdend personeel telt, een flexi-job niet. */
export const anderenAfwezigOp = (verlofRequests: LeaveRequest[], users: User[], dag: string, exclUserId: string) =>
  verlofRequests.filter((r) => {
    if (r.status !== 'approved' || String(r.userId) === String(exclUserId)) return false;
    if (!(r.startDate <= dag && r.endDate >= dag)) return false;
    const u = users.find((x) => String(x.id) === String(r.userId));
    return !u || teltInVerlofbezetting(u);
  }).length;

/** Dagen van een periode waarop deze chauffeur erbij de verloflimiet overschrijdt. */
export const dagenBovenVerlofLimiet = (
  ctx: { verlofRequests: LeaveRequest[]; users: User[]; limieten: VerlofLimieten },
  van: string,
  tot: string,
  exclUserId: string,
) => {
  // Een technieker bezet geen dienst en een flexi-job vult in, dus hun
  // verlof kan de limiet niet overschrijden, geen waarschuwing tonen.
  const doel = ctx.users.find((u) => String(u.id) === String(exclUserId));
  if (doel && !teltInVerlofbezetting(doel)) return [];
  return dagenVan(van, tot)
    .map((dag) => ({ dag, afwezig: anderenAfwezigOp(ctx.verlofRequests, ctx.users, dag, exclUserId) + 1, limiet: limietVoorDag(ctx.limieten, dag) }))
    .filter((d) => d.afwezig > d.limiet);
};

/** De verloflimieten (standaard + uitzonderingsperiodes) van de server; de
 *  standaard blijft staan als het ophalen mislukt, het scherm werkt gewoon. */
export function useVerlofLimieten(): VerlofLimieten {
  const [limieten, setLimieten] = useState<VerlofLimieten>(STANDAARD_VERLOF_LIMIETEN);
  useEffect(() => {
    let weg = false;
    void (async () => {
      try {
        // parse: rommel of een oud antwoord mag de kalender niet laten crashen.
        const data = await apiJson<unknown>('/api/verlof/limieten');
        if (!weg) setLimieten(parseVerlofLimieten(data));
      } catch {
        // standaard blijft staan
      }
    })();
    return () => { weg = true; };
  }, []);
  return limieten;
}

export type VerlofBeslissing = 'approved' | 'rejected';

export type VerlofBeoordelingContext = {
  users: User[];
  shifts: Shift[];
  /** Volledige lijst (mét ziekte): het saldo rekent op alles, de dekking filtert zelf. */
  leaveRequests: LeaveRequest[];
  limieten: VerlofLimieten;
};

/** De context van de aanvraag: badges, periode, saldo, dekking, limiet, conflicten, toelichting. */
export function VerlofBeoordelingInhoud({ aanvraag, users, shifts, leaveRequests, limieten }: VerlofBeoordelingContext & { aanvraag: LeaveRequest }) {
  const reviewLeave = aanvraag;
  const verlofRequests = zonderZiekte(leaveRequests);
  const requester = users.find((u) => u.id === reviewLeave.userId);
  const conflictShifts = shiftsConflictingWithLeave(shifts, reviewLeave);
  // Geen Math.max(1, …): een periode van alleen zondagen is écht 0
  // verlofdagen, en dat moet de beoordelaar ook zo zien.
  const dayCount = verlofDagen(reviewLeave.startDate, reviewLeave.endDate);
  const requestYear = parseInt(reviewLeave.startDate.slice(0, 4), 10);
  const balance = verlofBalans(leaveRequests, reviewLeave.userId, requestYear, requester?.verlofBudget);
  const exceeds = reviewLeave.type === 'betaald_verlof'
    && balance.betaaldGebruikt + dayCount > balance.betaaldBudget;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={reviewLeave.status} stil />
        <Badge tone="slate">{formatLeaveType(reviewLeave.type)}</Badge>
        {conflictShifts.length > 0 && (() => {
          // Diensten tellen, geen delen: een gesplitste dienst is één dienst.
          const n = telDiensten(conflictShifts);
          return (
            <Badge tone="red" icon={<AlertTriangle size={12} />}>
              {n} {n === 1 ? 'dienst' : 'diensten'} ingepland
            </Badge>
          );
        })()}
      </div>

      <Card tone="muted" padding="sm">
        <MicroLabel className="text-slate-500">Periode</MicroLabel>
        <p className="mt-1.5 text-sm font-semibold text-slate-800 tabular-nums">
          {formatPeriodeDMJ(reviewLeave.startDate, reviewLeave.endDate)}
          <span className="ml-2 font-medium text-slate-500">({dayCount} {dayCount === 1 ? 'verlofdag' : 'verlofdagen'})</span>
        </p>
        {bevatVrijeDag(reviewLeave.startDate, reviewLeave.endDate) && (
          <p className="mt-1 text-xs font-normal text-slate-500">Zondagen en feestdagen tellen niet mee als verlofdag.</p>
        )}
      </Card>

      {/* Saldo-context van de aanvrager: beslis met het budget in beeld. */}
      {/* Rood alleen als het budget overschreden wordt; een saldo dat
          klopt is informatie en blijft neutraal (afwerking 04-09, nr. 6). */}
      {reviewLeave.type === 'betaald_verlof' && (
        <Card tone={exceeds ? 'danger' : 'muted'} padding="none" className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <MicroLabel className={exceeds ? 'text-red-700' : 'text-slate-500'}>
              Verlofsaldo {requestYear}
            </MicroLabel>
            <span className={cn('text-sm font-semibold tabular-nums', exceeds ? 'text-red-700' : 'text-slate-800')}>
              {balance.betaaldGebruikt + dayCount} / {balance.betaaldBudget}
            </span>
          </div>
          <p className="mt-1 text-xs font-normal text-slate-600">
            {exceeds
              ? `Deze aanvraag gaat ${balance.betaaldGebruikt + dayCount - balance.betaaldBudget} ${balance.betaaldGebruikt + dayCount - balance.betaaldBudget === 1 ? 'dag' : 'dagen'} over het jaarbudget.`
              : `Na goedkeuring resteren ${balance.betaaldBudget - balance.betaaldGebruikt - dayCount} dagen.`}
          </p>
        </Card>
      )}

      {/* Dekkingsimpact: hoeveel andere chauffeurs hebben deze periode al
          goedgekeurd verlof (ziekte telt bewust niet mee). */}
      {(() => {
        const others = verlofRequests.filter((r) => r.status === 'approved' && String(r.userId) !== String(reviewLeave.userId));
        const overlap = others.filter((r) => r.startDate <= reviewLeave.endDate && r.endDate >= reviewLeave.startDate);
        const uniqueOthers = new Set(overlap.map((r) => String(r.userId))).size;
        if (uniqueOthers === 0) return null;
        let peak = 0;
        for (const iso of dagenVan(reviewLeave.startDate, reviewLeave.endDate)) {
          const c = overlap.filter((r) => r.startDate <= iso && r.endDate >= iso).length;
          if (c > peak) peak = c;
        }
        return (
          <Card tone="muted" padding="none" className="px-4 py-3">
            <MicroLabel className="text-slate-500">Dekking deze periode</MicroLabel>
            <p className="mt-1 text-xs font-normal text-slate-600">
              {uniqueOthers === 1 ? 'Er is al 1 andere chauffeur' : `Er zijn al ${uniqueOthers} andere chauffeurs`} met goedgekeurd verlof in deze periode{peak > 1 ? `, tot ${peak} tegelijk op de drukste dag` : ''}.
            </p>
          </Card>
        );
      })()}

      {/* Verloflimiet (instelbaar sinds 09-09): rood zodra goedkeuren
          ergens in de periode te veel chauffeurs tegelijk vrij zet. */}
      {(() => {
        const boven = dagenBovenVerlofLimiet({ verlofRequests, users, limieten }, reviewLeave.startDate, reviewLeave.endDate, String(reviewLeave.userId));
        if (boven.length === 0) return null;
        return (
          <Card tone="danger" padding="none" className="px-4 py-3">
            <MicroLabel className="text-red-700">Boven de verloflimiet</MicroLabel>
            <p className="mt-1 text-xs font-normal text-red-700">
              Na goedkeuring zitten er op {boven.length} {boven.length === 1 ? 'dag' : 'dagen'} te veel chauffeurs tegelijk vrij: {boven.slice(0, 3).map((d) => `${formatShortDay(d.dag)} ${d.afwezig} van ${d.limiet}`).join(', ')}{boven.length > 3 ? ', …' : ''}.
            </p>
          </Card>
        );
      })()}

      {conflictShifts.length > 0 && (
        <div>
          <MicroLabel className="text-red-700">Conflict met planning</MicroLabel>
          <div className="mt-2 space-y-1.5">
            {conflictShifts.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs">
                <span className="font-semibold text-slate-800 tabular-nums">{formatShortDay(s.date)}</span>
                <span className="font-medium text-slate-600 tabular-nums">Dienst {s.line} · {s.startTime}–{s.endTime}</span>
              </div>
            ))}
            {conflictShifts.length > 5 && (
              <p className="text-xs font-medium text-slate-500">+ {conflictShifts.length - 5} andere diensten in deze periode.</p>
            )}
          </div>
          <p className="mt-2 text-xs font-normal text-slate-500">Bij goedkeuring moeten deze diensten herverdeeld worden.</p>
        </div>
      )}

      {reviewLeave.comment && (
        <div>
          <MicroLabel>Toelichting van de aanvrager</MicroLabel>
          <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-soft border border-hairline-subtle px-4 py-3 text-body font-normal text-slate-700">
            {reviewLeave.comment}
          </p>
        </div>
      )}
    </div>
  );
}

export type VerlofBeoordelingActies = {
  /** Beslissen; `seenStatus` = de status die de beslisser op het scherm zag
   *  (conflictcheck op de server). */
  onDecide: (id: string, status: VerlofBeslissing, seenStatus: LeaveRequest['status']) => void;
  /** Lopend goedgekeurd verlof annuleren (planner/admin); zonder deze prop
   *  toont het paneel alleen "Sluiten". */
  onCancel?: (id: string) => void;
  /** Wijzigingsgeschiedenis openen; zonder deze prop geen historiek-knop. */
  onHistoriek?: (aanvraag: LeaveRequest) => void;
  onClose: () => void;
  /** Vandaag als ISO-dag (lokale tijd). */
  today: string;
  /** Mag deze gebruiker annuleren (planner/admin)? */
  isPlanner: boolean;
};

/** Footer: historiek + Afwijzen/Goedkeuren (pending), Verlof annuleren
 *  (lopend goedgekeurd, planner) of Sluiten. */
export function VerlofBeoordelingKnoppen({ aanvraag, onDecide, onCancel, onHistoriek, onClose, today, isPlanner, links }: VerlofBeoordelingActies & { aanvraag: LeaveRequest; /** Extra knop links (bv. "Terug"). */ links?: ReactNode }) {
  const pending = aanvraag.status === 'pending';
  // Goedgekeurd verlof dat nog loopt kan de planner hier annuleren (zelfde
  // bevestiging als in de datumkaart); afgesloten aanvragen tonen alleen
  // de historiek.
  const annuleerbaar = !!onCancel && aanvraag.status === 'approved' && aanvraag.endDate >= today && isPlanner;
  return (
    <div className="flex items-center gap-2">
      {links}
      {onHistoriek && (
        <IconButton
          label="Wijzigingsgeschiedenis"
          variant="ghost"
          onClick={() => onHistoriek(aanvraag)}
        >
          <History size={16} />
        </IconButton>
      )}
      {pending ? (
        <>
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            onClick={() => onDecide(aanvraag.id, 'rejected', aanvraag.status)}
          >
            Afwijzen
          </Button>
          <Button
            variant="success"
            size="lg"
            className="flex-1"
            icon={<Check size={16} />}
            onClick={() => onDecide(aanvraag.id, 'approved', aanvraag.status)}
          >
            Goedkeuren
          </Button>
        </>
      ) : annuleerbaar ? (
        <Button variant="danger" size="lg" className="flex-1" onClick={() => onCancel(aanvraag.id)}>
          Verlof annuleren
        </Button>
      ) : (
        <Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>
          Sluiten
        </Button>
      )}
    </div>
  );
}

/** Naam van de aanvrager (kop van het paneel). */
export const aanvragerNaam = (users: User[], aanvraag: LeaveRequest) => users.find((u) => u.id === aanvraag.userId)?.name ?? 'Onbekend';

/**
 * Beoordeling in het gedeelde DetailPaneel: op desktop bovenaan de kolom,
 * op mobiel een SlideOver. `aanvraag` null = dicht (met `verbergLeeg` ook
 * geen lege-staat-kaart).
 */
export function VerlofBeoordeling({ aanvraag, users, shifts, leaveRequests, limieten, plakkend = false, verbergLeeg = true, ...acties }: VerlofBeoordelingContext & VerlofBeoordelingActies & {
  aanvraag: LeaveRequest | null;
  plakkend?: boolean;
  verbergLeeg?: boolean;
}) {
  return (
    <DetailPaneel
      open={!!aanvraag}
      onClose={acties.onClose}
      plakkend={plakkend}
      verbergLeeg={verbergLeeg}
      sleutel={aanvraag?.id}
      title={aanvraag ? aanvragerNaam(users, aanvraag) : 'Verlofaanvraag'}
      subtitle={aanvraag ? `Aangevraagd op ${formatDateHuman(aanvraag.createdAt)}` : undefined}
      icon={aanvraag ? <Avatar naam={aanvragerNaam(users, aanvraag)} size="lg" /> : undefined}
      footer={aanvraag ? <VerlofBeoordelingKnoppen aanvraag={aanvraag} {...acties} /> : undefined}
    >
      {aanvraag && <VerlofBeoordelingInhoud aanvraag={aanvraag} users={users} shifts={shifts} leaveRequests={leaveRequests} limieten={limieten} />}
    </DetailPaneel>
  );
}
