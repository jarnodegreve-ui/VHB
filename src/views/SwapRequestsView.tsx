import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Plus, ArrowLeftRight, ChevronDown, ChevronRight, Handshake, History, Printer, X, Check, Trash2 } from 'lucide-react';
import { isStaf } from '../types';
import type { LeaveRequest, Shift, SwapRequest, SwapType, User } from '../types';
import { ConfirmationModal, EmptyState, ModalHeader, PageHeader, PageShell } from '../components/ui';
import { Modal } from '../components/Modal';
import { Formulier } from '../components/Formulier';
import { useVeldfouten, useVuil } from '../lib/formulier';
import { Badge, Button, IconButton, MicroLabel } from '../components/primitives';
import { RuilStatusBadge } from '../components/RuilStatusBadge';
import { Uitklap, uitklapChevron } from '../components/Uitklap';
import { LijstKaart, RecordRij } from '../components/RecordRij';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { DateInput, Field, Textarea } from '../components/Field';
import { SlideOver } from '../components/SlideOver';
import { EntityHistoryModal } from '../components/EntityHistoryModal';
import { RuilVerloop } from '../components/RuilVerloop';
import { ruilStatusMap } from '../../shared/ruilUitkomst';
import { statusLabel } from '../../shared/status';
import { RuilRust } from '../components/RuilRust';
import { RuilBekekenBaken } from '../components/RuilBekekenBaken';
import { fetchAvailability, isoDate, addDays } from '../lib/availability';
import { addDagen } from '../lib/datum';
import { maandagVan } from '../lib/roosterUren';
import { isoWeekOf } from '../lib/week';
import { formatDateHuman, formatPeriodeDMJ, formatShortDay, hoofdletter, serviceNumberOf, tijdvak } from '../lib/format';
import { dienstSleutel, eigenDienstOp, groepeerPerDienst } from '../lib/ruilWizard';
import { canRespondToSwap } from '../lib/authorization';
import { notify, openPdfInNewTab } from '../lib/ui';
import { AllesGedaan, LegeLijst } from '../components/illustraties';
import { TableShell, Td, Th } from '../components/TabelBasis';
import { RecordOnbekend } from '../components/RecordOnbekend';
import { useRecordLink } from '../app/useRecordLink';
import { brengRecordInBeeld } from '../lib/recordLink';

type ReturnOption = { date: string; code: string; isFree: boolean };

/** Vaste visuele identiteit van de overname (ruil zonder tegenprestatie) —
 *  overal dezelfde badge i.p.v. losse blauwe tekstregels per lijst. Stil:
 *  het is een soort, geen signaal (afwerking 04-09, nr. 6). */
const TakeoverBadge = ({ compact = false }: { compact?: boolean }) => (
  <Badge tone="blue" stil icon={<Handshake size={12} />}>
    {compact ? 'Overname' : 'Overname, geen tegenprestatie'}
  </Badge>
);

export function SwapRequestsView({ user, swaps, shifts, users, leaveRequests = [], onSave, onDecide, preselectShiftId = null, onPreselectConsumed, onConfirmSeen }: { user: User, swaps: SwapRequest[], shifts: Shift[], users: User[], leaveRequests?: LeaveRequest[], onSave: (s: SwapRequest[]) => void | boolean | Promise<void | boolean>, onDecide?: (id: string, status: SwapRequest['status'], seenStatus?: string) => Promise<boolean>, preselectShiftId?: string | null, onPreselectConsumed?: () => void, onConfirmSeen?: (id: string) => Promise<boolean> }) {
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Bevestigingen via de nette ConfirmationModal i.p.v. kale window.confirm
  // (browser-popup met "vhb-five.vercel.app meldt…" schrikt chauffeurs af).
  const [expandedSwapIds, setExpandedSwapIds] = useState<string[]>([]);
  const toggleSwapExpanded = (id: string) => setExpandedSwapIds((cur) => (
    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  ));
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmText: string;
    variant: 'danger' | 'warning';
    run: () => void | Promise<unknown>;
  } | null>(null);
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [selectedTargetDriver, setSelectedTargetDriver] = useState<string>('');
  const [reason, setReason] = useState('');
  // Wizard i.p.v. 3 afhankelijke dropdowns: één vraag per stap, tikbare
  // kaarten, en een samenvatting vóór het indienen (UX-review: dit was de
  // moeilijkste flow — keuze-overload met tot 56 opties in één select).
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [showAllReturns, setShowAllReturns] = useState(false);
  // Stap 1 toont eerst de komende ~2 weken; bij een volle 8-wekenplanning
  // stonden er anders 30-40 kaarten in één modal.
  const [showAllShifts, setShowAllShifts] = useState(false);
  const [historySwap, setHistorySwap] = useState<SwapRequest | null>(null);
  // Weekoverzicht van de uitgevoerde dienstwissels afdrukken (bewijsstuk voor
  // het klassement, Jarno 18-09). De datum mag elke dag uit de week zijn, het
  // printscherm neemt de maandag; standaard de lopende week.
  const [printDag, setPrintDag] = useState(() => isoDate(new Date()));
  const drukWeekoverzichtAf = (dag: string) => {
    if (dag) openPdfInNewTab(`${window.location.origin}${window.location.pathname}?ruiloverzicht-week=${dag}`);
  };
  // Beoordeling in een side panel: alle ruil-context + beslis-acties
  // zonder paginawissel (zelfde patroon als LeaveManagementView).
  // Eén ruil staat in de URL (`/dienstruil/<id>`, tranche 3C): de link uit
  // een melding, het dashboard, Vandaag of een klik in de beheertabel. Staf
  // krijgt het beoordelingspaneel; een chauffeur de ruil in zijn eigen lijst
  // (open en in beeld), of een alleen-lezen kaart als ze daar niet (meer)
  // staat. Wat niet in zijn gegevens staat geeft één nette melding.
  const link = useRecordLink('ruil-verzoeken', swaps);
  const reviewSwap = isStaf(user.role) && link.staat === 'gevonden' ? link.record : null;
  const setReviewSwap = (swap: SwapRequest | null) => (swap ? link.open(swap.id) : link.sluit());
  const eigenDoel = !isStaf(user.role) && link.staat === 'gevonden' ? link.record : null;
  // Dienstruil-matching: wie is vrij op de dag van de gekozen dienst?
  const [freeForDate, setFreeForDate] = useState<Set<string> | null>(null);
  // Dienstcode per collega die die dag rijdt, zodat een bezette collega
  // "dienst 2104" toont i.p.v. een kaal "bezet" — bij een 1-op-1 ruil op
  // dezelfde dag is dat net de collega die je zoekt.
  const [linesForDate, setLinesForDate] = useState<Record<string, string>>({});
  // Ruil zonder tegenprestatie: per collega-id de planningcode ('vrij', 'bv',
  // 'tk', 'ta') waarop hij/zij de dienst die dag mag overnemen. Komt van de
  // server; alleen wie hierin staat, kan als overname aangeduid worden.
  const [takeoverForDate, setTakeoverForDate] = useState<Record<string, string> | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  // Vorm van de aanvraag: 1-op-1 ruil (default) of overname zonder tegenprestatie.
  const [swapType, setSwapType] = useState<SwapType>('ruil');
  // Scroll terug naar boven bij elke stapwissel: wie in stap 2 ver naar
  // beneden scrolde, opende stap 3 anders halverwege de lijst.
  const wizardScrollRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    wizardScrollRef.current?.scrollTo({ top: 0 });
  }, [wizardStep]);
  // 1-op-1 ruil: wat neemt de aanvrager in ruil van de collega?
  const [returnPick, setReturnPick] = useState<string>(''); // "date|code"
  // Tranche 3A: de knop blijft uit zolang een stap ontbreekt (met de uitleg
  // eronder); komt er tóch een submit door, dan staat de fout bij die stap.
  // Sleutels: 'dienst' (stap 1), 'collega' (stap 2), 'tegenprestatie' (stap 3).
  const wizardFouten = useVeldfouten();
  // Drie stappen kwijt door een tik naast de modal is het ergste geval van de
  // app: met invoer vraagt sluiten eerst bevestiging.
  const { vuil: wizardVuil } = useVuil({ selectedShift, selectedTargetDriver, returnPick, swapType, reason }, showOfferModal);
  const [returnOptions, setReturnOptions] = useState<ReturnOption[] | null>(null);
  const [returnLoading, setReturnLoading] = useState(false);

  const selectedShiftDate = shifts.find((s) => s.id === selectedShift)?.date;

  useEffect(() => {
    if (!selectedShiftDate) {
      setFreeForDate(null);
      setTakeoverForDate(null);
      setLinesForDate({});
      return;
    }
    let cancelled = false;
    setMatchLoading(true);
    fetchAvailability(selectedShiftDate, selectedShiftDate, { takeover: true })
      .then((res) => {
        if (cancelled) return;
        const day = res.days.find((d) => d.date === selectedShiftDate);
        setFreeForDate(new Set(day?.free ?? []));
        setTakeoverForDate(day?.takeover ?? {});
        setLinesForDate(day?.lines ?? {});
      })
      .catch(() => { if (!cancelled) { setFreeForDate(null); setTakeoverForDate(null); } })
      .finally(() => { if (!cancelled) setMatchLoading(false); });
    return () => { cancelled = true; };
  }, [selectedShiftDate]);

  // Komende diensten + vrije dagen van de gekozen collega (8 weken vooruit),
  // zodat de aanvrager kiest wat hij in ruil neemt (1-op-1 ruil).
  useEffect(() => {
    if (!selectedTargetDriver) {
      setReturnOptions(null);
      setReturnPick('');
      return;
    }
    let cancelled = false;
    setReturnLoading(true);
    setReturnPick('');
    const today = new Date();
    fetchAvailability(isoDate(today), isoDate(addDays(today, 56)))
      .then((res) => {
        if (cancelled) return;
        const opts: ReturnOption[] = [];
        for (const day of res.days) {
          const dienst = day.lines?.[selectedTargetDriver];
          // Rijdt de collega die dag twéé verschillende diensten, dan plakt
          // /api/availability ze samen tot "4101/4205". Zo'n samengestelde
          // code matcht geen enkele planning-rij, dus bij de doorvoer zou de
          // terugruil stil niets verplaatsen en werd de 1-op-1 ruil feitelijk
          // een eenzijdige overname. De server weigert hem nu; hier bieden we
          // hem niet meer aan, i.p.v. de aanvrager een doodlopend pad in te
          // sturen.
          if (dienst?.includes('/')) continue;
          if (dienst) opts.push({ date: day.date, code: dienst, isFree: false });
          else if (day.free?.includes(selectedTargetDriver)) opts.push({ date: day.date, code: 'vrij', isFree: true });
        }
        opts.sort((a, b) => a.date.localeCompare(b.date));
        setReturnOptions(opts);
      })
      .catch(() => { if (!cancelled) setReturnOptions([]); })
      .finally(() => { if (!cancelled) setReturnLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTargetDriver, user.id]);

  const isPlanner = user.role === 'planner' || user.role === 'admin';
  const isAdmin = user.role === 'admin';
  /** Naam bij een id, voor het verloop per persoon (RuilVerloop). */
  const naamVan = (id: string) => users.find((u) => u.id === id)?.name;

  /** Kan staf deze wissel uit de geschiedenis wissen? Alleen afgewezen of
   *  ingetrokken: een doorgevoerde (approved/completed) zit in de
   *  heropbouw-replay en weigert de server bewust (annuleren draait de
   *  planning wél mee terug). Bedoeld om testwissels op te ruimen (Jarno
   *  09-09). */
  const kanWissen = (swap: SwapRequest) => isStaf(user.role) && (swap.status === 'rejected' || swap.status === 'cancelled');
  /** Wissen met bevestiging, niet met een ongedaan-toast: een afgewezen
   *  wissel opnieuw aanmaken weigert de server (alleen 'pending' mag nieuw),
   *  dus een weg terug is er niet. */
  const vraagWissen = (swap: SwapRequest) => {
    const naam = users.find((u) => u.id === swap.requesterId)?.name ?? 'de aanvrager';
    setConfirmAction({
      title: 'Wissel uit de geschiedenis wissen',
      message: `Deze ${swap.status === 'rejected' ? statusLabel(ruilStatusMap(swap), 'rejected', true) : 'ingetrokken'} wissel van ${naam} definitief wissen? Dit kan niet ongedaan gemaakt worden; het activiteitenlog houdt wel bij dat hij verwijderd is.`,
      confirmText: 'Wissen',
      variant: 'danger',
      run: () => { void onSave(swaps.filter((s) => s.id !== swap.id)); },
    });
  };
  const todayIso = isoDate(new Date());
  // Alleen kómende eigen diensten, chronologisch — verleden diensten ruilen
  // heeft geen zin en vulde de keuzelijst nodeloos. Eén kaart per dienst: een
  // gesplitste dienst is meerdere planning-rijen, maar de ruil (en de
  // doorvoer) gaat altijd over de hele dienst (zie lib/ruilWizard).
  const myShifts = groepeerPerDienst(shifts.filter(s => s.driverId === user.id && s.date >= todayIso));
  // Diensten waarvoor al een verzoek loopt: de server weigert een tweede met
  // een 409, en dat geldt sinds 18-09 voor de hele dienst (ook het andere deel
  // van een gesplitste dienst). Hier tonen we dat vóór het indienen, zodat de
  // wizard niet doodloopt op een foutmelding.
  const lopendeRuilSleutels = new Set(
    swaps
      .filter((s) => (s.status === 'pending' || s.status === 'accepted') && s.shiftDate && s.shiftLine)
      .map((s) => dienstSleutel({ date: String(s.shiftDate), line: String(s.shiftLine) })),
  );
  const heeftLopendeRuil = (s: Pick<Shift, 'date' | 'line'>) => lopendeRuilSleutels.has(dienstSleutel(s));
  /**
   * Dienst-info bij een ruil. `shifts` bevat alleen de éigen planning, dus de
   * aangeboden dienst zit er lang niet altijd in: de aangezochte collega heeft
   * hem nooit, en ná goedkeuring is de rij naar de collega verhuisd — de
   * aanvrager zag dan "Dienst --" met lege datum bij precies de ruil die net
   * gelukt was. De server bewaart daarom shiftDate/shiftLine op de ruil zelf;
   * die zijn hier de bron, de planning-rij vult alleen de uren aan.
   */
  const shiftInfoFor = (swap: SwapRequest) => {
    const shift = shifts.find(s => s.id === swap.shiftId);
    return {
      shift,
      line: String(swap.shiftLine || shift?.line || '--').trim() || '--',
      date: swap.shiftDate || shift?.date || '',
      startTime: shift?.startTime,
      endTime: shift?.endTime,
    };
  };
  /** De ruil voor het verloop per persoon: oude ruilen dragen zelf geen
   *  shiftDate/shiftLine, dan vult de planning-rij aan (zoals shiftInfoFor),
   *  zodat "krijgt dienst …" ook daar klopt. */
  const voorVerloop = (swap: SwapRequest): SwapRequest => {
    if (swap.shiftDate && swap.shiftLine) return swap;
    const info = shiftInfoFor(swap);
    return { ...swap, shiftDate: info.date || undefined, shiftLine: info.line !== '--' ? info.line : undefined };
  };
  // Gedeelde compacte dag-vorm ('vr 18 jul') — gelijk aan Dekking, i.p.v. de
  // eigen 'vr 18/07'-variant (datum-consolidatie).
  const fmtShort = formatShortDay;

  // Ruil gestart vanuit het rooster: open de wizard meteen op stap 2 met de
  // aangetikte dienst voorgeselecteerd (scheelt de chauffeur stap 1).
  useEffect(() => {
    if (!preselectShiftId) return;
    // De aangetikte rij kan het tweede deel van een gesplitste dienst zijn;
    // de kaart draagt het id van het eerste deel.
    const rij = shifts.find((s) => s.id === preselectShiftId);
    const shift = rij ? myShifts.find((s) => dienstSleutel(s) === dienstSleutel(rij)) : undefined;
    if (shift) {
      setSelectedShift(shift.id);
      setSelectedTargetDriver('');
      setReturnPick('');
      setSwapType('ruil');
      setWizardStep(2);
      wizardFouten.wis();
      setShowOfferModal(true);
    }
    onPreselectConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectShiftId]);
  // Tikbare wizard-kaart (stap 1/2/3): geselecteerd = neutraal (gedempt vlak + sterke hairline), geen goud.
  const cnCard = (selected: boolean) =>
    `ios-pressable w-full flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${selected ? 'border-hairline-strong bg-surface-muted' : 'border-hairline bg-surface-white hover:bg-surface-soft-hover'}`;
  /** Ruil zonder tegenprestatie: de collega neemt de dienst gewoon over. */
  const isTakeoverSwap = (swap: SwapRequest) => swap.swapType === 'overname';
  // "krijgt: dienst 4101 (vr 10/07)" of "krijgt: vrij (vr 10/07)"
  const returnLabel = (swap: SwapRequest) => {
    if (isTakeoverSwap(swap)) return null;
    if (!swap.returnCode || !swap.returnDate) return null;
    const what = swap.returnCode.toLowerCase() === 'vrij' ? 'vrij' : `dienst ${swap.returnCode}`;
    return `${what} (${fmtShort(swap.returnDate)})`;
  };
  // Beschikbaar op de dag van de aangeboden dienst = vrij (geen dienst, geen
  // verlof) óf op vrij/bv/tk/ta in de planning (dan kan een overname).
  const takeoverCodeFor = (driverId: string) => takeoverForDate?.[driverId];
  const isAvailableOnShiftDate = (driverId: string) =>
    !!freeForDate?.has(driverId) || !!takeoverForDate?.[driverId];
  const eligibleTargetDrivers = useMemo(() => {
    const base = users
      // Alleen chauffeurs: planner/admin staan niet in de planning-matrix en
      // toonden daardoor altijd "bezet" → doodlopend pad in stap 3.
      .filter((u) => u.id !== user.id && u.isActive !== false && u.role === 'chauffeur' && u.name.toLowerCase() !== 'beheerder')
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!freeForDate) return base;
    // Beschikbare collega's eerst (matching), daarna de rest. Beide blijven
    // kiesbaar — de planner kan altijd overschrijven.
    return [...base].sort((a, b) => {
      const af = freeForDate.has(a.id) || takeoverForDate?.[a.id] ? 0 : 1;
      const bf = freeForDate.has(b.id) || takeoverForDate?.[b.id] ? 0 : 1;
      return af - bf || a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, user.id, freeForDate, takeoverForDate]);
  const freeCount = freeForDate
    ? eligibleTargetDrivers.filter((u) => isAvailableOnShiftDate(u.id)).length
    : null;
  const mySwaps = swaps.filter(s => s.requesterId === user.id);
  // Aan mij gerichte ruilverzoeken: pending (te beantwoorden) + accepted
  // (door mij geaccepteerd, wacht op planner) zodat de collega de status volgt.
  const availableSwaps = swaps.filter(s => {
    if (s.requesterId === user.id) return false;
    // Een doorgevoerde wissel die de chauffeur nog niet bevestigde blijft in
    // zijn lijst staan mét bevestig-knop — zo weet de planner dat de nieuwe
    // rijder de wijziging écht gezien heeft (push bereikt bijna niemand).
    const wachtOpBevestiging = s.status === 'approved' && s.targetDriverId === user.id && !s.targetSeenAt;
    if (s.status !== 'pending' && s.status !== 'accepted' && !wachtOpBevestiging) return false;
    // Tonen aan de chauffeur waaraan de ruil gericht is. Planner/admin
    // ziet alle openstaande ruilverzoeken (zoals voorheen).
    if (!isPlanner && s.targetDriverId && s.targetDriverId !== user.id) return false;

    const requester = users.find(u => u.id === s.requesterId);
    const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
    if (isBeheerder) return false;
    return true;
  });

  // Deeplink van een chauffeur: staat de ruil in een van zijn lijsten, dan daar
  // open (eigen verzoek) en in beeld met de focus erop, één keer per id.
  const doelInLijst = !!eigenDoel && (mySwaps.some((s) => s.id === eigenDoel.id) || availableSwaps.some((s) => s.id === eigenDoel.id));
  const gebrachtRef = useRef<string | null>(null);
  useEffect(() => {
    if (!eigenDoel || gebrachtRef.current === eigenDoel.id) return;
    gebrachtRef.current = eigenDoel.id;
    if (mySwaps.some((s) => s.id === eigenDoel.id)) {
      setExpandedSwapIds((cur) => (cur.includes(eigenDoel.id) ? cur : [...cur, eigenDoel.id]));
    }
    requestAnimationFrame(() => { brengRecordInBeeld(eigenDoel.id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eigenDoel?.id]);

  // Gezien-bevestiging door de ontvanger van de dienst.
  const [isConfirmingSeen, setIsConfirmingSeen] = useState<string | null>(null);
  // Welke ruil nu op een serverantwoord wacht: de knoppen van die ruil tonen
  // `bezig` (fase 2); de rest blijft bedienbaar.
  const [beslisBezig, setBeslisBezig] = useState<string | null>(null);
  const bevestigGezien = async (id: string) => {
    if (isConfirmingSeen || !onConfirmSeen) return;
    setIsConfirmingSeen(id);
    try {
      await onConfirmSeen(id);
    } finally {
      setIsConfirmingSeen(null);
    }
  };

  const handleOfferShift = async () => {
    if (isSubmitting) return;
    const isTakeover = swapType === 'overname';
    if (!selectedShift) {
      wizardFouten.zet({ dienst: 'Kies eerst de dienst die je wilt afgeven.' });
      setWizardStep(1);
      return;
    }
    if (!selectedTargetDriver) {
      wizardFouten.zet({ collega: 'Kies eerst de collega met wie je ruilt.' });
      setWizardStep(2);
      return;
    }
    if (!isTakeover && !returnPick) {
      wizardFouten.zet({ tegenprestatie: 'Kies eerst wat je van je collega overneemt.' });
      return;
    }
    // Dubbele bodem naast de servercheck: nooit een overname indienen op een
    // collega die die dag niet vrij/bv/tk/ta staat.
    if (isTakeover && !takeoverCodeFor(selectedTargetDriver)) {
      wizardFouten.zet({ tegenprestatie: 'Deze collega kan je dienst die dag niet overnemen. Kies Ruilen (1-op-1).' });
      return;
    }
    wizardFouten.wis();

    const sep = returnPick.indexOf('|');
    const returnDate = returnPick.slice(0, sep);
    const returnCode = returnPick.slice(sep + 1);

    const newSwap: SwapRequest = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      shiftId: selectedShift,
      requesterId: user.id,
      targetDriverId: selectedTargetDriver,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reason,
      swapType,
      // Bij een overname is er bewust geen tegenprestatie.
      ...(isTakeover ? {} : { returnDate, returnCode }),
    };

    // Pas sluiten/wissen ná een geslaagde save — bij een fout blijft de
    // ingevulde aanvraag staan zodat de chauffeur niet opnieuw moet beginnen.
    setIsSubmitting(true);
    const ok = await Promise.resolve(onSave([...swaps, newSwap])).finally(() => setIsSubmitting(false));
    if (ok === false) return;
    setShowOfferModal(false);
    setSelectedShift('');
    setSelectedTargetDriver('');
    setReason('');
    setReturnPick('');
    setSwapType('ruil');
  };

  const handleStatusUpdate = (swapId: string, newStatus: SwapRequest['status'], seenStatus?: string, toastTekst?: string) => {
    // Delta-pad (PATCH per record, met conflictdetectie): twee mensen die
    // tegelijk beoordelen overschrijven elkaar niet meer — de tweede krijgt
    // een nette melding en een verse lijst. seenStatus = wat de beslisser
    // zág (paneel-snapshot of het moment waarop de bevestiging opende);
    // zonder die referentie vergeleek de server met de al ververste live
    // status en was de conflictcheck deels uitgeschakeld.
    if (onDecide) {
      const toastFor: Partial<Record<SwapRequest['status'], string>> = {
        approved: 'Dienstruil goedgekeurd.',
        // Planner wijst af; de collega die weigert geeft zijn eigen tekst mee
        // (handleDecline), zie de woordkeuze in shared/status.ts.
        rejected: 'Dienstruil afgewezen.',
        accepted: 'Geaccepteerd, de planner beoordeelt de ruil nu.',
        cancelled: 'Aanvraag ingetrokken.',
        completed: 'Afgehandeld, de wissel staat nu onder Afgehandeld.',
      };
      setBeslisBezig(swapId);
      return onDecide(swapId, newStatus, seenStatus ?? swaps.find((s) => s.id === swapId)?.status)
        .then((ok) => {
          const tekst = toastTekst ?? toastFor[newStatus];
          if (ok && tekst) notify(tekst, 'success');
          return ok;
        })
        .finally(() => setBeslisBezig((h) => (h === swapId ? null : h)));
    }
    // 'accepted' is een tussenstap (collega akkoord) — nog géén beslismoment;
    // decidedAt zetten we pas bij een definitieve beslissing.
    const isFinal = newStatus !== 'pending' && newStatus !== 'accepted';
    const decidedAt = isFinal ? new Date().toISOString() : undefined;
    const updatedSwaps = swaps.map(s =>
      s.id === swapId
        ? { ...s, status: newStatus, ...(decidedAt ? { decidedAt } : {}) }
        : s
    );
    onSave(updatedSwaps);
  };

  // Admin-override: een ruil die nog op de collega wacht ('pending') tóch
  // rechtstreeks goedkeuren, zónder bevestiging van de collega. Alleen admin
  // (de server dwingt dit ook af). Bewust met waarschuwing.
  const handleAdminForceApprove = (swapId: string) => {
    const seen = swaps.find((s) => s.id === swapId)?.status;
    setConfirmAction({
      title: 'Direct goedkeuren',
      message: 'De collega heeft deze ruil nog niet bevestigd. Wil je hem als admin tóch rechtstreeks goedkeuren?',
      confirmText: 'Toch goedkeuren',
      variant: 'warning',
      run: () => handleStatusUpdate(swapId, 'approved', seen),
    });
  };

  // Collega-acties op een aan hem/haar gerichte, openstaande ruil.
  const handleAccept = (swapId: string) => {
    const swap = swaps.find((s) => s.id === swapId);
    const seen = swap?.status;
    setConfirmAction({
      title: swap && isTakeoverSwap(swap) ? 'Dienst overnemen' : 'Dienstruil accepteren',
      message: swap && isTakeoverSwap(swap)
        ? 'Je neemt deze dienst over zonder er iets voor terug te krijgen. Akkoord? De planner beoordeelt ze daarna nog (rij- en rusttijden).'
        : 'Deze dienstruil accepteren? De planner beoordeelt ze daarna nog (rij- en rusttijden).',
      confirmText: 'Accepteren',
      variant: 'warning',
      run: () => handleStatusUpdate(swapId, 'accepted', seen),
    });
  };
  const handleDecline = (swapId: string) => {
    const seen = swaps.find((s) => s.id === swapId)?.status;
    setConfirmAction({
      title: 'Dienstruil weigeren',
      message: 'Deze dienstruil weigeren? Je collega ziet dat je niet kan.',
      confirmText: 'Weigeren',
      variant: 'danger',
      run: () => handleStatusUpdate(swapId, 'rejected', seen, 'Dienstruil geweigerd.'),
    });
  };

  const handleCancel = (swapId: string) => {
    const seen = swaps.find((s) => s.id === swapId)?.status;
    setConfirmAction({
      title: 'Dienstruil annuleren',
      message: 'Deze goedgekeurde dienstruil annuleren? De oorspronkelijke planning geldt dan weer.',
      confirmText: 'Annuleren',
      variant: 'danger',
      run: () => handleStatusUpdate(swapId, 'cancelled', seen),
    });
  };

  /** Afhandelen (Jarno 17-09): een goedgekeurde wissel verhuist naar
   *  Afgehandeld, zodat de beheerlijst alleen toont wat nog een beslissing
   *  vraagt. De wissel zelf blijft doorgevoerd (status 'completed' telt mee in
   *  de planning-overlay en de import-replay), maar terugdraaien kan daarna
   *  niet meer: 'completed' is een eindstatus. Vandaar de bevestiging. */
  const handleAfhandelen = (swapId: string) => {
    const seen = swaps.find((s) => s.id === swapId)?.status;
    setConfirmAction({
      title: 'Dienstruil afhandelen',
      message: 'De wissel blijft doorgevoerd in de planning en verhuist naar Afgehandeld. Daarna kan je hem niet meer annuleren of terugdraaien.',
      confirmText: 'Afhandelen',
      variant: 'warning',
      run: () => handleStatusUpdate(swapId, 'completed', seen),
    });
  };

  /** Inhoud van één ruil (status, dienst, verloop, rust, toelichting): het
   *  beoordelingspaneel van de staf en de alleen-lezen kaart van een chauffeur. */
  const ruilDetail = (swap: SwapRequest) => {
    const info = shiftInfoFor(swap);
    return (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <RuilStatusBadge swap={swap} stil />
                <Badge tone="oker" className="tabular-nums">Dienst {info.line}</Badge>

                {info.date && (
                  <Badge tone="slate" className="tabular-nums">{formatDateHuman(info.date)}{info.startTime && info.endTime ? ` · ${tijdvak(info.startTime, info.endTime)}` : ''}</Badge>
                )}
                {isTakeoverSwap(swap) && <TakeoverBadge compact />}
              </div>

              {/* Wie ruilt met wie, wat elk krijgt en wie al antwoordde: het
                  verloop per persoon vervangt de oude "A → B"-kaart. */}
              <RuilVerloop swap={voorVerloop(swap)} naamVan={naamVan} kijkerId={user.id} />
              <RuilRust regels={swap.rust} naamVan={naamVan} kijkerId={user.id} requesterId={swap.requesterId} targetDriverId={swap.targetDriverId} className="mt-3" />

              {swap.reason && (
                <div>
                  <MicroLabel>Toelichting van de aanvrager</MicroLabel>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-soft border border-hairline-subtle px-4 py-3 text-body font-normal text-slate-700">
                    {swap.reason}
                  </p>
                </div>
              )}
            </div>
    );
  };

  return (
    <PageShell>
      <PageHeader
        title="Dienstruil"
        description="Ruil een dienst met een collega, die accepteert eerst, daarna keurt de planning goed."
        actions={(
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={() => {
              // Verse wizard bij elk openen — geen halve vorige aanvraag.
              setWizardStep(1);
              setSelectedShift('');
              setSelectedTargetDriver('');
              setReturnPick('');
              setSwapType('ruil');
              setReason('');
              setShowAllReturns(false);
              setShowAllShifts(false);
              wizardFouten.wis();
              setShowOfferModal(true);
            }}
          >
            Dienstruil aanvragen
          </Button>
        )}
      />

      {link.staat === 'onbekend' && <RecordOnbekend soort="dienstruil" onSluit={link.sluit} />}
      {eigenDoel && !doelInLijst && (
        // Een ruil die je mag zien maar die in geen van je lijsten (meer)
        // staat, bv. een afgehandelde ruil uit een oude melding: alleen lezen.
        <div data-record={eigenDoel.id} tabIndex={-1} className="focus-stil mb-6">
          <Card className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-card-title">Dienstruil</h2>
              <Button variant="secondary" size="sm" onClick={link.sluit}>Sluiten</Button>
            </div>
            {ruilDetail(eigenDoel)}
          </Card>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <MicroLabel className="ml-1">Mijn verzoeken</MicroLabel>
          {mySwaps.length > 0 ? (
            /* Compacte, uitklapbare rijen in een eigen scrollcontainer: deze
               lijst groeit onbegrensd mee met de historiek (wens Jarno). */
            <div className="max-h-[420px] overflow-y-auto overscroll-contain -mx-1 px-1">
              {/* Het rijrecept (RecordRij, 22-09): één lijstkaart met hairlines
                  in plaats van een stapel losse kaarten, de dag als titel
                  (daaraan herken je de ruil), de dienst eronder. */}
              <LijstKaart aria-label="Mijn verzoeken">
              {mySwaps.map(swap => {
                const info = shiftInfoFor(swap);
                const open = expandedSwapIds.includes(swap.id);
                return (
                  <RecordRij
                    key={swap.id}
                    titel={hoofdletter(formatDateHuman(info.date))}
                    titelAttrs={{ 'data-record': swap.id }}
                    meta={`Dienst ${info.line}`}
                    status={<RuilStatusBadge swap={swap} stil />}
                    richting="omlaag"
                    open={open}
                    onClick={() => toggleSwapExpanded(swap.id)}
                  >
                    <Uitklap open={open}>
                      <div className="px-4 pb-4 pt-0.5">
                        {info.startTime && info.endTime && (
                          <p className="text-xs font-mono font-medium text-slate-500 tabular-nums">{tijdvak(info.startTime, info.endTime)}</p>
                        )}
                        {isTakeoverSwap(swap) && <div className="mt-1.5"><TakeoverBadge /></div>}
                        {/* Wie staat waar: de collega en wat elk krijgt staan
                            in het verloop, dus geen losse "Aan:" en "In ruil:"
                            meer erboven. */}
                        <RuilVerloop swap={voorVerloop(swap)} naamVan={naamVan} kijkerId={user.id} className="mt-3" />
                        <RuilRust regels={swap.rust} naamVan={naamVan} kijkerId={user.id} requesterId={swap.requesterId} targetDriverId={swap.targetDriverId} className="mt-3" />
                        {/* Intrekken zolang de ruil nog niet door de planner is
                            goedgekeurd — verlof kon dit al, dienstruil dwong
                            een belletje naar de planner af. */}
                        {(swap.status === 'pending' || swap.status === 'accepted') && (
                          <Button
                            variant="secondary"
                            size="sm"
                            full
                            className="mt-3"
                            onClick={() => setConfirmAction({
                              title: 'Aanvraag intrekken',
                              message: 'Deze ruilaanvraag intrekken? Je collega en de planner zien hem dan niet meer.',
                              confirmText: 'Intrekken',
                              variant: 'warning',
                              run: () => handleStatusUpdate(swap.id, 'cancelled'),
                            })}
                          >
                            Aanvraag intrekken
                          </Button>
                        )}
                        {kanWissen(swap) && (
                          <Button variant="ghost" size="sm" full className="mt-2 text-red-700 hover:text-red-700 hover:bg-red-50" icon={<Trash2 size={14} />} onClick={() => vraagWissen(swap)}>
                            Uit geschiedenis wissen
                          </Button>
                        )}
                      </div>
                    </Uitklap>
                  </RecordRij>
                );
              })}
              </LijstKaart>
            </div>
          ) : availableSwaps.length > 0 ? (
            // Wacht er een ruil van een collega op antwoord, dan is dát de
            // inhoud van dit scherm: de lege staat duwde ze op een telefoon
            // onder de vouw (dichtheidsronde 22-09). Een lege sectie is dan één
            // stille regel, geen kaart.
            <p className="px-1 text-body-sm text-slate-500">Je hebt zelf geen ruil lopen.</p>
          ) : (
            <EmptyState
              compact
              illustratie={<LegeLijst />}
              title="Nog geen ruilverzoeken"
              message="Kies “Dienstruil aanvragen”, je collega en de planner keuren daarna goed."
            />
          )}
        </div>

        <div className="space-y-4">
          <MicroLabel className="ml-1">Openstaande dienstruilen</MicroLabel>
          {availableSwaps.length > 0 ? (
            availableSwaps.map(swap => {
              const info = shiftInfoFor(swap);
              const canRespond = canRespondToSwap(user, swap);
              // Staf ziet hier ELKE open ruil, ook die tussen twee collega's. Met
              // het volledige blok per kaart werd die kolom erg lang, terwijl
              // dezelfde ruilen eronder in de beheertabel staan: daar dus de
              // compacte regels, met de namen in de kaartkop. Wie zelf moet
              // antwoorden (of de chauffeur) houdt het volledige blok.
              const compactKaart = isPlanner && swap.targetDriverId !== user.id;
              const ontvanger = swap.targetDriverId ? naamVan(swap.targetDriverId) : undefined;
              // De aangezochte collega heeft deze onbeantwoorde aanvraag in
              // beeld: dat hoort de server één keer, en de aanvrager leest het
              // in het verloop. Weet de server het al, dan vuurt er niets.
              const nogTeMelden = canRespond && !swap.verloop?.some((st) => st.soort === 'bekeken');
              return (
                <RuilBekekenBaken key={swap.id} swapId={swap.id} actief={nogTeMelden}>
                {/* data-record + tabIndex: een link naar deze ruil (`/dienstruil/<id>`) brengt de kaart in beeld met de focus erop. */}
                <div data-record={swap.id} tabIndex={-1} className="focus-stil">
                <Card className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <MicroLabel className="tabular-nums">Dienst {info.line}</MicroLabel>
                      <p className="font-bold text-slate-800 mt-1">{hoofdletter(formatDateHuman(info.date))}</p>
                      {info.startTime && info.endTime && (
                        <p className="text-xs font-mono font-medium text-slate-500 tabular-nums">{tijdvak(info.startTime, info.endTime)}</p>
                      )}
                      {compactKaart && (
                        <p className="text-xs font-medium text-slate-500">
                          {naamVan(swap.requesterId) ?? 'Onbekend'}{ontvanger ? ` → ${ontvanger}` : ''}
                        </p>
                      )}
                      {isTakeoverSwap(swap) ? (
                        <div className="mt-1.5"><TakeoverBadge /></div>
                      ) : compactKaart && returnLabel(swap) && (
                        <p className="text-xs font-medium text-blue-700 mt-1">↔ in ruil: {returnLabel(swap)}</p>
                      )}
                    </div>
                    <span className="shrink-0">
                      {/* "Jouw antwoord" vraagt actie en blijft amber; de status is stil. */}
                      {canRespond ? <Badge tone="amber" dot>Jouw antwoord</Badge> : <RuilStatusBadge swap={swap} stil />}
                    </span>
                  </div>
                  {swap.reason && <p className="text-xs text-slate-500 italic">"{swap.reason}"</p>}
                  {/* Wie vraagt, wie geeft wat en wie nog moet antwoorden. */}
                  {compactKaart
                    ? <RuilVerloop compact swap={voorVerloop(swap)} naamVan={naamVan} className="space-y-0.5" />
                    : <RuilVerloop swap={voorVerloop(swap)} naamVan={naamVan} kijkerId={user.id} />}
                  {/* Ook in de compacte kaart: wie hier accepteert krijgt de dienst,
                      en moet vóór zijn antwoord weten of zijn rust in het gedrang komt. */}
                  <RuilRust regels={swap.rust} naamVan={naamVan} kijkerId={user.id} requesterId={swap.requesterId} targetDriverId={swap.targetDriverId} />
                  {canRespond ? (
                    <div className="flex gap-2 pt-1">
                      <Button variant="success" className="flex-1" icon={<Check size={16} />} onClick={() => handleAccept(swap.id)}>
                        Accepteren
                      </Button>
                      <Button variant="danger" className="flex-1" icon={<X size={16} />} onClick={() => handleDecline(swap.id)}>
                        Weigeren
                      </Button>
                    </div>
                  ) : swap.status === 'accepted' && swap.targetDriverId === user.id ? (
                    <p className="text-xs font-medium text-blue-700">Je accepteerde deze ruil, de planner valideert nog (rij-/rusttijden).</p>
                  ) : swap.status === 'approved' && swap.targetDriverId === user.id && !swap.targetSeenAt ? (
                    /* Doorgevoerd maar nog niet bevestigd: dé plek waar de
                       chauffeur laat weten dat hij de wijziging gezien heeft
                       (push bereikt bijna niemand — dit vinkje wel). */
                    <Button
                      variant="success"
                      full
                      icon={<Check size={16} />}
                      disabled={isConfirmingSeen === swap.id}
                      onClick={() => void bevestigGezien(swap.id)}
                    >
                      {isConfirmingSeen === swap.id ? 'Bevestigen…' : 'Begrepen, ik rijd deze dienst'}
                    </Button>
                  ) : null}
                </Card>
                </div>
                </RuilBekekenBaken>
              );
            })
          ) : (
            <EmptyState
              compact
              variant="klaar"
              illustratie={<AllesGedaan />}
              title="Geen openstaande dienstruilen"
              message="Stelt een collega jou een ruil voor, dan verschijnt die hier en krijg je een melding."
            />
          )}
        </div>
      </div>

      <ConfirmationModal
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.run()}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmText={confirmAction?.confirmText ?? 'Bevestigen'}
        variant={confirmAction?.variant ?? 'warning'}
      />

      {isPlanner && (() => {
        const beheerKop = (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MicroLabel className="ml-1">Beheer dienstruilen</MicroLabel>
            <div className="flex items-center gap-2">
              <DateInput size="sm" value={printDag} onChange={setPrintDag} aria-label="Dag uit de week van het ruiloverzicht" />
              <Button
                variant="secondary"
                size="sm"
                icon={<Printer size={14} />}
                onClick={() => drukWeekoverzichtAf(printDag)}
                title={`Uitgevoerde wissels van ${formatPeriodeDMJ(maandagVan(printDag), addDagen(maandagVan(printDag), 6))}`}
              >
                Ruiloverzicht week {isoWeekOf(maandagVan(printDag))}
              </Button>
            </div>
          </div>
        );
        const actionableSwaps = swaps.filter(s => {
          if (s.status !== 'pending' && s.status !== 'accepted' && s.status !== 'approved') return false;
          const requester = users.find(u => u.id === s.requesterId);
          const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
          const isMe = s.requesterId === user.id;
          if (isBeheerder && !isMe) return false;
          return true;
        });

        // Eén gedeelde lege staat i.p.v. drie verschillende leegtes op één
        // pagina: de desktoptabel liet enkel een kaal kopje achter en de
        // mobiele kaart een cursief grijs zinnetje, terwijl de twee lijsten
        // hierboven wél het EmptyState-patroon gebruiken.
        if (actionableSwaps.length === 0) {
          return (
            <div className="space-y-4 pt-8">
              {beheerKop}
              <EmptyState
                variant="klaar"
                illustratie={<AllesGedaan />}
                title="Geen dienstruilen om te beoordelen"
                message="Zodra een chauffeur een ruil aanvraagt en de collega akkoord gaat, verschijnt die hier. Afgehandelde wissels staan onderaan."
              />
            </div>
          );
        }

        return (
          <div className="space-y-4 pt-8">
            {beheerKop}
            <TableShell>
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-left">
                  <thead className="bg-surface-soft border-b border-hairline-subtle">
                    <tr>
                      <Th>Chauffeur</Th>
                      <Th>Dienst</Th>
                      <Th>Status</Th>
                      <Th>Acties</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline-subtle">
                    {actionableSwaps.map(swap => {
                      const info = shiftInfoFor(swap);
                      const requester = users.find(u => u.id === swap.requesterId);
                      return (
                        <tr key={swap.id} className="hover:bg-surface-soft-hover transition-colors">
                          <Td>
                            {/* rauw: tabelrij-knop met naam + doelcollega + chevron (opent het beoordelingspaneel) */}
                            <button
                              type="button"
                              onClick={() => setReviewSwap(swap)}
                              title="Details bekijken"
                              className="group inline-flex items-center gap-1.5 text-left"
                            >
                              <Avatar naam={requester?.name ?? 'Onbekend'} size="md" className="mr-1" />
                              <span className="min-w-0">
                                <span className="block font-semibold text-slate-800">{requester?.name}</span>
                                {swap.targetDriverId && (
                                  <span className="block text-xs font-medium text-slate-500">→ {users.find(u => u.id === swap.targetDriverId)?.name || 'onbekend'}</span>
                                )}
                              </span>
                              <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
                            </button>
                          </Td>
                          <Td>
                            <span className="font-semibold text-oker-700 tabular-nums">Dienst {info.line}</span>
                            <span className="text-slate-500 tabular-nums">, {formatDateHuman(info.date)}{info.startTime && info.endTime ? ` (${tijdvak(info.startTime, info.endTime)})` : ''}</span>
                            {isTakeoverSwap(swap) ? (
                              <span className="mt-1 block"><TakeoverBadge compact /></span>
                            ) : returnLabel(swap) && (
                              <span className="block text-xs font-medium text-blue-700 mt-0.5">↔ in ruil: {returnLabel(swap)}</span>
                            )}
                          </Td>
                          <Td>
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              <RuilStatusBadge swap={swap} stil />
                              {/* Weet de nieuwe rijder het al? Bij approved is
                                  dát de vraag die telt (push bereikt weinigen). */}
                              {swap.status === 'approved' && swap.targetDriverId && (
                                swap.targetSeenAt
                                  ? <Badge tone="emerald" stil icon={<Check size={12} />} title={`Bevestigd op ${formatDateHuman(swap.targetSeenAt.slice(0, 10))}`}>Gezien</Badge>
                                  : <Badge tone="slate" title="De chauffeur bevestigde de wissel nog niet in de app">Niet bevestigd</Badge>
                              )}
                            </span>
                            <RuilVerloop compact swap={voorVerloop(swap)} naamVan={naamVan} className="mt-1.5 space-y-0.5" />
                          </Td>
                          <Td>
                            <div className="flex items-center gap-1.5">
                              <Button variant="ghost" size="sm" icon={<History size={16} />} aria-label="Wijzigingsgeschiedenis" title="Wijzigingsgeschiedenis" onClick={() => setHistorySwap(swap)} />
                              {swap.status === 'accepted' && (
                                <>
                                  <Button bezig={beslisBezig === swap.id} variant="ghost" size="sm" icon={<Check size={16} />} className="text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50" aria-label="Goedkeuren" title="Goedkeuren (rij-/rusttijden ok)" onClick={() => handleStatusUpdate(swap.id, 'approved')} />
                                  <Button bezig={beslisBezig === swap.id} variant="ghost" size="sm" icon={<X size={16} />} className="text-red-700 hover:text-red-700 hover:bg-red-50" aria-label="Afwijzen" title="Afwijzen" onClick={() => handleStatusUpdate(swap.id, 'rejected')} />
                                </>
                              )}
                              {swap.status === 'pending' && (isAdmin ? (
                                <>
                                  <Button variant="ghost" size="sm" icon={<Check size={16} />} className="text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50" aria-label="Direct goedkeuren" title="Direct goedkeuren, collega heeft nog niet bevestigd" onClick={() => handleAdminForceApprove(swap.id)} />
                                  <Button bezig={beslisBezig === swap.id} variant="ghost" size="sm" icon={<X size={16} />} className="text-red-700 hover:text-red-700 hover:bg-red-50" aria-label="Afwijzen" title="Afwijzen" onClick={() => handleStatusUpdate(swap.id, 'rejected')} />
                                </>
                              ) : (
                                <>
                                  <Badge tone="amber" stil className="whitespace-nowrap">Wacht op collega</Badge>
                                  <Button bezig={beslisBezig === swap.id} variant="ghost" size="sm" icon={<X size={16} />} className="text-red-700 hover:text-red-700 hover:bg-red-50" aria-label="Afwijzen" title="Afwijzen" onClick={() => handleStatusUpdate(swap.id, 'rejected')} />
                                </>
                              ))}
                              {swap.status === 'approved' && (
                                <>
                                  <Button variant="secondary" size="sm" icon={<Archive size={14} />} title="Naar Afgehandeld, de wissel blijft doorgevoerd" onClick={() => handleAfhandelen(swap.id)}>Afhandelen</Button>
                                  <Button variant="danger" size="sm" onClick={() => handleCancel(swap.id)}>Annuleren</Button>
                                </>
                              )}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-hairline-subtle">
                {actionableSwaps.map(swap => {
                  const info = shiftInfoFor(swap);
                  const requester = users.find(u => u.id === swap.requesterId);
                  return (
                    <div key={swap.id} className="p-5 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {/* rauw: rij-knop met naam + doelcollega + chevron (opent het beoordelingspaneel) */}
                          <button
                            type="button"
                            onClick={() => setReviewSwap(swap)}
                            title="Details bekijken"
                            className="group flex items-center gap-1.5 text-left"
                          >
                            <Avatar naam={requester?.name ?? 'Onbekend'} size="sm" className="mr-0.5" />
                            <span className="font-bold text-slate-800">
                              {requester?.name}
                              {swap.targetDriverId && <span className="font-medium text-slate-500"> → {users.find(u => u.id === swap.targetDriverId)?.name || 'onbekend'}</span>}
                            </span>
                            <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
                          </button>
                          <MicroLabel className="!text-oker-700 mt-1 tabular-nums">Dienst {info.line}</MicroLabel>
                          <p className="text-xs font-medium text-slate-500 mt-1 tabular-nums">{formatDateHuman(info.date)}{info.startTime && info.endTime ? ` · ${tijdvak(info.startTime, info.endTime)}` : ''}</p>
                          {isTakeoverSwap(swap) && <div className="mt-1"><TakeoverBadge compact /></div>}
                        </div>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <RuilStatusBadge swap={swap} stil />
                          {swap.status === 'approved' && swap.targetDriverId && (
                            swap.targetSeenAt
                              ? <Badge tone="emerald" stil icon={<Check size={12} />}>Gezien</Badge>
                              : <Badge tone="slate">Niet bevestigd</Badge>
                          )}
                        </span>
                      </div>
                      <RuilVerloop swap={voorVerloop(swap)} naamVan={naamVan} kijkerId={user.id} />
                      <RuilRust regels={swap.rust} naamVan={naamVan} kijkerId={user.id} requesterId={swap.requesterId} targetDriverId={swap.targetDriverId} className="mt-3" />
                      <div className="flex gap-2 pt-1">
                        {swap.status === 'accepted' && (
                          <>
                            <Button bezig={beslisBezig === swap.id} variant="success" className="flex-1" icon={<Check size={16} />} onClick={() => handleStatusUpdate(swap.id, 'approved')}>
                              Goedkeuren
                            </Button>
                            <Button bezig={beslisBezig === swap.id} variant="danger" className="flex-1" icon={<X size={16} />} onClick={() => handleStatusUpdate(swap.id, 'rejected')}>
                              Afwijzen
                            </Button>
                          </>
                        )}
                        {swap.status === 'pending' && (isAdmin ? (
                          <>
                            <Button variant="success" className="flex-1" icon={<Check size={16} />} onClick={() => handleAdminForceApprove(swap.id)}>
                              Goedkeuren
                            </Button>
                            <Button bezig={beslisBezig === swap.id} variant="danger" className="flex-1" icon={<X size={16} />} onClick={() => handleStatusUpdate(swap.id, 'rejected')}>
                              Afwijzen
                            </Button>
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-between gap-2">
                            <Badge tone="amber" stil>Wacht op collega</Badge>
                            <Button bezig={beslisBezig === swap.id} variant="danger" size="sm" onClick={() => handleStatusUpdate(swap.id, 'rejected')}>
                              Afwijzen
                            </Button>
                          </div>
                        ))}
                        {swap.status === 'approved' && (
                          <>
                            <Button variant="secondary" className="flex-1" icon={<Archive size={16} />} onClick={() => handleAfhandelen(swap.id)}>
                              Afhandelen
                            </Button>
                            <Button variant="danger" className="flex-1" onClick={() => handleCancel(swap.id)}>
                              Annuleren
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </TableShell>
          </div>
        );
      })()}

      {/* Afgehandeld (alleen staf): afgewezen en ingetrokken wissels van
          iedereen, met een wisknop om testwissels op te ruimen (Jarno 09-09),
          plus de wissels die via "Afhandelen" zijn weggezet (Jarno 17-09).
          Doorgevoerde wissels staan er zonder wisknop: die zitten in de
          heropbouw-replay. Compact en gecapt op 30, nieuwste eerst; de tabel
          hierboven blijft de plek voor wat nog actie vraagt. */}
      {isStaf(user.role) && (() => {
        const alleAfgehandeld = swaps
          .filter((s) => s.status === 'rejected' || s.status === 'cancelled' || s.status === 'completed')
          .sort((a, b) => String(b.decidedAt ?? b.createdAt ?? '').localeCompare(String(a.decidedAt ?? a.createdAt ?? '')));
        const afgehandeld = alleAfgehandeld.slice(0, 30);
        if (afgehandeld.length === 0) return null;
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <MicroLabel className="ml-1">Afgehandeld</MicroLabel>
              {alleAfgehandeld.length > afgehandeld.length && (
                <span className="text-xs font-medium text-slate-500">nieuwste {afgehandeld.length} van {alleAfgehandeld.length}</span>
              )}
            </div>
            <Card padding="none" className="divide-y divide-hairline-subtle">
              {afgehandeld.map((swap) => {
                const info = shiftInfoFor(swap);
                const requester = users.find((u) => u.id === swap.requesterId);
                // Eigen sleutel: dezelfde wissel kan ook bij "Mijn verzoeken" staan.
                const sleutel = `afgehandeld:${swap.id}`;
                const open = expandedSwapIds.includes(sleutel);
                return (
                  <div key={swap.id}>
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5">
                    {/* rauw: de rij is de uitklapknop (namen + dienst + status + chevron); de badge zegt geweigerd (collega) of afgewezen (planner), het verloop door wie */}
                    <button
                      type="button"
                      onClick={() => toggleSwapExpanded(sleutel)}
                      aria-expanded={open}
                      className="min-w-0 flex flex-1 items-center justify-between gap-3 text-left"
                    >
                      <span className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-slate-800 truncate">
                          {requester?.name ?? 'Onbekend'}
                          {swap.targetDriverId && <span className="font-medium text-slate-500"> → {users.find((u) => u.id === swap.targetDriverId)?.name || 'onbekend'}</span>}
                        </span>
                        <span className="text-xs font-medium text-slate-500 whitespace-nowrap">
                          Dienst {info.line}{info.date ? ` · ${formatDateHuman(info.date)}` : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <RuilStatusBadge swap={swap} stil />
                        <ChevronDown size={16} className={uitklapChevron(open, 180, 'text-slate-400')} />
                      </span>
                    </button>
                    <div className="flex items-center shrink-0">
                      {kanWissen(swap) ? (
                        <IconButton label="Uit geschiedenis wissen" size="sm" variant="ghost" className="text-red-700 hover:text-red-700 hover:bg-red-50" onClick={() => vraagWissen(swap)}>
                          <Trash2 size={16} />
                        </IconButton>
                      ) : (
                        <IconButton label="Doorgevoerde wissel: annuleren i.p.v. wissen" size="sm" variant="ghost" disabled>
                          <Trash2 size={16} />
                        </IconButton>
                      )}
                    </div>
                  </div>
                  <Uitklap open={open}>
                    <div className="px-4 pb-3">
                      {isTakeoverSwap(swap) && <div className="mb-2"><TakeoverBadge compact /></div>}
                      {/* Begrensd: op een breed scherm staat de status anders een halve meter van de naam. */}
                      <RuilVerloop swap={voorVerloop(swap)} naamVan={naamVan} kijkerId={user.id} className="max-w-xl" />
                      <RuilRust regels={swap.rust} naamVan={naamVan} kijkerId={user.id} requesterId={swap.requesterId} targetDriverId={swap.targetDriverId} className="mt-3" />
                    </div>
                  </Uitklap>
                  </div>
                );
              })}
            </Card>
          </div>
        );
      })()}

      {/* Gedeelde Modal i.p.v. eigen portal: ESC, backdrop-tap, safe-area en
          dvh-begrenzing komen daar vandaan (verbeterronde 29/07 #3). */}
      <Modal open={showOfferModal} onClose={() => setShowOfferModal(false)} vuil={wizardVuil} maxWidth="md" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
              {/* 44x44 op de terugknop (het kruisje van ModalHeader is dat op
                  touch ook): dit zijn de enige twee uitwegen uit een
                  driestapswizard op een telefoon. Ze stonden op 36 resp. 38px
                  — onder de norm, en buiten het bereik van
                  scripts/mobile-audit.mjs, dat nooit een modal opent. */}
              <ModalHeader
                leading={wizardStep > 1 ? (
                  <IconButton label="Vorige stap" variant="secondary" size="md" onClick={() => setWizardStep((s) => (s === 3 ? 2 : 1))}>
                    <ChevronRight size={18} className="rotate-180" />
                  </IconButton>
                ) : undefined}
                eyebrow={`Stap ${wizardStep} van 3`}
                title={wizardStep === 1 ? 'Welke dienst wil je ruilen?' : wizardStep === 2 ? 'Met welke collega?' : 'Hoe wil je ruilen?'}
                onClose={() => setShowOfferModal(false)}
              />
              <Formulier ref={wizardScrollRef} onVerstuur={handleOfferShift} noValidate className="p-6 md:p-7 space-y-4 overflow-y-auto flex-1">
                {/* ── Stap 1: kies je eigen (komende) dienst ── */}
                {wizardStep === 1 && (
                  myShifts.length === 0 ? (
                    <Card tone="warning" padding="none" className="px-4 py-3 text-sm font-medium text-amber-800">
                      Je hebt geen komende diensten om te ruilen. {isPlanner ? 'Via Systeemstatus kan je een fictieve testdienst aanmaken om de flow te proberen.' : 'Vraag de planning om hulp.'}
                    </Card>
                  ) : (
                    <div className="space-y-2" data-fout={wizardFouten.fouten.dienst ? '' : undefined}>
                      {wizardFouten.fouten.dienst && <p role="alert" className="text-xs font-medium text-red-700">{wizardFouten.fouten.dienst}</p>}
                      {(showAllShifts ? myShifts : myShifts.slice(0, 8)).map((s) => {
                        const bezet = heeftLopendeRuil(s);
                        return (
                        /* rauw: wizard-keuzekaart (datum + dienst + chevron), eigen layout via cnCard */
                        <button
                          key={s.id}
                          type="button"
                          disabled={bezet}
                          onClick={() => { setSelectedShift(s.id); setSelectedTargetDriver(''); setReturnPick(''); wizardFouten.wis(); setWizardStep(2); }}
                          className={`${cnCard(selectedShift === s.id)} disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-slate-800">{hoofdletter(formatDateHuman(s.date))}</span>
                            <span className="block text-xs font-medium text-slate-500 tabular-nums">Dienst {serviceNumberOf(s)} · {tijdvak(s.startTime, s.endTime)}{s.delen > 1 ? ` · in ${s.delen} delen` : ''}</span>
                          </span>
                          {bezet ? (
                            <Badge tone="blue" stil className="shrink-0 whitespace-nowrap">Ruil loopt al</Badge>
                          ) : (
                            <ChevronRight size={16} className="shrink-0 text-slate-300" />
                          )}
                        </button>
                        );
                      })}
                      {!showAllShifts && myShifts.length > 8 && (
                        <Button variant="ghost" size="sm" full onClick={() => setShowAllShifts(true)}>
                          Meer tonen ({myShifts.length - 8} extra)
                        </Button>
                      )}
                    </div>
                  )
                )}

                {/* ── Stap 2: kies de collega (vrije eerst) ── */}
                {wizardStep === 2 && (
                  <>
                    <p className="text-xs font-medium text-slate-500">
                      Jouw dienst: <span className="font-bold text-slate-800">Dienst {serviceNumberOf(shifts.find((s) => s.id === selectedShift))}</span>
                      {selectedShiftDate && <span> · {formatDateHuman(selectedShiftDate)}</span>}
                    </p>
                    {matchLoading ? (
                      <p className="text-sm font-medium text-slate-500 py-6 text-center">Beschikbaarheid laden…</p>
                    ) : (
                      <>
                        <div className="space-y-2" data-fout={wizardFouten.fouten.collega ? '' : undefined}>
                          {wizardFouten.fouten.collega && <p role="alert" className="text-xs font-medium text-red-700">{wizardFouten.fouten.collega}</p>}
                          {eligibleTargetDrivers
                            .map((u) => {
                              const free = freeForDate?.has(u.id);
                              // Planningcode ('bv', 'tk', 'ta') leest preciezer dan
                              // "vrij" — en zegt meteen of een overname kan.
                              const code = takeoverCodeFor(u.id);
                              // Bezette collega: toon zijn dienst — bij een 1-op-1
                              // ruil op dezelfde dag is dát de collega die je zoekt.
                              const rijdt = linesForDate[u.id];
                              // Eén korte contextcode onder de naam (Jarno 23-09): BV/TK/TA,
                              // Vrij, of het dienstnummer; geen badge of kleur, de naam
                              // is waaraan je kiest.
                              const context = !freeForDate ? null
                                : code && code !== 'vrij' ? code.toUpperCase()
                                  : free || code ? 'Vrij'
                                    : rijdt ? `Dienst ${rijdt}` : 'Bezet';
                              return (
                                /* rauw: wizard-keuzekaart (naam + korte contextcode + chevron), eigen layout via cnCard */
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedTargetDriver(u.id);
                                    setReturnPick('');
                                    wizardFouten.wis();
                                    setShowAllReturns(false);
                                    // Terug naar de standaardvorm als deze collega
                                    // geen overname toelaat.
                                    if (!takeoverCodeFor(u.id)) setSwapType('ruil');
                                    setWizardStep(3);
                                  }}
                                  className={cnCard(selectedTargetDriver === u.id)}
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-md font-semibold text-slate-900">{u.name}</span>
                                    {context && <span className="mt-0.5 block text-xs font-medium text-slate-500">{context}</span>}
                                  </span>
                                  <ChevronRight size={16} className="shrink-0 text-slate-300" aria-hidden="true" />
                                </button>
                              );
                            })}
                        </div>
                        {freeForDate && freeCount === 0 && (
                          <p className="text-xs font-medium text-slate-500 text-center">Niemand is vrij op {formatDateHuman(selectedShiftDate)}, je kan wel met een collega die rijdt 1-op-1 ruilen.</p>
                        )}
                        <p className="text-xs font-medium text-slate-500">"Vrij" = geen dienst en geen verlof op {selectedShiftDate ? formatDateHuman(selectedShiftDate) : 'die dag'}. Bij vrij/bv/tk/ta kan je de dienst ook zonder tegenprestatie doorgeven; met een collega die die dag rijdt, ruil je 1-op-1.</p>
                      </>
                    )}
                  </>
                )}

                {/* ── Stap 3: tegenprestatie + samenvatting + indienen ── */}
                {wizardStep === 3 && (() => {
                  const target = users.find((u) => u.id === selectedTargetDriver);
                  const offered = shifts.find((s) => s.id === selectedShift);
                  // Conflict-check op dienst-niveau: alle delen van de aangeboden
                  // dienst tellen niet mee (die geeft de aanvrager net weg), een
                  // ándere eigen dienst op die dag wel. Zo kan een 1-op-1 ruil op
                  // dezelfde dag ook met een gesplitste dienst. Ook eigen
                  // goedgekeurd verlof blokkeert een tegenprestatie.
                  const ownConflictOn = (date: string): string | undefined => {
                    const andereDienst = eigenDienstOp(shifts, user.id, date, offered);
                    if (andereDienst) return `dienst ${andereDienst}`;
                    const ownLeave = leaveRequests.find(
                      (l) => l.userId === user.id && l.status === 'approved' && l.startDate <= date && date <= l.endDate,
                    );
                    if (ownLeave) return 'verlof';
                    return undefined;
                  };
                  const enriched = (returnOptions ?? []).map((o) => ({
                    ...o,
                    ownDuty: ownConflictOn(o.date),
                  }));
                  const pickable = enriched.filter((o) => !o.ownDuty);
                  const conflicted = enriched.filter((o) => !!o.ownDuty);
                  const visiblePickable = showAllReturns ? pickable : pickable.slice(0, 8);
                  const pick = returnPick ? { date: returnPick.slice(0, returnPick.indexOf('|')), code: returnPick.slice(returnPick.indexOf('|') + 1) } : null;
                  const voornaam = target?.name?.split(' ')[0] ?? 'de collega';
                  // Overname kan alleen als de collega die dag vrij/bv/tk/ta
                  // staat — de server weigert het anders alsnog.
                  const takeoverCode = takeoverCodeFor(selectedTargetDriver);
                  const isTakeover = swapType === 'overname';
                  return (
                    <>
                      <p className="text-xs font-medium text-slate-500">
                        Jij geeft <span className="font-bold text-slate-800">dienst {serviceNumberOf(offered)}</span>
                        {selectedShiftDate && <span> ({fmtShort(selectedShiftDate)})</span>} aan <span className="font-bold text-slate-800">{target?.name ?? '—'}</span>.
                      </p>

                      {/* Vorm van de aanvraag: 1-op-1 of zonder tegenprestatie.
                          Bij een fout springt de focus naar deze keuze. */}
                      <div className="space-y-2" data-fout={wizardFouten.fouten.tegenprestatie ? '' : undefined}>
                        {/* rauw: keuzekaart ruilvorm (icoon + titel + uitleg + radio-vinkje), eigen layout via cnCard */}
                        <button
                          type="button"
                          onClick={() => { setSwapType('ruil'); wizardFouten.wisVeld('tegenprestatie'); }}
                          className={cnCard(!isTakeover)}
                        >
                          <span className="min-w-0 flex items-start gap-2.5">
                            <ArrowLeftRight size={16} className="mt-0.5 shrink-0 text-slate-500" />
                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-slate-800">Ruilen (1-op-1)</span>
                              <span className="block text-xs font-medium text-slate-500">Jij neemt een dienst of vrije dag van {voornaam} over</span>
                            </span>
                          </span>
                          {!isTakeover ? <Check size={16} className="shrink-0 text-slate-900" /> : <span className="shrink-0 h-4 w-4 rounded-full border border-hairline-strong" />}
                        </button>
                        {/* rauw: keuzekaart ruilvorm (icoon + titel + uitleg + radio-vinkje), eigen layout via cnCard */}
                        <button
                          type="button"
                          disabled={!takeoverCode}
                          onClick={() => { setSwapType('overname'); setReturnPick(''); wizardFouten.wisVeld('tegenprestatie'); }}
                          className={`${cnCard(isTakeover)} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-row-hover`}
                        >
                          <span className="min-w-0 flex items-start gap-2.5">
                            <Handshake size={16} className="mt-0.5 shrink-0 text-blue-500" />
                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-slate-800">Zonder tegenprestatie</span>
                              <span className="block text-xs font-medium text-slate-500">
                                {takeoverCode
                                  ? <>{voornaam} neemt je dienst over ({takeoverCode} die dag), jij geeft niets terug.</>
                                  : <>Kan niet: {voornaam} staat op {selectedShiftDate ? formatDateHuman(selectedShiftDate) : 'die dag'} niet op vrij/bv/tk/ta</>}
                              </span>
                            </span>
                          </span>
                          {isTakeover ? <Check size={16} className="shrink-0 text-slate-900" /> : <span className="shrink-0 h-4 w-4 rounded-full border border-hairline-strong" />}
                        </button>
                      </div>

                      {!isTakeover && (
                        <p className="text-xs font-medium text-slate-500 pt-1">Wat neem je van {voornaam} over?</p>
                      )}
                      {isTakeover ? null : returnLoading ? (
                        <p className="text-sm font-medium text-slate-500 py-6 text-center">Diensten laden…</p>
                      ) : pickable.length === 0 && conflicted.length === 0 ? (
                        <p className="text-sm text-slate-500 py-4 text-center">Geen diensten of vrije dagen van {target?.name ?? 'deze collega'} gevonden in de komende 8 weken.</p>
                      ) : (
                        <>
                          <div className="space-y-2">
                            {visiblePickable.map((o) => {
                              const val = `${o.date}|${o.code}`;
                              const selected = returnPick === val;
                              return (
                                /* rauw: wizard-keuzekaart (datum + dienst/vrij + radio-vinkje), eigen layout via cnCard */
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => { setReturnPick(selected ? '' : val); wizardFouten.wisVeld('tegenprestatie'); }}
                                  className={cnCard(selected)}
                                >
                                  <span className="min-w-0">
                                    <span className="block text-sm font-bold text-slate-800">{hoofdletter(formatDateHuman(o.date))}</span>
                                    <span className="block text-xs font-medium text-slate-500">{o.isFree ? 'Vrije dag van de collega' : `Dienst ${o.code}`}</span>
                                  </span>
                                  {selected ? <Check size={16} className="shrink-0 text-slate-900" /> : <span className="shrink-0 h-4 w-4 rounded-full border border-hairline-strong" />}
                                </button>
                              );
                            })}
                          </div>
                          {!showAllReturns && (pickable.length > 8 || conflicted.length > 0) && (
                            <Button variant="ghost" size="sm" full onClick={() => setShowAllReturns(true)}>
                              Meer tonen{pickable.length > 8 ? ` (${pickable.length - 8} extra)` : ''}
                            </Button>
                          )}
                          {showAllReturns && conflicted.length > 0 && (
                            <div className="space-y-2">
                              <MicroLabel>Niet mogelijk, jij bent die dag al ingepland</MicroLabel>
                              {conflicted.map((o) => (
                                <Card key={`${o.date}|${o.code}`} tone="muted" padding="none" className="flex items-center justify-between gap-3 px-4 py-3 opacity-60">
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-slate-500">{hoofdletter(formatDateHuman(o.date))}</span>
                                    <span className="block text-xs font-medium text-slate-500">{o.isFree ? "Vrije dag van de collega" : `Dienst ${o.code}`}, {o.ownDuty === "verlof" ? "jij hebt die dag verlof" : `jij rijdt al ${o.ownDuty}`}</span>
                                  </span>
                                </Card>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      <Field label="Info voor je collega (optioneel)" className="pt-1">
                        {({ id }) => (
                          /* onFocus: houd het veld boven het iOS-toetsenbord —
                             zonder scroll verdween de verstuurknop erachter. */
                          <Textarea
                            id={id}
                            rows={2}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)}
                            className="h-14"
                            placeholder="Waarom wil je ruilen?"
                          />
                        )}
                      </Field>
                      {isTakeover ? (
                        <Card tone="accent" padding="none" className="px-4 py-3 text-sm font-medium text-slate-800">
                          Jij geeft <strong>dienst {serviceNumberOf(offered)}</strong> ({selectedShiftDate ? fmtShort(selectedShiftDate) : '—'}) aan <strong>{target?.name}</strong>, <strong>zonder tegenprestatie</strong>.
                        </Card>
                      ) : pick && (
                        <Card tone="accent" padding="none" className="px-4 py-3 text-sm font-medium text-slate-800">
                          Jij geeft <strong>dienst {serviceNumberOf(offered)}</strong> ({selectedShiftDate ? fmtShort(selectedShiftDate) : '—'}) aan <strong>{target?.name}</strong>, jij neemt {pick.code.toLowerCase() === 'vrij' ? <>zijn <strong>vrije dag</strong></> : <>zijn <strong>dienst {pick.code}</strong></>} ({fmtShort(pick.date)}).
                        </Card>
                      )}
                      <div className="space-y-2">
                        <Button
                          type="submit"
                          variant="primary"
                          size="lg"
                          full
                          bezig={isSubmitting}
                          disabled={!selectedShift || !selectedTargetDriver || (isTakeover ? !takeoverCode : !returnPick)}
                        >
                          {isTakeover ? 'Vraag om over te nemen' : 'Ruilverzoek versturen'}
                        </Button>
                        {/* Reden waarom de knop nog uit staat, bij de knop —
                            niet als toast na een klik die niets doet. */}
                        {wizardFouten.fouten.tegenprestatie ? (
                          <p role="alert" className="text-center text-xs font-medium text-red-700">{wizardFouten.fouten.tegenprestatie}</p>
                        ) : !isTakeover && !returnPick && !returnLoading ? (
                          <p className="text-center text-xs text-slate-500">Kies eerst wat je van {voornaam} overneemt.</p>
                        ) : (
                          <p className="text-xs font-medium text-slate-500 text-center">{voornaam} moet eerst accepteren; daarna keurt de planner goed.</p>
                        )}
                      </div>
                    </>
                  );
                })()}
              </Formulier>
      </Modal>

      {/* Beoordeling in een side panel: volledige ruil-context + dezelfde
          beslis-acties als de tabelrij, zonder paginawissel. */}
      <SlideOver
        open={!!reviewSwap}
        onClose={() => setReviewSwap(null)}
        title={reviewSwap ? (users.find((u) => u.id === reviewSwap.requesterId)?.name ?? 'Onbekend') : 'Dienstruil'}
        subtitle={reviewSwap ? `Aangevraagd op ${formatDateHuman(reviewSwap.createdAt)}` : undefined}
        icon={reviewSwap ? <Avatar naam={users.find((u) => u.id === reviewSwap.requesterId)?.name ?? 'Onbekend'} size="lg" /> : undefined}
        footer={reviewSwap ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="md"
              icon={<History size={14} />}
              onClick={() => setHistorySwap(reviewSwap)}
              aria-label="Wijzigingsgeschiedenis"
              title="Wijzigingsgeschiedenis"
            />
            {reviewSwap.status === 'accepted' && (
              <>
                <Button
                  variant="danger"
                  size="lg"
                  className="flex-1"
                  onClick={() => { handleStatusUpdate(reviewSwap.id, 'rejected', reviewSwap.status); setReviewSwap(null); }}
                >
                  Afwijzen
                </Button>
                <Button
                  variant="success"
                  size="lg"
                  className="flex-1"
                  icon={<Check size={16} />}
                  onClick={() => { handleStatusUpdate(reviewSwap.id, 'approved', reviewSwap.status); setReviewSwap(null); }}
                >
                  Goedkeuren
                </Button>
              </>
            )}
            {reviewSwap.status === 'pending' && (isAdmin ? (
              <>
                <Button
                  variant="danger"
                  size="lg"
                  className="flex-1"
                  onClick={() => { handleStatusUpdate(reviewSwap.id, 'rejected', reviewSwap.status); setReviewSwap(null); }}
                >
                  Afwijzen
                </Button>
                <Button
                  variant="success"
                  size="lg"
                  className="flex-1"
                  icon={<Check size={16} />}
                  onClick={() => { handleAdminForceApprove(reviewSwap.id); setReviewSwap(null); }}
                >
                  Goedkeuren
                </Button>
              </>
            ) : (
              <>
                <Badge tone="amber" stil className="mr-auto">Wacht op collega</Badge>
                <Button
                  variant="danger"
                  size="lg"
                  onClick={() => { handleStatusUpdate(reviewSwap.id, 'rejected', reviewSwap.status); setReviewSwap(null); }}
                >
                  Afwijzen
                </Button>
              </>
            ))}
            {reviewSwap.status === 'approved' && (
              <>
                <Button
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                  icon={<Archive size={16} />}
                  onClick={() => { handleAfhandelen(reviewSwap.id); setReviewSwap(null); }}
                >
                  Afhandelen
                </Button>
                <Button
                  variant="danger"
                  size="lg"
                  className="flex-1"
                  onClick={() => { handleCancel(reviewSwap.id); setReviewSwap(null); }}
                >
                  Annuleren
                </Button>
              </>
            )}
          </div>
        ) : undefined}
      >
        {reviewSwap && ruilDetail(reviewSwap)}
      </SlideOver>

      <EntityHistoryModal
        open={!!historySwap}
        onClose={() => setHistorySwap(null)}
        entityType="swap"
        entityId={historySwap?.id ?? ''}
        title={historySwap ? `${users.find((u) => u.id === historySwap.requesterId)?.name || 'Onbekend'}, ${shifts.find((s) => s.id === historySwap.shiftId)?.date ?? ''}` : undefined}
      />
    </PageShell>
  );
}
