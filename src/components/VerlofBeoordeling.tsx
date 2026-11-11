import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { telDiensten } from '../lib/dienstTelling';
import { AlertTriangle, Check, History } from 'lucide-react';
import { teltInVerlofbezetting } from '../types';
import type { LeaveRequest, Shift, User } from '../types';
import { cn } from '../lib/ui';
import { apiJson } from '../lib/api';
import { isVerlofdag, verlofBalans, verlofDagen } from '../lib/leaveBalance';
import { shiftsConflictingWithLeave } from '../lib/conflicts';
import { aantal, formatDateHuman, formatLeaveType, formatPeriodeDMJ, formatShortDay } from '../lib/format';
import { limietVoorDag, parseVerlofLimieten, STANDAARD_VERLOF_LIMIETEN, type VerlofLimieten } from '../../shared/schemas/verlofLimieten';
import { DetailPaneel } from './DetailPaneel';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { Badge, Button, IconButton, MicroLabel, StatusBadge } from './primitives';
import { Field, Textarea } from './Field';
import { Formulier } from './Formulier';

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
 *
 * Beslissen met alles in beeld (ronde 6, punt 15): de knoppen houden het
 * desktoppaneel binnen het venster (de inhoud scrolt in het paneel) en
 * "Dekking deze periode" noemt wie er al vrij is. Wisselt het paneel van
 * aanvraag, dan zijn de beslisknoppen even inert. Het blok "Ook aangevraagd
 * voor deze periode" komt van het scherm zelf (`wachtrij`): alleen Verlof
 * heeft een wachtrij, en deze module zit in de opwarmset van staf.
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

/** Wie heeft in de periode van `aanvraag` al goedgekeurd verlof? Per persoon
 *  zijn periodes (twee periodes van dezelfde chauffeur zijn één regel), de
 *  vroegste eerst. "Dekking deze periode" haalt hier het aantal én de namen
 *  uit, zodat die twee elkaar nooit tegenspreken. */
export const afwezigenInPeriode = (verlofRequests: LeaveRequest[], aanvraag: LeaveRequest): LeaveRequest[][] => {
  const perPersoon = new Map<string, LeaveRequest[]>();
  const anderen = verlofRequests.filter((r) => r.status === 'approved' && String(r.userId) !== String(aanvraag.userId) && r.startDate <= aanvraag.endDate && r.endDate >= aanvraag.startDate);
  for (const r of anderen.sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const eerder = perPersoon.get(String(r.userId));
    if (eerder) eerder.push(r);
    else perPersoon.set(String(r.userId), [r]);
  }
  return [...perPersoon.values()];
};

/** Zoveel namen toont "Dekking deze periode", daarna "+ n anderen". */
const DEKKING_NAMEN_MAX = 6;

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

/** De context van de aanvraag: badges, periode, saldo, dekking, limiet, conflicten, toelichting.
 *  `wachtrij` = een blok van het scherm zelf tussen de limiet en de conflicten
 *  (Verlof: "Ook aangevraagd voor deze periode"); het wisselt mee met de aanvraag. */
export function VerlofBeoordelingInhoud({ aanvraag, users, shifts, leaveRequests, limieten, wachtrij }: VerlofBeoordelingContext & { aanvraag: LeaveRequest; wachtrij?: ReactNode }) {
  const reviewLeave = aanvraag;
  const verlofRequests = zonderZiekte(leaveRequests);
  const requester = users.find((u) => u.id === reviewLeave.userId);
  const conflictShifts = shiftsConflictingWithLeave(shifts, reviewLeave);
  // Geen Math.max(1, …): een periode van alleen zondagen is écht 0
  // verlofdagen, en dat moet de beoordelaar ook zo zien.
  const dayCount = verlofDagen(reviewLeave.startDate, reviewLeave.endDate);
  const requestYear = parseInt(reviewLeave.startDate.slice(0, 4), 10);
  const balance = verlofBalans(leaveRequests, reviewLeave.userId, requestYear, requester);
  const exceeds = reviewLeave.type === 'betaald_verlof'
    && balance.betaaldGebruikt + dayCount > balance.betaaldBudget;
  // Eén uitkomst voor de badge bovenaan en de kaart met de dagen verderop.
  const bovenLimiet = dagenBovenVerlofLimiet({ verlofRequests, users, limieten }, reviewLeave.startDate, reviewLeave.endDate, String(reviewLeave.userId));
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
        {/* De beslisknoppen staan altijd in beeld, de limietkaart staat onder
            de namen van Dekking en dus vaak onder de vouw van het paneel: het
            signaal zelf staat daarom ook hier, zonder scrollen te zien. */}
        {bovenLimiet.length > 0 && (
          <Badge tone="red" icon={<AlertTriangle size={12} />}>Boven de limiet</Badge>
        )}
      </div>

      <Card tone="muted" padding="sm">
        <MicroLabel className="text-slate-600">Periode</MicroLabel>
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
            <MicroLabel className={exceeds ? 'text-red-700' : 'text-slate-600'}>
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
        // Eén bron voor het aantal en voor de namen eronder (ronde 6).
        const personen = afwezigenInPeriode(verlofRequests, reviewLeave);
        const overlap = personen.flat();
        const uniqueOthers = personen.length;
        if (uniqueOthers === 0) return null;
        let peak = 0;
        for (const iso of dagenVan(reviewLeave.startDate, reviewLeave.endDate)) {
          const c = overlap.filter((r) => r.startDate <= iso && r.endDate >= iso).length;
          if (c > peak) peak = c;
        }
        const meer = uniqueOthers - DEKKING_NAMEN_MAX;
        return (
          <Card tone="muted" padding="none" className="px-4 py-3">
            <MicroLabel className="text-slate-600">Dekking deze periode</MicroLabel>
            <p className="mt-1 text-xs font-normal text-slate-600">
              {uniqueOthers === 1 ? 'Er is al 1 andere chauffeur' : `Er zijn al ${uniqueOthers} andere chauffeurs`} met goedgekeurd verlof in deze periode{peak > 1 ? `, tot ${peak} tegelijk op de drukste dag` : ''}.
            </p>
            {/* Wie dat zijn, met hun periode: de beslisser moest ze anders in
                de kalender eronder gaan opzoeken. */}
            <ul className="mt-2.5 space-y-2">
              {personen.slice(0, DEKKING_NAMEN_MAX).map((periodes) => {
                const naam = aanvragerNaam(users, periodes[0]);
                return (
                  <li key={periodes[0].userId} className="flex items-center gap-2.5">
                    <Avatar naam={naam} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-semibold text-slate-800">{naam}</p>
                      <p className="text-xs font-normal text-slate-500 tabular-nums">{periodes.map((r) => formatPeriodeDMJ(r.startDate, r.endDate)).join(', ')}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {meer > 0 && <p className="mt-2 text-xs font-medium text-slate-500">+ {aantal(meer, 'andere', 'anderen')}</p>}
          </Card>
        );
      })()}

      {/* Verloflimiet (instelbaar sinds 09-09): rood zodra goedkeuren
          ergens in de periode te veel chauffeurs tegelijk vrij zet. */}
      {(() => {
        const boven = bovenLimiet;
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

      {wachtrij}

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

      {/* Reden van de beslisser bij een afwijzing (wens Jarno 22-09). */}
      {reviewLeave.status === 'rejected' && reviewLeave.beslisReden && (
        <div>
          <MicroLabel className="text-red-700">Reden van afwijzing</MicroLabel>
          <p className="mt-2 whitespace-pre-wrap rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-body font-normal text-slate-700">
            {reviewLeave.beslisReden}
          </p>
        </div>
      )}
    </div>
  );
}

/** Bovengrens van de weigerreden, spiegel van BESLISREDEN_MAX op de server. */
export const BESLISREDEN_MAX = 500;

export type VerlofBeoordelingActies = {
  /** Beslissen; `seenStatus` = de status die de beslisser op het scherm zag
   *  (conflictcheck op de server). `reden` = vrije tekst bij een afwijzing. */
  onDecide: (id: string, status: VerlofBeslissing, seenStatus: LeaveRequest['status'], reden?: string) => void | Promise<unknown>;
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

/** Zolang zijn de beslisknoppen inert nadat het paneel naar een andere
 *  aanvraag wisselde, en na elke klik of tik op de rij zolang dat slot erop
 *  zit (ms). Iets boven de afgesproken 600: de klok start pas nadat de nieuwe
 *  aanvraag getekend is. */
export const BESLIS_SLOT_MS = 650;

/** Vrije rand onder het desktoppaneel, en wat er van de inhoud minstens te
 *  zien blijft als het venster te laag is voor kop en knoppen samen (px). */
const PANEEL_MARGE = 16;
const INHOUD_MIN = 48;

/**
 * Begrenst de hoogte van het desktoppaneel waarin `voet` (de knoppenrij)
 * staat en geeft die kaart terug; null als er geen kaart is (telefoon:
 * SlideOver, of een test zonder schil). De kaart is de `section` van
 * DetailPaneel: de kop eerst, dan de scrollende inhoud, dan het blok met de
 * knoppen (de ouder van `voet`). Alleen precies die opbouw telt: staan de
 * knoppen ooit ergens anders, dan doet dit niets in plaats van een vreemd
 * vak te begrenzen (src/components/VerlofBeoordeling.test.tsx bewaakt de
 * koppeling met DetailPaneel).
 */
function pasPaneelIn(voet: HTMLElement | null): HTMLElement | null {
  const blok = voet && voet.parentElement;
  const kaart = blok && blok.parentElement;
  const kop = kaart && kaart.firstElementChild;
  const root = kaart && kaart.tagName === 'SECTION' ? kaart.closest<HTMLElement>('[data-scroll-root]') : null;
  if (!blok || !kaart || !root || !(kop instanceof HTMLElement)) return null;
  // De plek van de kaart als de pagina bovenaan staat, los van de scrollstand.
  const boven = kaart.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
  const vast = kop.offsetHeight + blok.offsetHeight;
  kaart.style.maxHeight = `${Math.max(root.clientHeight - boven - PANEEL_MARGE, vast + INHOUD_MIN)}px`;
  return kaart;
}

/** Footer: historiek + Afwijzen/Goedkeuren (pending), Verlof annuleren
 *  (lopend goedgekeurd, planner) of Sluiten. Afwijzen gaat in twee stappen:
 *  eerst een vrij tekstvak voor de reden (optioneel, wens Jarno 22-09),
 *  dan pas de beslissing. */
export function VerlofBeoordelingKnoppen({ aanvraag, onDecide, onCancel, onHistoriek, onClose, today, isPlanner, links }: VerlofBeoordelingActies & { aanvraag: LeaveRequest; /** Extra knop links (bv. "Terug"). */ links?: ReactNode }) {
  const pending = aanvraag.status === 'pending';
  const [weigeren, setWeigeren] = useState(false);
  const [reden, setReden] = useState('');
  const voet = useRef<HTMLDivElement>(null);

  // Slot op de beslisknoppen (ronde 6, punt 15). Wisselt het paneel naar een
  // andere aanvraag (de volgende wachtende na een beslissing, een regel in
  // "Ook aangevraagd", een andere rij), dan staat Goedkeuren van de nieuwe
  // aanvraag precies waar de vorige klik viel. Een tweede klik op dezelfde
  // plek mag die aanvraag nooit ongezien beslissen: de knoppen zijn eerst
  // BESLIS_SLOT_MS inert (zichtbaar, niet aan te klikken, niet te focussen).
  // Bijgesteld tijdens de render en niet in een effect: de allereerste keer
  // dat de nieuwe aanvraag op het scherm staat, zit het slot er al op en zijn
  // de weigerstap en de getypte reden van de vorige al weg.
  const [getoond, setGetoond] = useState(aanvraag.id);
  const [opSlot, setOpSlot] = useState(false);
  if (getoond !== aanvraag.id) {
    setGetoond(aanvraag.id);
    setOpSlot(true);
    setWeigeren(false);
    setReden('');
  }
  // De klok van het slot begint opnieuw bij elke poging tijdens het slot: het
  // eindigt pas BESLIS_SLOT_MS na de laatste klik of tik op de knoppenrij.
  // Wie uit gewoonte blijft doorklikken tot het paneel sluit (het sluit niet
  // meer, het toont de volgende), keurde met een vast venster de volgende
  // aanvraag goed met de eerste klik na die 650 ms, en daarna die erna.
  // Eén klok in een ref: een wissel en een poging vervangen telkens dezelfde.
  const slotKlok = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const herstartSlot = () => {
    clearTimeout(slotKlok.current);
    slotKlok.current = setTimeout(() => setOpSlot(false), BESLIS_SLOT_MS);
  };
  useEffect(() => {
    if (!opSlot) return;
    // De focus gaat naar de titel van het paneel, nooit naar een beslisknop:
    // Enter of spatie op de knop die de focus nog had, zou hetzelfde doen als
    // die tweede klik. Alleen als de focus in het paneel zat of verloren ging;
    // wie in de lijst ernaast een rij koos, blijft daar.
    const el = voet.current;
    const paneel = el && el.closest('section,[role=dialog]');
    const titel = paneel && paneel.querySelector<HTMLElement>('h2');
    const actief = document.activeElement;
    if (paneel && titel && (actief === document.body || paneel.contains(actief))) {
      titel.tabIndex = -1;
      titel.focus({ preventScroll: true });
    }
    // De nieuwe aanvraag begint bovenaan. Het desktoppaneel doet dat zelf, de
    // SlideOver op de telefoon niet: daar bleef de inhoud halverwege staan.
    // Het scrollende vak is in beide het blok vóór dat van de knoppen.
    const inhoud = el && el.parentElement && el.parentElement.previousElementSibling;
    if (inhoud) inhoud.scrollTop = 0;
    herstartSlot();
    // De klok uit de ref wissen, niet die van dit effect: een poging kan haar
    // intussen vervangen hebben, en die mag een volgende wissel niet te vroeg
    // van het slot halen.
    return () => clearTimeout(slotKlok.current);
  }, [opSlot, aanvraag.id]);

  // Desktop (kaart in de kolom, niet plakkend): het paneel wordt nooit hoger
  // dan wat er onder zijn bovenkant in het venster past. Kop en knoppen staan
  // vast, de inhoud scrolt in het paneel (DetailPaneel heeft die opbouw al),
  // dus Afwijzen en Goedkeuren blijven in beeld hoe lang de inhoud ook is.
  // Gemeten vanaf de plek van het paneel bij een pagina die bovenaan staat:
  // zo past het in elke scrollstand, zonder mee te rekenen tijdens het
  // scrollen. Is het venster te laag voor kop en knoppen samen, dan groeit
  // het paneel liever onder de rand door dan dat de knoppen weggeknipt worden.
  // Op de telefoon is er geen kaart (SlideOver): daar verandert niets.
  useLayoutEffect(() => { pasPaneelIn(voet.current); }, [aanvraag.id, pending, weigeren]);
  useEffect(() => {
    const kaart = pasPaneelIn(voet.current);
    if (!kaart) return;
    const opResize = () => { pasPaneelIn(voet.current); };
    window.addEventListener('resize', opResize);
    // Pas bij het weggaan van de knoppen (paneel dicht, of in de kalender
    // terug naar het dagoverzicht) mag de kaart weer vrij groeien. Nooit
    // tussendoor: de weigerstap focust zijn tekstvak in dezelfde commit, en
    // met een kaart die dan even onbegrensd is scrolt de browser de pagina
    // naar een tekstvak ver onder de rand.
    return () => {
      window.removeEventListener('resize', opResize);
      kaart.style.maxHeight = '';
    };
  }, []);

  // Welke beslissing op de server wacht: die knop toont `bezig`, de andere is
  // tijdelijk uit (fase 2: server-confirmed, maar nooit zonder feedback).
  const [bezig, setBezig] = useState<VerlofBeslissing | null>(null);
  const onderweg = useRef(false);
  const beslis = async (status: VerlofBeslissing, redenTekst?: string) => {
    // Op slot, of er loopt al een beslissing: niets doen. De knoppen zijn dan
    // ook inert of uit; dit vangt wat daar toch langs komt (een browser die
    // `inert` niet kent, een tweede klik in dezelfde tel). Ook zo'n poging
    // zet het slot opnieuw.
    if (opSlot) herstartSlot();
    if (opSlot || onderweg.current) return;
    onderweg.current = true;
    setBezig(status);
    try { await onDecide(aanvraag.id, status, aanvraag.status, redenTekst); } finally { onderweg.current = false; setBezig(null); }
  };
  // Goedgekeurd verlof dat nog loopt kan de planner hier annuleren (zelfde
  // bevestiging als in de datumkaart); afgesloten aanvragen tonen alleen
  // de historiek.
  const annuleerbaar = !!onCancel && aanvraag.status === 'approved' && aanvraag.endDate >= today && isPlanner;
  // De vaste knoppen links van de beslissing (terug naar de dag, historiek).
  const vast = (
    <>
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
    </>
  );
  // `voet` is het anker van de twee effecten hierboven: van hieruit vinden ze
  // het paneel waarin deze knoppen staan (kaart op desktop, dialoog op mobiel).
  if (pending && weigeren) {
    return (
      <div ref={voet}>
        {/* Een echte form (tranche 3A): Afwijzen is de submit. Enter in het
            tekstvak blijft een nieuwe regel, dus niemand wijst per ongeluk af. */}
        <Formulier onVerstuur={() => beslis('rejected', reden.trim() || undefined)} className="space-y-3">
          <Field label="Reden van afwijzing" hint="Optioneel. De chauffeur ziet dit bij zijn aanvraag en in de mail.">
            <Textarea
              autoFocus
              value={reden}
              maxLength={BESLISREDEN_MAX}
              onChange={(e) => setReden(e.target.value)}
              className="h-24"
              placeholder="Bv. die week zijn er al te veel collega's vrij…"
            />
          </Field>
          {/* Dezelfde indeling als de gewone rij. Het paneel is begrensd, dus
              de voet groeit naar boven en deze rij staat waar de gewone stond:
              Terug valt precies op Afwijzen, de verzendknop op Goedkeuren. Met
              twee helften over de volle breedte lag de verzendknop deels onder
              Afwijzen, en wees de tweede klik van een dubbelklik op die rand
              meteen af, zonder reden. De plaats van de vaste knoppen blijft
              leeg: dezelfde knoppen, onzichtbaar en inert, zodat de breedte
              vanzelf klopt. Alleen vanaf lg, waar het paneel die kaart is
              (zelfde grens als DetailPaneel); op de telefoon blijft de rij
              zoals ze was. */}
          <div className="flex items-center gap-2">
            {(links || onHistoriek) && <div className="invisible hidden items-center gap-2 lg:flex" inert>{vast}</div>}
            {/* De tweede klik van een dubbelklik op Afwijzen valt nu op Terug:
                die telt niet (klikteller van de browser), anders ging de stap
                open en meteen weer dicht. */}
            <Button variant="secondary" size="lg" className="flex-1" onClick={(e) => { if (e.detail <= 1) setWeigeren(false); }} disabled={!!bezig}>
              Terug
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="lg"
              className="flex-1"
              bezig={bezig === 'rejected'}
            >
              Afwijzen
            </Button>
          </div>
        </Formulier>
      </div>
    );
  }
  return (
    // Een klik of tik op de rij terwijl het slot erop zit, zet het opnieuw:
    // de inerte knoppen geven de aanwijzer door aan deze rij.
    <div ref={voet} className="flex items-center gap-2" onPointerDown={opSlot ? herstartSlot : undefined}>
      {vast}
      {pending ? (
        // Eén blok om de twee beslisknoppen, zodat het slot ze samen inert
        // zet; ze delen de rest van de rij zoals voorheen.
        <div className="flex flex-1 items-center gap-2" inert={opSlot}>
          <Button
            variant="danger"
            size="lg"
            className="flex-1"
            disabled={!!bezig}
            onClick={() => { if (opSlot) herstartSlot(); else setWeigeren(true); }}
          >
            Afwijzen
          </Button>
          <Button
            variant="success"
            size="lg"
            className="flex-1"
            icon={<Check size={16} />}
            bezig={bezig === 'approved'}
            onClick={() => void beslis('approved')}
          >
            Goedkeuren
          </Button>
        </div>
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
 * geen lege-staat-kaart). `plakkend` blijft uit: de knoppen houden het paneel
 * zelf binnen het venster (zie VerlofBeoordelingKnoppen), en een plakkend
 * paneel zou de kalender eronder bedekken zolang het open staat.
 *
 * `scroll-mt-20`: op een gescrolde pagina brengt DetailPaneel het paneel in
 * beeld tegen de bovenrand van de pagina, en daar plakt de topbar. Zonder de
 * marge lag de naam van de aanvrager erachter, ook van de aanvraag waar het
 * paneel na een beslissing vanzelf naar doorschakelt.
 */
export function VerlofBeoordeling({ aanvraag, users, shifts, leaveRequests, limieten, wachtrij, plakkend = false, verbergLeeg = true, ...acties }: VerlofBeoordelingContext & VerlofBeoordelingActies & {
  aanvraag: LeaveRequest | null;
  /** Blok van het scherm in de inhoud, zie VerlofBeoordelingInhoud. */
  wachtrij?: ReactNode;
  plakkend?: boolean;
  verbergLeeg?: boolean;
}) {
  return (
    <DetailPaneel
      open={!!aanvraag}
      onClose={acties.onClose}
      plakkend={plakkend}
      verbergLeeg={verbergLeeg}
      className="scroll-mt-20"
      sleutel={aanvraag?.id}
      title={aanvraag ? aanvragerNaam(users, aanvraag) : 'Verlofaanvraag'}
      subtitle={aanvraag ? `Aangevraagd op ${formatDateHuman(aanvraag.createdAt)}` : undefined}
      icon={aanvraag ? <Avatar naam={aanvragerNaam(users, aanvraag)} size="lg" /> : undefined}
      footer={aanvraag ? <VerlofBeoordelingKnoppen aanvraag={aanvraag} {...acties} /> : undefined}
    >
      {aanvraag && <VerlofBeoordelingInhoud aanvraag={aanvraag} users={users} shifts={shifts} leaveRequests={leaveRequests} limieten={limieten} wachtrij={wachtrij} />}
    </DetailPaneel>
  );
}
