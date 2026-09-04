import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronRight, Handshake, History, X, Check } from 'lucide-react';
import type { LeaveRequest, Shift, SwapRequest, SwapType, User } from '../types';
import { ConfirmationModal, EmptyState, ModalHeader, PageHeader, PageShell } from '../components/ui';
import { Modal } from '../components/Modal';
import { Badge, Button, IconButton, MicroLabel, StatusBadge, TableShell, Td, Th } from '../components/primitives';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { Field, Textarea } from '../components/Field';
import { SlideOver } from '../components/SlideOver';
import { EntityHistoryModal } from '../components/EntityHistoryModal';
import { fetchAvailability, isoDate, addDays } from '../lib/availability';
import { formatDateHuman, formatShortDay, serviceNumberOf } from '../lib/format';
import { canRespondToSwap } from '../lib/authorization';
import { notify } from '../lib/ui';

type ReturnOption = { date: string; code: string; isFree: boolean };

/** Vaste visuele identiteit van de overname (ruil zonder tegenprestatie) —
 *  overal dezelfde badge i.p.v. losse blauwe tekstregels per lijst. Stil:
 *  het is een soort, geen signaal (afwerking 04-09, nr. 6). */
const TakeoverBadge = ({ compact = false }: { compact?: boolean }) => (
  <Badge tone="blue" stil icon={<Handshake size={12} />}>
    {compact ? 'Overname' : 'Overname — geen tegenprestatie'}
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
    run: () => void;
  } | null>(null);
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [selectedTargetDriver, setSelectedTargetDriver] = useState<string>('');
  const [reason, setReason] = useState('');
  // Wizard i.p.v. 3 afhankelijke dropdowns: één vraag per stap, tikbare
  // kaarten, en een samenvatting vóór het indienen (UX-review: dit was de
  // moeilijkste flow — keuze-overload met tot 56 opties in één select).
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [showBusyColleagues, setShowBusyColleagues] = useState(false);
  const [showAllReturns, setShowAllReturns] = useState(false);
  // Stap 1 toont eerst de komende ~2 weken; bij een volle 8-wekenplanning
  // stonden er anders 30-40 kaarten in één modal.
  const [showAllShifts, setShowAllShifts] = useState(false);
  const [historySwap, setHistorySwap] = useState<SwapRequest | null>(null);
  // Beoordeling in een side panel: alle ruil-context + beslis-acties
  // zonder paginawissel (zelfde patroon als LeaveManagementView).
  const [reviewSwap, setReviewSwap] = useState<SwapRequest | null>(null);
  useEffect(() => {
    if (!reviewSwap) return;
    const fresh = swaps.find((s) => s.id === reviewSwap.id);
    if (!fresh) { setReviewSwap(null); return; }
    if (fresh.status !== reviewSwap.status || fresh.decidedAt !== reviewSwap.decidedAt) {
      setReviewSwap(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swaps]);
  // Dienstruil-matching: wie is vrij op de dag van de gekozen dienst?
  const [freeForDate, setFreeForDate] = useState<Set<string> | null>(null);
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
  const [returnOptions, setReturnOptions] = useState<ReturnOption[] | null>(null);
  const [returnLoading, setReturnLoading] = useState(false);

  const selectedShiftDate = shifts.find((s) => s.id === selectedShift)?.date;

  useEffect(() => {
    if (!selectedShiftDate) {
      setFreeForDate(null);
      setTakeoverForDate(null);
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
  const todayIso = isoDate(new Date());
  // Alleen kómende eigen diensten, chronologisch — verleden diensten ruilen
  // heeft geen zin en vulde de keuzelijst nodeloos.
  const myShifts = shifts
    .filter(s => s.driverId === user.id && s.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime).localeCompare(String(b.startTime)));
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
  // Gedeelde compacte dag-vorm ('vr 18 jul') — gelijk aan Dekking, i.p.v. de
  // eigen 'vr 18/07'-variant (datum-consolidatie).
  const fmtShort = formatShortDay;

  // Ruil gestart vanuit het rooster: open de wizard meteen op stap 2 met de
  // aangetikte dienst voorgeselecteerd (scheelt de chauffeur stap 1).
  useEffect(() => {
    if (!preselectShiftId) return;
    const shift = myShifts.find((s) => s.id === preselectShiftId);
    if (shift) {
      setSelectedShift(shift.id);
      setSelectedTargetDriver('');
      setReturnPick('');
      setSwapType('ruil');
      setWizardStep(2);
      setShowOfferModal(true);
    }
    onPreselectConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectShiftId]);
  // Tikbare wizard-kaart (stap 1/2/3): geselecteerd = oker-accent.
  const cnCard = (selected: boolean) =>
    `ios-pressable w-full flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${selected ? 'border-oker-300 bg-oker-50 ring-1 ring-oker-200' : 'border-slate-200 bg-surface-white hover:bg-surface-soft-hover'}`;
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

  // Gezien-bevestiging door de ontvanger van de dienst.
  const [isConfirmingSeen, setIsConfirmingSeen] = useState<string | null>(null);
  const bevestigGezien = async (id: string) => {
    if (isConfirmingSeen || !onConfirmSeen) return;
    setIsConfirmingSeen(id);
    try {
      await onConfirmSeen(id);
    } finally {
      setIsConfirmingSeen(null);
    }
  };

  const handleOfferShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const isTakeover = swapType === 'overname';
    if (!selectedShift || !selectedTargetDriver) return;
    if (!isTakeover && !returnPick) return;
    // Dubbele bodem naast de servercheck: nooit een overname indienen op een
    // collega die die dag niet vrij/bv/tk/ta staat.
    if (isTakeover && !takeoverCodeFor(selectedTargetDriver)) return;

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

  const handleStatusUpdate = (swapId: string, newStatus: SwapRequest['status'], seenStatus?: string) => {
    // Delta-pad (PATCH per record, met conflictdetectie): twee mensen die
    // tegelijk beoordelen overschrijven elkaar niet meer — de tweede krijgt
    // een nette melding en een verse lijst. seenStatus = wat de beslisser
    // zág (paneel-snapshot of het moment waarop de bevestiging opende);
    // zonder die referentie vergeleek de server met de al ververste live
    // status en was de conflictcheck deels uitgeschakeld.
    if (onDecide) {
      const toastFor: Partial<Record<SwapRequest['status'], string>> = {
        approved: 'Dienstruil goedgekeurd.',
        rejected: 'Dienstruil geweigerd.',
        accepted: 'Geaccepteerd — de planner beoordeelt de ruil nu.',
        cancelled: 'Aanvraag ingetrokken.',
      };
      void onDecide(swapId, newStatus, seenStatus ?? swaps.find((s) => s.id === swapId)?.status).then((ok) => {
        if (ok && toastFor[newStatus]) notify(toastFor[newStatus]!, 'success');
      });
      return;
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
      run: () => handleStatusUpdate(swapId, 'rejected', seen),
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

  return (
    <PageShell>
      <PageHeader
        title="Dienstruil"
        description="Ruil een dienst met een collega, die accepteert eerst, daarna keurt de planning goed."
        actions={(
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              // Verse wizard bij elk openen — geen halve vorige aanvraag.
              setWizardStep(1);
              setSelectedShift('');
              setSelectedTargetDriver('');
              setReturnPick('');
              setSwapType('ruil');
              setReason('');
              setShowBusyColleagues(false);
              setShowAllReturns(false);
              setShowAllShifts(false);
              setShowOfferModal(true);
            }}
          >
            Dienstruil aanvragen
          </Button>
        )}
      />

      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <MicroLabel className="text-slate-500 ml-1">Mijn verzoeken</MicroLabel>
          {mySwaps.length > 0 ? (
            /* Compacte, uitklapbare rijen in een eigen scrollcontainer: deze
               lijst groeit onbegrensd mee met de historiek (wens Jarno). */
            <div className="max-h-[420px] overflow-y-auto overscroll-contain space-y-2 -mx-1 px-1">
              {mySwaps.map(swap => {
                const info = shiftInfoFor(swap);
                const target = users.find(u => u.id === swap.targetDriverId);
                const open = expandedSwapIds.includes(swap.id);
                return (
                  <Card key={swap.id} padding="none" className="overflow-hidden">
                    {/* rauw: hele uitklaprij is de knop (dienst + datum + statusbadge + chevron) */}
                    <button
                      type="button"
                      onClick={() => toggleSwapExpanded(swap.id)}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-3 p-3.5 pl-4 text-left"
                    >
                      <div className="min-w-0 flex items-baseline gap-2.5">
                        <span className="text-sm font-bold tracking-tight text-slate-800 whitespace-nowrap tabular-nums">Dienst {info.line}</span>
                        <span className="text-2xs font-medium text-slate-500 capitalize truncate">{formatDateHuman(info.date)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={swap.status} stil />
                        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                      </div>
                    </button>
                    {open && (
                      <div className="px-4 pb-4 pt-0.5">
                        {info.startTime && info.endTime && (
                          <p className="text-xs font-mono font-medium text-slate-500 tabular-nums">{info.startTime} – {info.endTime}</p>
                        )}
                        {target && (
                          <p className="text-xs font-medium text-slate-500 mt-1.5">Aan: <span className="font-semibold text-slate-800">{target.name}</span></p>
                        )}
                        {isTakeoverSwap(swap) ? (
                          <div className="mt-1.5"><TakeoverBadge /></div>
                        ) : returnLabel(swap) && (
                          <p className="text-xs font-medium text-blue-700 mt-1">In ruil: {returnLabel(swap)}</p>
                        )}
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
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              compact
              title="Nog geen ruilverzoeken"
              message="Klik op “Dienstruil aanvragen” — je collega en de planner keuren daarna goed."
            />
          )}
        </div>

        <div className="space-y-4">
          <MicroLabel className="text-slate-500 ml-1">Openstaande dienstruilen</MicroLabel>
          {availableSwaps.length > 0 ? (
            availableSwaps.map(swap => {
              const info = shiftInfoFor(swap);
              const requester = users.find(u => u.id === swap.requesterId);
              const canRespond = canRespondToSwap(user, swap);
              return (
                <Card key={swap.id} className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <MicroLabel className="tabular-nums">Dienst {info.line}</MicroLabel>
                      <p className="font-bold tracking-tight text-slate-800 mt-1 capitalize">{formatDateHuman(info.date)}</p>
                      {info.startTime && info.endTime && (
                        <p className="text-xs font-mono font-medium text-slate-500 tabular-nums">{info.startTime} – {info.endTime}</p>
                      )}
                      <p className="text-xs font-medium text-slate-500">Door: {requester?.name}</p>
                      {isTakeoverSwap(swap) ? (
                        <div className="mt-1.5"><TakeoverBadge /></div>
                      ) : returnLabel(swap) && (
                        <p className="text-xs font-medium text-blue-700 mt-1">Jij geeft: {returnLabel(swap)}</p>
                      )}
                    </div>
                    <span className="shrink-0">
                      {/* "Jouw antwoord" vraagt actie en blijft amber; de status is stil. */}
                      {canRespond ? <Badge tone="amber" dot>Jouw antwoord</Badge> : <StatusBadge status={swap.status} stil />}
                    </span>
                  </div>
                  {swap.reason && <p className="text-xs text-slate-500 italic">"{swap.reason}"</p>}
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
                    <p className="text-xs font-medium text-blue-700">Je accepteerde deze ruil — de planner valideert nog (rij-/rusttijden).</p>
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
                      {isConfirmingSeen === swap.id ? 'Bevestigen…' : 'Begrepen — ik rijd deze dienst'}
                    </Button>
                  ) : null}
                </Card>
              );
            })
          ) : (
            <EmptyState
              compact
              variant="klaar"
              title="Geen openstaande dienstruilen"
              message="Stelt een collega jou een ruil voor, dan verschijnt die hier en krijg je een melding."
            />
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => { confirmAction?.run(); setConfirmAction(null); }}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmText={confirmAction?.confirmText ?? 'Bevestigen'}
        variant={confirmAction?.variant ?? 'warning'}
      />

      {isPlanner && (() => {
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
              <MicroLabel className="text-slate-500 ml-1">Beheer dienstruilen</MicroLabel>
              <EmptyState
                variant="klaar"
                title="Geen dienstruilen om te beoordelen"
                message="Zodra een chauffeur een ruil aanvraagt en zijn collega akkoord gaat, verschijnt die hier."
              />
            </div>
          );
        }

        return (
          <div className="space-y-4 pt-8">
            <MicroLabel className="text-slate-500 ml-1">Beheer dienstruilen</MicroLabel>
            <TableShell>
              {/* Desktop table */}
              <div className="hidden md:block">
                <table className="w-full text-left">
                  <thead className="bg-surface-soft border-b border-slate-100">
                    <tr>
                      <Th>Chauffeur</Th>
                      <Th>Dienst</Th>
                      <Th>Status</Th>
                      <Th>Acties</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {actionableSwaps.map(swap => {
                      const info = shiftInfoFor(swap);
                      const requester = users.find(u => u.id === swap.requesterId);
                      return (
                        <tr key={swap.id} className="hover:bg-slate-50/60 transition-colors">
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
                                  <span className="block text-2xs font-medium text-slate-500">→ {users.find(u => u.id === swap.targetDriverId)?.name || 'onbekend'}</span>
                                )}
                              </span>
                              <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
                            </button>
                          </Td>
                          <Td>
                            <span className="font-semibold text-oker-700 tabular-nums">Dienst {info.line}</span>
                            <span className="text-slate-500 tabular-nums"> — {formatDateHuman(info.date)}{info.startTime && info.endTime ? ` (${info.startTime} – ${info.endTime})` : ''}</span>
                            {isTakeoverSwap(swap) ? (
                              <span className="mt-1 block"><TakeoverBadge compact /></span>
                            ) : returnLabel(swap) && (
                              <span className="block text-2xs font-medium text-blue-700 mt-0.5">↔ in ruil: {returnLabel(swap)}</span>
                            )}
                          </Td>
                          <Td>
                            <span className="inline-flex items-center gap-1.5">
                              <StatusBadge status={swap.status} stil />
                              {/* Weet de nieuwe rijder het al? Bij approved is
                                  dát de vraag die telt (push bereikt weinigen). */}
                              {swap.status === 'approved' && swap.targetDriverId && (
                                swap.targetSeenAt
                                  ? <Badge tone="emerald" stil icon={<Check size={12} />} title={`Bevestigd op ${formatDateHuman(swap.targetSeenAt.slice(0, 10))}`}>Gezien</Badge>
                                  : <Badge tone="slate" title="De chauffeur bevestigde de wissel nog niet in de app">Niet bevestigd</Badge>
                              )}
                            </span>
                          </Td>
                          <Td>
                            <div className="flex items-center gap-1.5">
                              <Button variant="ghost" size="sm" icon={<History size={16} />} aria-label="Wijzigingsgeschiedenis" title="Wijzigingsgeschiedenis" onClick={() => setHistorySwap(swap)} />
                              {swap.status === 'accepted' && (
                                <>
                                  <Button variant="ghost" size="sm" icon={<Check size={16} />} className="text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50" aria-label="Goedkeuren" title="Goedkeuren (rij-/rusttijden ok)" onClick={() => handleStatusUpdate(swap.id, 'approved')} />
                                  <Button variant="ghost" size="sm" icon={<X size={16} />} className="text-red-700 hover:text-red-700 hover:bg-red-50" aria-label="Afwijzen" title="Afwijzen" onClick={() => handleStatusUpdate(swap.id, 'rejected')} />
                                </>
                              )}
                              {swap.status === 'pending' && (isAdmin ? (
                                <>
                                  <Button variant="ghost" size="sm" icon={<Check size={16} />} className="text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50" aria-label="Direct goedkeuren" title="Direct goedkeuren — collega heeft nog niet bevestigd" onClick={() => handleAdminForceApprove(swap.id)} />
                                  <Button variant="ghost" size="sm" icon={<X size={16} />} className="text-red-700 hover:text-red-700 hover:bg-red-50" aria-label="Afwijzen" title="Afwijzen" onClick={() => handleStatusUpdate(swap.id, 'rejected')} />
                                </>
                              ) : (
                                <>
                                  <Badge tone="amber" stil className="whitespace-nowrap">Wacht op collega</Badge>
                                  <Button variant="ghost" size="sm" icon={<X size={16} />} className="text-red-700 hover:text-red-700 hover:bg-red-50" aria-label="Afwijzen" title="Afwijzen" onClick={() => handleStatusUpdate(swap.id, 'rejected')} />
                                </>
                              ))}
                              {swap.status === 'approved' && (
                                <Button variant="danger" size="sm" onClick={() => handleCancel(swap.id)}>Annuleren</Button>
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
              <div className="md:hidden divide-y divide-slate-100">
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
                            <span className="font-bold tracking-tight text-slate-800">
                              {requester?.name}
                              {swap.targetDriverId && <span className="font-medium text-slate-400"> → {users.find(u => u.id === swap.targetDriverId)?.name || 'onbekend'}</span>}
                            </span>
                            <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
                          </button>
                          <MicroLabel className="text-oker-700 mt-1 tabular-nums">Dienst {info.line}</MicroLabel>
                          <p className="text-xs font-medium text-slate-500 mt-1 tabular-nums">{formatDateHuman(info.date)}{info.startTime && info.endTime ? ` · ${info.startTime} – ${info.endTime}` : ''}</p>
                          {isTakeoverSwap(swap) ? (
                            <div className="mt-1"><TakeoverBadge compact /></div>
                          ) : returnLabel(swap) && (
                            <p className="text-2xs font-medium text-blue-700 mt-1">↔ in ruil: {returnLabel(swap)}</p>
                          )}
                        </div>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <StatusBadge status={swap.status} stil />
                          {swap.status === 'approved' && swap.targetDriverId && (
                            swap.targetSeenAt
                              ? <Badge tone="emerald" stil icon={<Check size={12} />}>Gezien</Badge>
                              : <Badge tone="slate">Niet bevestigd</Badge>
                          )}
                        </span>
                      </div>
                      <div className="flex gap-2 pt-1">
                        {swap.status === 'accepted' && (
                          <>
                            <Button variant="success" className="flex-1" icon={<Check size={16} />} onClick={() => handleStatusUpdate(swap.id, 'approved')}>
                              Goedkeuren
                            </Button>
                            <Button variant="danger" className="flex-1" icon={<X size={16} />} onClick={() => handleStatusUpdate(swap.id, 'rejected')}>
                              Afwijzen
                            </Button>
                          </>
                        )}
                        {swap.status === 'pending' && (isAdmin ? (
                          <>
                            <Button variant="success" className="flex-1" icon={<Check size={16} />} onClick={() => handleAdminForceApprove(swap.id)}>
                              Goedkeuren
                            </Button>
                            <Button variant="danger" className="flex-1" icon={<X size={16} />} onClick={() => handleStatusUpdate(swap.id, 'rejected')}>
                              Afwijzen
                            </Button>
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-between gap-2">
                            <Badge tone="amber" stil>Wacht op collega</Badge>
                            <Button variant="danger" size="sm" onClick={() => handleStatusUpdate(swap.id, 'rejected')}>
                              Afwijzen
                            </Button>
                          </div>
                        ))}
                        {swap.status === 'approved' && (
                          <Button variant="danger" full onClick={() => handleCancel(swap.id)}>
                            Annuleren
                          </Button>
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

      {/* Gedeelde Modal i.p.v. eigen portal: ESC, backdrop-tap, safe-area en
          dvh-begrenzing komen daar vandaan (verbeterronde 29/07 #3). */}
      <Modal open={showOfferModal} onClose={() => setShowOfferModal(false)} maxWidth="md" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
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
              <form ref={wizardScrollRef} onSubmit={handleOfferShift} className="p-6 md:p-7 space-y-4 overflow-y-auto flex-1">
                {/* ── Stap 1: kies je eigen (komende) dienst ── */}
                {wizardStep === 1 && (
                  myShifts.length === 0 ? (
                    <Card tone="warning" padding="none" className="px-4 py-3 text-sm font-medium text-amber-800">
                      Je hebt geen komende diensten om te ruilen. {isPlanner ? 'Via Systeemstatus kan je een fictieve testdienst aanmaken om de flow te proberen.' : 'Vraag de planning om hulp.'}
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {(showAllShifts ? myShifts : myShifts.slice(0, 8)).map((s) => (
                        /* rauw: wizard-keuzekaart (datum + dienst + chevron), eigen layout via cnCard */
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { setSelectedShift(s.id); setSelectedTargetDriver(''); setReturnPick(''); setWizardStep(2); }}
                          className={cnCard(selectedShift === s.id)}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-slate-800 capitalize">{formatDateHuman(s.date)}</span>
                            <span className="block text-xs font-medium text-slate-500 tabular-nums">Dienst {serviceNumberOf(s)} · {s.startTime} – {s.endTime}</span>
                          </span>
                          <ChevronRight size={16} className="shrink-0 text-slate-300" />
                        </button>
                      ))}
                      {!showAllShifts && myShifts.length > 8 && (
                        <Button variant="ghost" size="sm" full className="text-oker-700 hover:text-oker-800" onClick={() => setShowAllShifts(true)}>
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
                      {selectedShiftDate && <span className="capitalize"> · {formatDateHuman(selectedShiftDate)}</span>}
                    </p>
                    {matchLoading ? (
                      <p className="text-sm font-medium text-slate-500 py-6 text-center">Beschikbaarheid laden…</p>
                    ) : (
                      <>
                        <div className="space-y-2">
                          {eligibleTargetDrivers
                            .filter((u) => showBusyColleagues || !freeForDate || isAvailableOnShiftDate(u.id))
                            .map((u) => {
                              const free = freeForDate?.has(u.id);
                              // Planningcode ('bv', 'tk', 'ta') leest preciezer dan
                              // "vrij" — en zegt meteen of een overname kan.
                              const code = takeoverCodeFor(u.id);
                              return (
                                /* rauw: wizard-keuzekaart (naam + beschikbaarheidsbadge + chevron), eigen layout via cnCard */
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedTargetDriver(u.id);
                                    setReturnPick('');
                                    setShowAllReturns(false);
                                    // Terug naar de standaardvorm als deze collega
                                    // geen overname toelaat.
                                    if (!takeoverCodeFor(u.id)) setSwapType('ruil');
                                    setWizardStep(3);
                                  }}
                                  className={cnCard(selectedTargetDriver === u.id)}
                                >
                                  <span className="text-sm font-bold text-slate-800 truncate">{u.name}</span>
                                  <span className="shrink-0 inline-flex items-center gap-2">
                                    {freeForDate && (
                                      code && code !== 'vrij'
                                        ? <Badge tone="emerald" stil>{code}</Badge>
                                        : free || code
                                          ? <Badge tone="emerald" stil>vrij</Badge>
                                          : <Badge tone="slate">bezet</Badge>
                                    )}
                                    <ChevronRight size={16} className="text-slate-300" />
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                        {freeForDate && !showBusyColleagues && eligibleTargetDrivers.some((u) => !isAvailableOnShiftDate(u.id)) && (
                          <Button variant="ghost" size="sm" full className="text-oker-700 hover:text-oker-800" onClick={() => setShowBusyColleagues(true)}>
                            Toon ook bezette collega's ({eligibleTargetDrivers.filter((u) => !isAvailableOnShiftDate(u.id)).length})
                          </Button>
                        )}
                        {freeForDate && freeCount === 0 && !showBusyColleagues && (
                          <p className="text-xs font-medium text-slate-500 text-center">Niemand is vrij op {formatDateHuman(selectedShiftDate)} — je kan wel een bezette collega vragen.</p>
                        )}
                        <p className="text-2xs font-medium text-slate-500">"Vrij" = geen dienst en geen verlof op {selectedShiftDate ? formatDateHuman(selectedShiftDate) : 'die dag'}. Bij vrij/bv/tk/ta kan je de dienst ook zonder tegenprestatie doorgeven.</p>
                      </>
                    )}
                  </>
                )}

                {/* ── Stap 3: tegenprestatie + samenvatting + indienen ── */}
                {wizardStep === 3 && (() => {
                  const target = users.find((u) => u.id === selectedTargetDriver);
                  const offered = shifts.find((s) => s.id === selectedShift);
                  // Conflict-check op shift-niveau (niet dag-niveau): alleen de
                  // aangeboden shift zelf telt niet mee — een tweede eigen
                  // segment op dezelfde dag blijft een conflict. Ook eigen
                  // goedgekeurd verlof blokkeert een tegenprestatie.
                  const ownConflictOn = (date: string): string | undefined => {
                    const otherOwnShift = shifts.find(
                      (s) => s.driverId === user.id && s.date === date && s.id !== selectedShift,
                    );
                    if (otherOwnShift) return `dienst ${String(otherOwnShift.line || '?').trim()}`;
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

                      {/* Vorm van de aanvraag: 1-op-1 of zonder tegenprestatie. */}
                      <div className="space-y-2">
                        {/* rauw: keuzekaart ruilvorm (icoon + titel + uitleg + radio-vinkje), eigen layout via cnCard */}
                        <button
                          type="button"
                          onClick={() => setSwapType('ruil')}
                          className={cnCard(!isTakeover)}
                        >
                          <span className="min-w-0 flex items-start gap-2.5">
                            <ArrowLeftRight size={16} className="mt-0.5 shrink-0 text-oker-500" />
                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-slate-800">Ruilen (1-op-1)</span>
                              <span className="block text-xs font-medium text-slate-500">Jij neemt een dienst of vrije dag van {voornaam} over</span>
                            </span>
                          </span>
                          {!isTakeover ? <Check size={16} className="shrink-0 text-oker-700" /> : <span className="shrink-0 h-4 w-4 rounded-full border border-slate-300" />}
                        </button>
                        {/* rauw: keuzekaart ruilvorm (icoon + titel + uitleg + radio-vinkje), eigen layout via cnCard */}
                        <button
                          type="button"
                          disabled={!takeoverCode}
                          onClick={() => { setSwapType('overname'); setReturnPick(''); }}
                          className={`${cnCard(isTakeover)} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-row-hover`}
                        >
                          <span className="min-w-0 flex items-start gap-2.5">
                            <Handshake size={16} className="mt-0.5 shrink-0 text-blue-500" />
                            <span className="min-w-0">
                              <span className="block text-sm font-bold text-slate-800">Zonder tegenprestatie</span>
                              <span className="block text-xs font-medium text-slate-500">
                                {takeoverCode
                                  ? <>{voornaam} neemt je dienst over ({takeoverCode} die dag) — jij geeft niets terug.</>
                                  : <>Kan niet: {voornaam} staat op {selectedShiftDate ? formatDateHuman(selectedShiftDate) : 'die dag'} niet op vrij/bv/tk/ta</>}
                              </span>
                            </span>
                          </span>
                          {isTakeover ? <Check size={16} className="shrink-0 text-oker-700" /> : <span className="shrink-0 h-4 w-4 rounded-full border border-slate-300" />}
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
                                  onClick={() => setReturnPick(selected ? '' : val)}
                                  className={cnCard(selected)}
                                >
                                  <span className="min-w-0">
                                    <span className="block text-sm font-bold text-slate-800 capitalize">{formatDateHuman(o.date)}</span>
                                    <span className="block text-xs font-medium text-slate-500">{o.isFree ? 'Vrije dag van de collega' : `Dienst ${o.code}`}</span>
                                  </span>
                                  {selected ? <Check size={16} className="shrink-0 text-oker-700" /> : <span className="shrink-0 h-4 w-4 rounded-full border border-slate-300" />}
                                </button>
                              );
                            })}
                          </div>
                          {!showAllReturns && (pickable.length > 8 || conflicted.length > 0) && (
                            <Button variant="ghost" size="sm" full className="text-oker-700 hover:text-oker-800" onClick={() => setShowAllReturns(true)}>
                              Meer tonen{pickable.length > 8 ? ` (${pickable.length - 8} extra)` : ''}
                            </Button>
                          )}
                          {showAllReturns && conflicted.length > 0 && (
                            <div className="space-y-2">
                              <MicroLabel>Niet mogelijk — jij bent die dag al ingepland</MicroLabel>
                              {conflicted.map((o) => (
                                <Card key={`${o.date}|${o.code}`} tone="muted" padding="none" className="flex items-center justify-between gap-3 px-4 py-3 opacity-60">
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-slate-500 capitalize">{formatDateHuman(o.date)}</span>
                                    <span className="block text-xs font-medium text-slate-500">{o.isFree ? "Vrije dag van de collega" : `Dienst ${o.code}`} — {o.ownDuty === "verlof" ? "jij hebt die dag verlof" : `jij rijdt al ${o.ownDuty}`}</span>
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
                          Jij geeft <strong>dienst {serviceNumberOf(offered)}</strong> ({selectedShiftDate ? fmtShort(selectedShiftDate) : '—'}) aan <strong>{target?.name}</strong> — <strong>zonder tegenprestatie</strong>.
                        </Card>
                      ) : pick && (
                        <Card tone="accent" padding="none" className="px-4 py-3 text-sm font-medium text-slate-800">
                          Jij geeft <strong>dienst {serviceNumberOf(offered)}</strong> ({selectedShiftDate ? fmtShort(selectedShiftDate) : '—'}) aan <strong>{target?.name}</strong> — jij neemt {pick.code.toLowerCase() === 'vrij' ? <>zijn <strong>vrije dag</strong></> : <>zijn <strong>dienst {pick.code}</strong></>} ({fmtShort(pick.date)}).
                        </Card>
                      )}
                      <div className="space-y-2">
                        <Button
                          type="submit"
                          variant="primary"
                          size="lg"
                          full
                          disabled={!selectedShift || !selectedTargetDriver || (isTakeover ? !takeoverCode : !returnPick) || isSubmitting}
                        >
                          {isSubmitting ? 'Versturen…' : isTakeover ? 'Vraag om over te nemen' : 'Ruilverzoek versturen'}
                        </Button>
                        {/* Reden waarom de knop nog uit staat, bij de knop —
                            niet als toast na een klik die niets doet. */}
                        {!isTakeover && !returnPick && !returnLoading ? (
                          <p className="text-center text-xs text-slate-500">Kies eerst wat je van {voornaam} overneemt.</p>
                        ) : (
                          <p className="text-2xs font-medium text-slate-500 text-center">{voornaam} moet eerst accepteren; daarna keurt de planner goed.</p>
                        )}
                      </div>
                    </>
                  );
                })()}
              </form>
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
              <Button
                variant="danger"
                size="lg"
                className="flex-1"
                onClick={() => { handleCancel(reviewSwap.id); setReviewSwap(null); }}
              >
                Annuleren
              </Button>
            )}
          </div>
        ) : undefined}
      >
        {reviewSwap && (() => {
          const info = shiftInfoFor(reviewSwap);
          const requester = users.find((u) => u.id === reviewSwap.requesterId);
          const target = reviewSwap.targetDriverId ? users.find((u) => u.id === reviewSwap.targetDriverId) : undefined;
          return (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={reviewSwap.status} stil />
                <Badge tone="oker" className="tabular-nums">Dienst {info.line}</Badge>

                {info.date && (
                  <Badge tone="slate" className="tabular-nums">{info.date}{info.startTime && info.endTime ? ` · ${info.startTime} – ${info.endTime}` : ''}</Badge>
                )}
                {isTakeoverSwap(reviewSwap) && <TakeoverBadge compact />}
              </div>

              <Card tone="muted" padding="sm">
                <MicroLabel className="text-slate-500">{isTakeoverSwap(reviewSwap) ? 'Overname' : 'Ruil'}</MicroLabel>
                <p className="mt-1.5 text-sm font-semibold text-slate-800">
                  {requester?.name ?? 'Onbekend'}
                  <span className="mx-1.5 font-medium text-slate-400">→</span>
                  {target?.name ?? 'open verzoek'}
                </p>
                {isTakeoverSwap(reviewSwap) ? (
                  <p className="mt-1 text-xs font-medium text-blue-700">De collega neemt de dienst over, zonder tegenprestatie.</p>
                ) : returnLabel(reviewSwap) && (
                  <p className="mt-1 text-xs font-medium text-blue-700">↔ in ruil: {returnLabel(reviewSwap)}</p>
                )}
              </Card>

              {reviewSwap.reason && (
                <div>
                  <MicroLabel>Toelichting van de aanvrager</MicroLabel>
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-soft border border-slate-100 px-4 py-3 text-sm font-normal leading-relaxed text-slate-700">
                    {reviewSwap.reason}
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      </SlideOver>

      <EntityHistoryModal
        open={!!historySwap}
        onClose={() => setHistorySwap(null)}
        entityType="swap"
        entityId={historySwap?.id ?? ''}
        title={historySwap ? `${users.find((u) => u.id === historySwap.requesterId)?.name || 'Onbekend'} — ${shifts.find((s) => s.id === historySwap.shiftId)?.date ?? ''}` : undefined}
      />
    </PageShell>
  );
}
