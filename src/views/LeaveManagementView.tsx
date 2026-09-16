import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CalendarOff, Check, ChevronDown, ChevronRight as ChevronRightSmall, ClipboardCheck, Plus, Printer, SlidersHorizontal, Users, X } from 'lucide-react';
import { isRijdend, teltInVerlofbezetting } from '../types';
import type { LeaveRequest, Shift, User } from '../types';
import { cn, notify, openPdfInNewTab } from '../lib/ui';
import { Modal } from '../components/Modal';
import { ConfirmationModal, ModalHeader, PageHeader, PageShell } from '../components/ui';
import { Button, IconButton, MicroLabel, microLabelClass, StatusBadge, Badge, statusAccentClass } from '../components/primitives';
import { Uitklap, uitklapChevron } from '../components/Uitklap';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { Field, Select, Textarea } from '../components/Field';
import { MaandNavigatie } from '../components/MaandNavigatie';
import { verlofBalans, verlofDagen } from '../lib/leaveBalance';
import { VerlofFeestdagenModal } from '../components/VerlofFeestdagenModal';
import { VerlofSaldoModal } from '../components/VerlofSaldoModal';
import type { ExtraFeestdag } from '../../shared/feestdagen';
import { LeaveBalanceCard } from '../components/LeaveBalanceCard';
import { shiftsConflictingWithLeave } from '../lib/conflicts';
import { isoDate } from '../lib/availability';
import { formatDateHuman, formatShortDay } from '../lib/format';
import { EntityHistoryModal } from '../components/EntityHistoryModal';
import { formatLeaveType, WEEKDAY_SHORT_MON } from '../lib/format';
import { apiJson } from '../lib/api';
import { bulkUitvoeren, meldBulkResultaat } from '../lib/bulk';
import { VerlofLimietenModal } from '../components/VerlofLimietenModal';
import { limietVoorDag, parseVerlofLimieten, STANDAARD_VERLOF_LIMIETEN, type VerlofLimieten } from '../../shared/schemas/verlofLimieten';
import { bevatVrijeDag, dagenBovenVerlofLimiet, dagenVan, VerlofBeoordeling } from '../components/VerlofBeoordeling';


// Ziek melden zit BEWUST niet meer in deze view maar in de kop van het
// planner-dashboard (PlannerDashboardWidgets). Het is geen verlofaanvraag maar
// een registratie die de planning meteen raakt, en ze komt telefonisch binnen
// tijdens de rit — dus hoort ze in de cockpit, niet achter een menu-item dat
// verder over aanvragen beoordelen gaat.
/**
 * Bezetting van een kalenderdag in de verlofkalender (kleuren en titels
 * gekozen door Jarno 08-09): groen = vrij (niemand goedgekeurd afwezig),
 * oranje = deels vrij, rood = volzet. Volzet zodra de verloflimiet van die
 * dag bereikt is. Die limiet was een vaste 2; sinds 09-09 stelt de admin
 * hem in (standaard + uitzonderingsperiodes, bv. zomervakantie hoger), zie
 * shared/schemas/verlofLimieten.ts en de knop "Limieten" hierboven.
 */
type Bezetting = 'vrij' | 'deels' | 'volzet';
const bezettingVanDag = (afwezig: number, limiet: number): Bezetting => (afwezig <= 0 ? 'vrij' : afwezig < limiet ? 'deels' : 'volzet');
const BEZETTING_LABEL: Record<Bezetting, string> = { vrij: 'vrij', deels: 'deels vrij', volzet: 'volzet' };

export function LeaveManagementView({ user, leaveRequests, users, onSave, onDecide, lastSeenDecisionAt, onMarkDecisionsSeen, shifts = [], feestdagenExtra = [], onFeestdagenSaved }: { user: User; leaveRequests: LeaveRequest[]; users: User[]; onSave: (l: LeaveRequest[]) => void | boolean | Promise<void | boolean>; onDecide?: (id: string, status: LeaveRequest['status'], seenStatus?: string) => Promise<boolean>; lastSeenDecisionAt?: string | null; onMarkDecisionsSeen?: () => void; shifts?: Shift[]; feestdagenExtra?: ExtraFeestdag[]; onFeestdagenSaved?: (extra: ExtraFeestdag[]) => void }) {
  const [showRequestModal, setShowRequestModal] = useState(false);
  // 'registratie' (verzoek Jarno 09-09): een planner/admin legt verlof vast
  // dat al op papier goedgekeurd was, zodat de papieren en de digitale versie
  // kloppen. Zelfde formulier als de aanvraag, maar: chauffeur verplicht,
  // datums in het verleden toegestaan, meteen goedgekeurd, geen mail, en het
  // venster blijft open zodat je de volgende periode meteen kan invoeren.
  const [modus, setModus] = useState<'aanvraag' | 'registratie'>('aanvraag');
  const [voorWieFout, setVoorWieFout] = useState('');
  const [showLimietenModal, setShowLimietenModal] = useState(false);
  const [showFeestdagenModal, setShowFeestdagenModal] = useState(false);
  const [showSaldoModal, setShowSaldoModal] = useState(false);
  const [limieten, setLimieten] = useState<VerlofLimieten>(STANDAARD_VERLOF_LIMIETEN);
  useEffect(() => {
    let weg = false;
    void (async () => {
      try {
        // parse: rommel of een oud antwoord mag de kalender niet laten crashen.
        const data = await apiJson<unknown>('/api/verlof/limieten');
        if (!weg) setLimieten(parseVerlofLimieten(data));
      } catch {
        // standaard blijft staan; de kalender werkt gewoon
      }
    })();
    return () => { weg = true; };
  }, []);
  const openAanvraag = () => { setModus('aanvraag'); setPeriodeFout(''); setVoorWieFout(''); setShowRequestModal(true); };
  const openRegistratie = () => { setModus('registratie'); setPeriodeFout(''); setVoorWieFout(''); setFormData({ startDate: '', endDate: '', type: 'betaald_verlof', comment: '' }); setShowRequestModal(true); };
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Bevestigingen via ConfirmationModal i.p.v. kale window.confirm
  // (browser-popup met "vhb-five.vercel.app meldt…" schrikt chauffeurs af).
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmText: string;
    variant: 'danger' | 'warning';
    run: () => void;
  } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Historiek standaard gecapt op 5 — de volledige lijst groeide onbegrensd.
  const [formData, setFormData] = useState({ startDate: '', endDate: '', type: 'betaald_verlof' as LeaveRequest['type'], comment: '' });
  // Validatiefout bij de periode (fase C15): staat bij het veld, niet in een
  // toast. Verdwijnt zodra de periode opnieuw gekozen of gewist wordt.
  const [periodeFout, setPeriodeFout] = useState('');
  // Voor wie vraag je aan? Alleen zichtbaar voor planner/admin: in de
  // testfase belt of zegt een deel van de chauffeurs zijn verlof gewoon door,
  // en dan kon de planning dat nergens kwijt. Leeg = voor jezelf.
  const [voorWie, setVoorWie] = useState<string>('');
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const goToPrevMonth = () => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goToNextMonth = () => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  // Maand-swipe op touch (verbeterronde 01-09, nr. 3): veeg links/rechts over
  // de kalender i.p.v. de kleine pijltjes te raken. Duidelijk horizontaal
  // (>56 px en ~2× de verticale beweging) zodat gewoon scrollen niet bladert.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const swipeHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      swipeStart.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = swipeStart.current;
      swipeStart.current = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 56 && Math.abs(dx) > 1.8 * Math.abs(dy)) {
        if (dx < 0) goToNextMonth(); else goToPrevMonth();
      }
    },
  };
  const goToCurrentMonth = () => {
    const now = new Date();
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };
  const isCurrentMonth = (() => {
    const now = new Date();
    return viewMonth.getFullYear() === now.getFullYear() && viewMonth.getMonth() === now.getMonth();
  })();

  const isPlanner = user.role === 'planner' || user.role === 'admin';
  // Bezetting per dag van de server (alleen niet-staf): GET /api/leave geeft
  // een chauffeur bewust enkel eigen verlof (privacy), dus lokaal rekenen
  // kleurde bij hem elke dag "Vrij" en kwam de limietwaarschuwing bij het
  // aanvragen nooit. GET /api/leave/bezetting geeft uitsluitend datum +
  // aantal + limiet (geen namen), met dezelfde telregels als de planner-kant.
  const [bezettingServer, setBezettingServer] = useState<Record<string, number>>({});
  const laadBezetting = useCallback(async (van: string, tot: string, weg?: () => boolean) => {
    try {
      const data = await apiJson<{ dagen: Array<{ datum: string; aantal: number }> }>(
        `/api/leave/bezetting?van=${van}&tot=${tot}`,
      );
      if (weg?.()) return;
      // Vorm valideren vóór de state-updater: die draait tijdens de render,
      // buiten deze try/catch, en een 404-body ({}) crashte daar de view
      // ("dagen is not iterable", e2e 15-09).
      const dagen = Array.isArray((data as any)?.dagen) ? (data as any).dagen : [];
      setBezettingServer((cur) => {
        const next = { ...cur };
        for (const d of dagen) next[String(d.datum)] = Number(d.aantal) || 0;
        return next;
      });
    } catch {
      // Zonder antwoord blijft de kalender op "Vrij" staan; hij blijft werken.
    }
  }, []);
  // De getoonde maand (en bij een wissel van verlofdata: opnieuw, want een
  // ingetrokken of pas goedgekeurd verlof verandert de aantallen).
  useEffect(() => {
    if (isPlanner) return;
    let weg = false;
    const van = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}-01`;
    const tot = isoDate(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0));
    void laadBezetting(van, tot, () => weg);
    return () => { weg = true; };
  }, [isPlanner, viewMonth, leaveRequests, laadBezetting]);
  // De gekozen aanvraagperiode kan buiten de getoonde maand vallen; haal die
  // dagen apart op zodat de limiet-preview ook dan klopt.
  useEffect(() => {
    if (isPlanner || !formData.startDate || !formData.endDate || formData.endDate < formData.startDate) return;
    let weg = false;
    void laadBezetting(formData.startDate, formData.endDate, () => weg);
    return () => { weg = true; };
  }, [isPlanner, formData.startDate, formData.endDate, laadBezetting]);
  // Lokale dag i.p.v. UTC (toISOString gaf 's nachts in BE de vorige dag).
  const today = isoDate(new Date());
  // Ziekte hoort niet bij verlof (Jarno 08-09): ziekmeldingen staan in
  // dezelfde tabel (type 'ziekte') maar tellen hier nergens mee: niet in de
  // kalender, niet in de dekking bij een beoordeling, niet in de eigen lijst.
  // Ze leven in Beheer › Ziekte. Opslaan gebeurt wél op de volledige lijst,
  // anders zouden ziekmeldingen bij een beslissing verdwijnen.
  const verlofRequests = useMemo(() => leaveRequests.filter((r) => r.type !== 'ziekte'), [leaveRequests]);
  const myRequests = verlofRequests.filter((r) => r.userId === user.id);
  const myPending = myRequests
    .filter((r) => r.status === 'pending')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const myUpcoming = myRequests
    .filter((r) => r.status === 'approved' && r.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const myHistory = myRequests
    .filter((r) => r.status === 'rejected' || r.status === 'cancelled' || (r.status === 'approved' && r.endDate < today))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  // Voor wie wordt deze aanvraag opgeslagen? Chauffeurs altijd voor zichzelf;
  // een planner kan een collega kiezen (dan is het een registratie van iets
  // dat al mondeling is afgesproken).
  const aanvraagVoorId = isPlanner && voorWie ? voorWie : String(user.id);
  const namensIemandAnders = aanvraagVoorId !== String(user.id);
  const registratie = modus === 'registratie';
  // Verlof achteraf vastleggen mag in het verleden (de chauffeur belde het
  // vorige week door, of het stond al op papier); een eigen aanvraag niet.
  // In registratie-modus ook vóór de chauffeur gekozen is: anders staan de
  // verleden-dagen grijs tot je de keuzelijst aanraakt, wat als kapot oogt.
  const magVerleden = namensIemandAnders || registratie;

  /** Telt het eigen goedgekeurde verlof van deze gebruiker op die dag mee in
   *  de servertelling? Dan niet dubbel rekenen bij "erbij deze aanvraag". */
  const eigenVerlofTeltOp = (dag: string) =>
    teltInVerlofbezetting(user) &&
    verlofRequests.some((r) => r.status === 'approved' && String(r.userId) === String(user.id) && r.startDate <= dag && r.endDate >= dag);

  /** Dagen van een periode waarop deze chauffeur erbij de verloflimiet
   *  overschrijdt (gedeeld met de beoordeling, src/components/VerlofBeoordeling.tsx).
   *  Een chauffeur heeft de verlofrijen van anderen niet (privacy) en rekent
   *  daarom op de aantallen van GET /api/leave/bezetting. */
  const dagenBovenLimiet = (van: string, tot: string, exclUserId: string) => {
    if (isPlanner) return dagenBovenVerlofLimiet({ verlofRequests, users, limieten }, van, tot, exclUserId);
    // Niet-staf vraagt altijd voor zichzelf aan (exclUserId = user.id). Telt
    // hij zelf niet in de bezetting (technieker, flexi), dan geen waarschuwing,
    // zelfde regel als dagenBovenVerlofLimiet.
    if (!teltInVerlofbezetting(user)) return [];
    return dagenVan(van, tot)
      .map((dag) => ({
        dag,
        afwezig: Math.max(0, (bezettingServer[dag] ?? 0) - (eigenVerlofTeltOp(dag) ? 1 : 0)) + 1,
        limiet: limietVoorDag(limieten, dag),
      }))
      .filter((d) => d.afwezig > d.limiet);
  };

  const handleRequestLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (registratie && !voorWie) {
      setVoorWieFout('Kies eerst de chauffeur voor wie je het verlof vastlegt.');
      return;
    }
    setVoorWieFout('');
    if (!formData.startDate || !formData.endDate) {
      setPeriodeFout('Kies eerst een start- en einddatum in de kalender.');
      return;
    }
    // Een planner die verlof achteraf registreert mag wél in het verleden
    // boeken (de chauffeur belde het vorige week door); een eigen aanvraag
    // niet.
    if (formData.startDate < today && !namensIemandAnders) {
      setPeriodeFout('Je kan geen verlof aanvragen in het verleden.');
      return;
    }
    setPeriodeFout('');
    // Pas sluiten/wissen ná een geslaagde save — bij een fout blijft de
    // aanvraag ingevuld staan zodat de chauffeur niet opnieuw moet beginnen.
    setIsSubmitting(true);
    // Namens een chauffeur ingevoerd verlof staat meteen op goedgekeurd: de
    // planner ís de beoordelaar, en een eigen aanvraag die je daarna zelf nog
    // moet goedkeuren is een lege stap (en zou wél als "wacht op planner" in
    // de open taken staan).
    const nieuw: LeaveRequest = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: aanvraagVoorId,
      ...formData,
      status: namensIemandAnders ? 'approved' : 'pending',
      createdAt: new Date().toISOString(),
      ...(namensIemandAnders ? { decidedAt: new Date().toISOString() } : {}),
    };
    const ok = await Promise.resolve(onSave([...leaveRequests, nieuw])).finally(() => setIsSubmitting(false));
    if (ok === false) return;
    const naam = users.find((u) => String(u.id) === aanvraagVoorId)?.name ?? 'de chauffeur';
    if (registratie) {
      // Venster open laten met dezelfde chauffeur: de papieren lijst heeft
      // meestal meerdere periodes, en de lijst "al vastgelegd" hieronder
      // groeit mee zodat je ziet wat er al in staat.
      setFormData((cur) => ({ ...cur, startDate: '', endDate: '', comment: '' }));
      notify(`${naam}: ${formatLeaveType(formData.type).toLowerCase()} ${formData.startDate === formData.endDate ? formatShortDay(formData.startDate) : `${formatShortDay(formData.startDate)} tot ${formatShortDay(formData.endDate)}`} vastgelegd.`, 'success');
      return;
    }
    setShowRequestModal(false);
    setFormData({ startDate: '', endDate: '', type: 'betaald_verlof', comment: '' });
    setVoorWie('');
    if (namensIemandAnders) {
      notify(`Verlof voor ${naam} vastgelegd en meteen goedgekeurd.`, 'success');
    }
  };

  // === Live preview van impact van de nieuwe aanvraag ===
  // - Hoeveel dagen vraagt-ie aan?
  // - Gaat hij over budget?
  // - Heeft hij al diensten ingepland in die periode? (conflict)
  const requestPreview = useMemo(() => {
    if (!formData.startDate || !formData.endDate) return null;
    const requestedYear = parseInt(formData.startDate.slice(0, 4), 10);
    // DST-veilig tellen via UTC (zie leaveBalance.daysBetween) — lokale
    // middernacht + floor telde 1 dag te weinig over de lente-DST-zondag.
    // Zondagen tellen niet als verlofdag (regel Jarno 09-09).
    const requestedDays = verlofDagen(formData.startDate, formData.endDate);
    if (requestedDays <= 0) return null;

    // Saldo en conflicten van dégene voor wie je aanvraagt — anders keek een
    // planner naar zijn eigen saldo terwijl hij verlof van een chauffeur
    // invoert.
    const doelUser = users.find((u) => String(u.id) === aanvraagVoorId) ?? user;
    const currentBalance = verlofBalans(leaveRequests, aanvraagVoorId, requestedYear, doelUser.verlofBudget);
    const wouldExceed =
      formData.type === 'betaald_verlof' &&
      currentBalance.betaaldGebruikt + requestedDays > currentBalance.betaaldBudget;
    const remainingAfter = currentBalance.betaaldBudget - currentBalance.betaaldGebruikt - requestedDays;

    const conflictingShifts = shiftsConflictingWithLeave(shifts, {
      id: '__draft__',
      userId: aanvraagVoorId,
      startDate: formData.startDate,
      endDate: formData.endDate,
      type: formData.type,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    return {
      requestedDays,
      wouldExceed,
      remainingAfter,
      budget: currentBalance.betaaldBudget,
      gebruikt: currentBalance.betaaldGebruikt,
      conflictingShifts,
      bovenLimiet: dagenBovenLimiet(formData.startDate, formData.endDate, aanvraagVoorId),
    };
  }, [formData.startDate, formData.endDate, formData.type, leaveRequests, shifts, aanvraagVoorId, users, user, limieten]);

  const handleCalendarDateClick = (dateStr: string) => {
    if (!showRequestModal) {
      setSelectedDate((current) => (current === dateStr ? null : dateStr));
      return;
    }

    setPeriodeFout('');
    setFormData((current) => {
      // Geen actief bereik (nog niets, of allebei al gevuld) → start een nieuw bereik.
      if (!current.startDate || current.endDate) {
        return { ...current, startDate: dateStr, endDate: '' };
      }

      // Tweede klik vóór de startdatum → herstart vanaf deze datum als nieuwe start.
      if (dateStr < current.startDate) {
        return { ...current, startDate: dateStr, endDate: '' };
      }

      // Geldige tweede klik (zelfde dag = één-dag verlof, latere dag = einde van bereik).
      return { ...current, endDate: dateStr };
    });
  };

  const isDateWithinDraftRange = (dateStr: string) => {
    if (!showRequestModal || !formData.startDate) return false;
    if (!formData.endDate) return dateStr === formData.startDate;
    return dateStr >= formData.startDate && dateStr <= formData.endDate;
  };

  const isDraftBoundary = (dateStr: string) =>
    showRequestModal && (dateStr === formData.startDate || dateStr === formData.endDate);

  const decisionToast = (status: LeaveRequest['status']) =>
    status === 'approved' ? 'Verlof goedgekeurd.' : status === 'rejected' ? 'Verlof afgewezen.' : 'Verlof geannuleerd.';

  const handleStatusUpdate = (requestId: string, newStatus: LeaveRequest['status'], seenStatus?: string) => {
    // Delta-pad (PATCH per record): conflictveilig bij twee gelijktijdige
    // beoordelaars — de tweede krijgt een melding i.p.v. een stille overschrijf.
    // seenStatus = de status die de beslisser op het scherm zag; zonder die
    // referentie vergeleek de server met de (al ververste) live status en
    // was de conflictcheck feitelijk uitgeschakeld.
    if (onDecide) {
      // Succes-toast bij bevestiging: een beslissing zonder enige feedback
      // voelde als "is er iets gebeurd?" (controleronde 30/07).
      void onDecide(requestId, newStatus, seenStatus).then((ok) => {
        if (ok) notify(decisionToast(newStatus), 'success');
      });
      return;
    }
    const decidedAt = new Date().toISOString();
    onSave(leaveRequests.map((r) => (r.id === requestId ? { ...r, status: newStatus, decidedAt } : r)));
  };

  // Bulk-selectie voor planner-goedkeuring van meerdere pending aanvragen.
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [historyLeave, setHistoryLeave] = useState<LeaveRequest | null>(null);
  // Beoordeling in een side panel: alle context (saldo, conflicten,
  // toelichting) + beslis-acties zonder paginawissel.
  const [reviewLeave, setReviewLeave] = useState<LeaveRequest | null>(null);
  useEffect(() => {
    if (!reviewLeave) return;
    const fresh = leaveRequests.find((r) => r.id === reviewLeave.id);
    if (!fresh) { setReviewLeave(null); return; }
    if (fresh.status !== reviewLeave.status || fresh.decidedAt !== reviewLeave.decidedAt) {
      setReviewLeave(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveRequests]);
  const togglePendingSelection = (id: string) => {
    setSelectedPendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const bulkDecide = (status: 'approved' | 'rejected') => {
    const ids = leaveRequests
      .filter((r) => selectedPendingIds.has(r.id) && r.status === 'pending')
      .map((r) => r.id);
    if (onDecide) {
      // Sequentieel per record: elk met eigen conflictdetectie — een aanvraag
      // die intussen al behandeld is, geeft een melding en slaat over. Eén
      // samenvattende toast na afloop i.p.v. n stiltes.
      void (async () => {
        const resultaat = await bulkUitvoeren(ids, (id) => onDecide(id, status, 'pending'));
        meldBulkResultaat(notify, resultaat, {
          item: ['aanvraag', 'aanvragen'],
          gedaan: status === 'approved' ? 'goedgekeurd' : 'geweigerd',
          rest: () => ', de rest was intussen al behandeld',
          misluktToon: 'info',
        });
      })();
      return;
    }
    const decidedAt = new Date().toISOString();
    onSave(leaveRequests.map((r) => (ids.includes(r.id) ? { ...r, status, decidedAt } : r)));
  };

  const handleBulkApprove = () => {
    if (selectedPendingIds.size === 0) return;
    // Zelfde bevestigingspatroon als bulk-weigeren — goedkeuren was de enige
    // bulk-actie zónder bevestiging, terwijl juist dáár planningsconflicten
    // kunnen zitten. De telling maakt dat expliciet vóór de klik.
    const selected = leaveRequests.filter((r) => selectedPendingIds.has(r.id) && r.status === 'pending');
    const withConflicts = selected.filter((r) =>
      shiftsConflictingWithLeave(shifts, r).length > 0,
    ).length;
    setConfirmAction({
      title: 'Aanvragen goedkeuren',
      message: withConflicts > 0
        ? `${selected.length} aanvragen goedkeuren? Let op: ${withConflicts} ervan ${withConflicts === 1 ? 'heeft' : 'hebben'} al ingeplande diensten in die periode.`
        : `${selected.length} aanvragen goedkeuren?`,
      confirmText: 'Goedkeuren',
      variant: 'warning',
      run: () => { bulkDecide('approved'); setSelectedPendingIds(new Set()); },
    });
  };

  const handleBulkReject = () => {
    if (selectedPendingIds.size === 0) return;
    setConfirmAction({
      title: 'Aanvragen weigeren',
      message: `${selectedPendingIds.size} aanvragen weigeren? Dit kan niet ongedaan gemaakt worden.`,
      confirmText: 'Weigeren',
      variant: 'danger',
      run: () => { bulkDecide('rejected'); setSelectedPendingIds(new Set()); },
    });
  };

  const handleCancel = (requestId: string) => {
    const target = leaveRequests.find((r) => r.id === requestId);
    if (!target) return;
    const cancelledByOther = target.userId !== user.id;
    setConfirmAction({
      title: 'Verlof annuleren',
      message: cancelledByOther
        ? 'Deze goedgekeurde verlofaanvraag annuleren? De aanvrager ziet dit terug onder zijn historiek.'
        : 'Eigen verlofaanvraag annuleren?',
      confirmText: 'Annuleren',
      variant: 'danger',
      run: () => {
        if (onDecide) {
          void onDecide(requestId, 'cancelled');
          return;
        }
        const update: Partial<LeaveRequest> = { status: 'cancelled' };
        if (cancelledByOther) update.decidedAt = new Date().toISOString();
        void onSave(leaveRequests.map((r) => (r.id === requestId ? { ...r, ...update } : r)));
      },
    });
  };

  // Eigen nog-niet-besliste aanvraag intrekken (vergissing rechtzetten).
  // Mag alleen voor 'pending' — de aanvraag wordt volledig verwijderd, niet
  // op 'cancelled' gezet. Goedgekeurd verlof blijft via handleCancel
  // (planner/admin) zodat de rij-/rusttijden-check intact blijft.
  const handleWithdraw = (requestId: string) => {
    const target = leaveRequests.find((r) => r.id === requestId);
    if (!target || target.status !== 'pending') return;
    setConfirmAction({
      title: 'Aanvraag intrekken',
      message: 'Deze openstaande aanvraag intrekken? Ze wordt volledig verwijderd.',
      confirmText: 'Intrekken',
      variant: 'danger',
      run: () => {
        void (async () => {
          const ok = await Promise.resolve(onSave(leaveRequests.filter((r) => r.id !== requestId)));
          if (ok !== false) notify('Aanvraag ingetrokken.', 'success');
        })();
      },
    });
  };

  const initialLastSeen = useRef(lastSeenDecisionAt ?? null).current;
  const isNewlyDecided = (req: LeaveRequest) =>
    req.userId === user.id &&
    !!req.decidedAt &&
    req.status !== 'pending' &&
    (!initialLastSeen || req.decidedAt > initialLastSeen);

  useEffect(() => {
    if (!onMarkDecisionsSeen) return;
    const hasUnseen = myRequests.some(
      (r) => r.decidedAt && r.status !== 'pending' && (!initialLastSeen || r.decidedAt > initialLastSeen),
    );
    if (hasUnseen) onMarkDecisionsSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getRequestsForDate = (dateStr: string) =>
    verlofRequests.filter((r) => {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      const current = new Date(dateStr);
      if (r.status !== 'approved' || current < start || current > end) return false;
      const requester = users.find((u) => u.id === r.userId);
      const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
      const isMe = r.userId === user.id;
      if (isBeheerder && !isMe) return false;
      // De bezetting gaat over rijdend personeel: een technieker vraagt wel
      // verlof aan, maar telt niet mee in de limiet (Jarno 09-09).
      if (requester && !isRijdend(requester.role) && !isMe) return false;
      return true;
    });
  /** Bezetting van een dag voor de verloflimiet: de verlofrijen van die dag
   *  zonder de flexi-jobs (Jarno 14-09). Een flexi staat wél in de daglijst
   *  (hij is écht afwezig), maar maakt de dag niet voller: hij vult in en
   *  bezet geen vaste dienst. */
  const bezettingOp = (dateStr: string) => {
    // Niet-staf heeft de verlofrijen van anderen niet (privacy in GET
    // /api/leave) en gebruikt de aantallen van GET /api/leave/bezetting;
    // lokaal rekenen zou hier altijd op "Vrij" uitkomen.
    if (!isPlanner) return bezettingServer[dateStr] ?? 0;
    return getRequestsForDate(dateStr).filter((r) => {
      const requester = users.find((u) => u.id === r.userId);
      return !requester || teltInVerlofbezetting(requester);
    }).length;
  };

  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay();
  const monthName = viewMonth.toLocaleString('nl-BE', { month: 'long', year: 'numeric' });
  const calendarDays = [];
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  for (let i = 0; i < startOffset; i++) calendarDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) calendarDays.push(i);

  /** Beoordeling in het gedeelde DetailPaneel (src/components/VerlofBeoordeling.tsx):
   *  volledige context (saldo, dekking, conflicten, toelichting) + beslissing
   *  zonder paginawissel. Op desktop bovenaan de linkerkolom, op mobiel een
   *  SlideOver. De verlofkalender toont sinds punt 16 dezelfde beoordeling. */
  function renderBeoordelingPaneel() {
    return (
      <VerlofBeoordeling
        aanvraag={reviewLeave}
        users={users}
        shifts={shifts}
        leaveRequests={leaveRequests}
        limieten={limieten}
        today={today}
        isPlanner={isPlanner}
        onClose={() => setReviewLeave(null)}
        onDecide={(id, status, seenStatus) => { handleStatusUpdate(id, status, seenStatus); setReviewLeave(null); }}
        onCancel={handleCancel}
        onHistoriek={setHistoryLeave}
      />
    );
  }

  return (
    <PageShell className="pb-20">
      <PageHeader
        title="Verlof"
        description={isPlanner ? 'Beheer verlofaanvragen en bekijk de bezetting.' : 'Vraag verlof aan en volg je aanvragen op.'}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {user.role === 'admin' && (
              <>
                <Button variant="secondary" size="lg" icon={<CalendarOff size={18} />} onClick={() => setShowFeestdagenModal(true)}>
                  Feestdagen
                </Button>
                <Button variant="secondary" size="lg" icon={<SlidersHorizontal size={18} />} onClick={() => setShowLimietenModal(true)}>
                  Limieten
                </Button>
              </>
            )}
            {isPlanner && (
              <>
                <Button variant="secondary" size="lg" icon={<Users size={18} />} onClick={() => setShowSaldoModal(true)}>
                  Saldo's
                </Button>
                <Button variant="secondary" size="lg" icon={<ClipboardCheck size={18} />} onClick={openRegistratie}>
                  Verlof registreren
                </Button>
              </>
            )}
            <Button variant="primary" size="lg" icon={<Plus size={18} />} onClick={openAanvraag}>
              Verlof aanvragen
            </Button>
          </div>
        )}
      />

      {/* grid-cols-1 expliciet: de impliciete auto-track liet het breedste
          kind (een niet-krimpbare rij) de héle kolom oprekken, waardoor de
          kalender op mobiel rechts buiten beeld viel (melding Jarno 01-09).
          minmax(0,1fr) + min-w-0 klemt alles op de viewport. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="min-w-0 lg:col-span-8 space-y-6">
          {/* Beoordeling: op desktop een paneel bovenaan deze kolom (breed
              genoeg voor saldo, dekking en conflicten; scrolt in beeld bij
              openen), op mobiel een SlideOver. Alleen zichtbaar terwijl er
              een aanvraag open staat — een lege-staat-kaart boven de
              kalender zou ruis zijn. */}
          {renderBeoordelingPaneel()}
          <Card padding="lg" {...swipeHandlers}>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <MaandNavigatie label={monthName} labelClassName="text-lg font-bold tracking-tight min-w-[160px]" onVorige={goToPrevMonth} onVolgende={goToNextMonth}>
                {!isCurrentMonth && (
                  <Button variant="secondary" size="sm" className="ml-1" onClick={goToCurrentMonth}>
                    Vandaag
                  </Button>
                )}
              </MaandNavigatie>
              {/* Legende als stille chips — zelfde puntjes als in de dagcellen
                  (kleuren en titels: Jarno 08-09). */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="emerald" stil>Vrij</Badge>
                <Badge tone="amber" stil>Deels vrij</Badge>
                <Badge tone="red" stil>Volzet</Badge>
                {isPlanner && (
                  <span className="text-xs font-medium text-slate-500">
                    Limiet {limieten.standaard} tegelijk{limieten.periodes.length > 0 ? `, ${limieten.periodes.length} uitzonderingsperiode${limieten.periodes.length === 1 ? '' : 's'}` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-7 gap-3">
              {WEEKDAY_SHORT_MON.map((d) => <div key={d} className={cn(microLabelClass, 'text-center mb-2')}>{d}</div>)}
              {calendarDays.map((day, i) => {
                if (day === null) return <div key={`empty-${i}`} />;
                const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                const occupancyCount = bezettingOp(dateStr);
                const limiet = limietVoorDag(limieten, dateStr);
                const bezetting = bezettingVanDag(occupancyCount, limiet);
                const statusColor = bezetting === 'volzet' ? 'bg-red-500' : bezetting === 'deels' ? 'bg-amber-500' : 'bg-emerald-500';
                const isSelected = selectedDate === dateStr;
                const isInDraftRange = isDateWithinDraftRange(dateStr);
                const isDraftEdge = isDraftBoundary(dateStr);
                return (
                  // rauw: kalender-dagcel (eigen selectie-/bereik-stijl)
                  <button
                    key={day}
                    onClick={() => handleCalendarDateClick(dateStr)}
                    aria-label={`${day}: ${BEZETTING_LABEL[bezetting]}${occupancyCount > 0 ? `, ${occupancyCount} van ${limiet} afwezig` : ''}`}
                    className={cn(
                      'aspect-square rounded-2xl border transition-all flex flex-col items-center justify-center relative group',
                      isSelected && 'border-oker-500 bg-oker-50 ring-4 ring-oker-500/10',
                      !isSelected && !isInDraftRange && 'border-hairline-subtle hover:border-hairline bg-surface-white',
                      isInDraftRange && 'border-oker-200 bg-oker-50/70',
                      isDraftEdge && 'border-oker-500 bg-oker-100 ring-4 ring-oker-500/10'
                    )}
                  >
                    <span className={cn('text-sm font-semibold transition-colors', (isSelected || isInDraftRange) ? 'text-oker-700' : 'text-slate-500 group-hover:text-slate-600')}>{day}</span>
                    <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5', statusColor)} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </Card>

          {selectedDate && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card padding="lg">
                {/* Bewust geen CardHeader: die zet de aside op mobiel ónder de
                    titel, en een sluitknop hoort rechts naast de kop te blijven. */}
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-card-title">Verlof op {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })}</h3>
                  <IconButton label="Sluiten" variant="ghost" size="sm" onClick={() => setSelectedDate(null)}><X size={18} /></IconButton>
                </div>
                <div className="space-y-3">
                  {getRequestsForDate(selectedDate).length > 0 ? getRequestsForDate(selectedDate).map((req) => {
                    const requester = users.find((u) => u.id === req.userId);
                    return (
                      <Card key={req.id} tone="muted" padding="none" className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                        {/* rauw: rij-inhoud (naam + type + periode + chevron) als knop naast de snelle actie — opent het detailpaneel */}
                        <button
                          type="button"
                          onClick={() => setReviewLeave(req)}
                          className="group flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <Avatar naam={requester?.name ?? 'Onbekend'} size="lg" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-md font-semibold text-slate-800">{requester?.name}</p>
                            <p className="text-xs font-medium text-slate-500 tabular-nums">{formatLeaveType(req.type)} · {req.startDate} – {req.endDate}</p>
                          </div>
                          <ChevronRightSmall size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
                        </button>
                        {isPlanner && (
                          <Button variant="danger" size="sm" onClick={() => handleCancel(req.id)}>
                            Annuleren
                          </Button>
                        )}
                      </Card>
                    );
                  }) : <p className="text-center py-4 text-body-sm text-slate-500">Geen afwezigen op deze dag.</p>}
                </div>
              </Card>
            </motion.div>
          )}
        </div>

        <div className="min-w-0 lg:col-span-4 space-y-8">
          <div className="space-y-2">
            <LeaveBalanceCard balance={verlofBalans(leaveRequests, user.id, new Date().getFullYear(), user.verlofBudget)} year={new Date().getFullYear()} compact />
            {/* Nieuw tabblad: de print-modus rendert een kale pagina in plaats
                van de app (zelfde patroon als het maandrooster). Via
                openPdfInNewTab, niet via rauwe window.open — die geeft in
                iOS-standalone geregeld null terug, en dan deed deze knop
                niets. Dit is chauffeurs-facing, dus dat is een dood pad. */}
            <Button
              variant="secondary"
              size="md"
              full
              icon={<Printer size={14} />}
              onClick={() => openPdfInNewTab(`${window.location.origin}${window.location.pathname}?print-verlof-driver=${encodeURIComponent(user.id)}&print-verlof-jaar=${new Date().getFullYear()}`)}
            >
              Jaaroverzicht (PDF)
            </Button>
          </div>

          {isPlanner && (() => {
            const plannerPending = verlofRequests.filter((r) => {
              if (r.status !== 'pending') return false;
              const requester = users.find((u) => u.id === r.userId);
              const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
              const isMe = r.userId === user.id;
              if (isBeheerder && !isMe) return false;
              return true;
            });
            const allSelected = plannerPending.length > 0 && plannerPending.every((r) => selectedPendingIds.has(r.id));
            return (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <MicroLabel className="text-slate-500">Wachtend op goedkeuring</MicroLabel>
                  {plannerPending.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPendingIds(allSelected ? new Set() : new Set(plannerPending.map((r) => r.id)))}
                    >
                      {allSelected ? 'Deselecteer alles' : 'Selecteer alles'}
                    </Button>
                  )}
                </div>
                {selectedPendingIds.size > 0 && (
                  <Card tone="muted" padding="none" className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="text-xs font-semibold text-slate-700">
                      {selectedPendingIds.size} {selectedPendingIds.size === 1 ? 'aanvraag' : 'aanvragen'} geselecteerd
                    </span>
                    <div className="flex items-center gap-2">
                      <Button variant="danger" size="sm" onClick={handleBulkReject}>Weigeren ({selectedPendingIds.size})</Button>
                      <Button variant="success" size="sm" icon={<Check size={14} />} onClick={handleBulkApprove}>Goedkeuren ({selectedPendingIds.size})</Button>
                    </div>
                  </Card>
                )}
                <div className="space-y-1.5">
                  {plannerPending.length > 0 ? plannerPending.map((req) => {
                    const requester = users.find((u) => u.id === req.userId);
                    const isSelected = selectedPendingIds.has(req.id);
                    const conflictShifts = shiftsConflictingWithLeave(shifts, req);
                    return (
                      <div
                        key={req.id}
                        className={cn(
                          'group flex items-center gap-3 rounded-xl bg-surface-row ring-1 ring-hairline px-3.5 py-2.5 transition-all hover:bg-surface-row-hover hover:ring-hairline-strong hover:elev-1',
                          isSelected && 'ring-2 ring-oker-400/50',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePendingSelection(req.id)}
                          className="w-4 h-4 rounded border-hairline-strong text-oker-500 cursor-pointer shrink-0"
                          aria-label={`Selecteer ${requester?.name}`}
                        />
                        {/* rauw: rij-inhoud (naam + periode + chevron) als knop naast de checkbox — geen knopvorm */}
                        <button
                          type="button"
                          onClick={() => setReviewLeave(req)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <Avatar naam={requester?.name ?? 'Onbekend'} size="md" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-md font-semibold text-slate-800">{requester?.name ?? 'Onbekend'}</span>
                              {conflictShifts.length > 0 && (
                                <span title={`${conflictShifts.length} ingeplande dienst(en) in deze periode`} aria-label={`${conflictShifts.length} ingeplande dienst(en) in deze periode`}>
                                  <AlertTriangle size={14} className="shrink-0 text-red-500" />
                                </span>
                              )}
                            </span>
                            <span className="mt-px block truncate text-xs font-normal text-slate-500 tabular-nums">
                              {req.startDate}{req.startDate !== req.endDate ? ` → ${req.endDate}` : ''} · {formatLeaveType(req.type)}
                            </span>
                          </span>
                          <ChevronRightSmall size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
                        </button>
                      </div>
                    );
                  }) : (
                    <Card tone="success" padding="none" className="px-4 py-3.5">
                      <p className="text-md font-semibold text-slate-800">Alles beoordeeld</p>
                      <p className="text-xs font-normal text-slate-500">Geen openstaande verlofaanvragen.</p>
                    </Card>
                  )}
                </div>
              </div>
            );
          })()}

          <MyLeaveSection
            title="Mijn openstaande aanvragen"
            count={myPending.length}
            emptyText="Geen openstaande aanvragen."
            requests={myPending}
            isNew={isNewlyDecided}
            onWithdraw={handleWithdraw}
          />

          <MyLeaveSection
            title="Mijn geplande verloven"
            count={myUpcoming.length}
            emptyText="Geen goedgekeurd verlof gepland."
            requests={myUpcoming}
            isNew={isNewlyDecided}
            onCancel={isPlanner ? handleCancel : undefined}
          />

          <MyLeaveSection
            title="Mijn historiek"
            count={myHistory.length}
            emptyText="Nog geen afgehandelde aanvragen."
            requests={myHistory}
            isNew={isNewlyDecided}
          />
        </div>
      </div>

      {/* Gedeelde Modal i.p.v. eigen portal: ESC, backdrop-tap, safe-area en
          dvh-begrenzing (verbeterronde 29/07 #3). */}
      <Modal open={showRequestModal} onClose={() => setShowRequestModal(false)} maxWidth="md" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
              <ModalHeader
                title={registratie ? 'Verlof registreren' : 'Verlof aanvragen'}
                description={registratie ? 'Voor verlof dat al goedgekeurd is, bijvoorbeeld op papier. Wordt meteen als goedgekeurd vastgelegd, zonder mail naar de chauffeur.' : undefined}
                onClose={() => setShowRequestModal(false)}
              />
              <form onSubmit={handleRequestLeave} className="p-8 space-y-5 overflow-y-auto flex-1">
                {/* Alleen planner/admin: verlof registreren dat een chauffeur
                    mondeling of telefonisch doorgaf. Kiest de planner een
                    collega, dan is het meteen goedgekeurd (hij ís de
                    beoordelaar) en rekenen saldo én dienstconflicten hieronder
                    op díe chauffeur. */}
                {isPlanner && (
                  <Field label={registratie ? 'Chauffeur' : 'Voor wie'} error={voorWieFout || undefined}>
                    {({ id, invalid }) => (
                      <>
                        <Select
                          id={id}
                          value={voorWie}
                          invalid={invalid}
                          onChange={(e) => { setVoorWie(e.target.value); setVoorWieFout(''); }}
                        >
                          {registratie
                            ? <option value="">Kies een chauffeur…</option>
                            : <option value="">Mezelf ({user.name})</option>}
                          {users
                            .filter((u) => u.role === 'chauffeur' && u.isActive !== false && u.name.trim().toLowerCase() !== 'beheerder')
                            .sort((a, b) => a.name.localeCompare(b.name, 'nl'))
                            .map((u) => (
                              <option key={u.id} value={String(u.id)}>{u.name}</option>
                            ))}
                        </Select>
                        {namensIemandAnders && !registratie && (
                          <p className="text-xs font-medium text-oker-700">
                            Wordt meteen als goedgekeurd verlof vastgelegd, je hoeft het daarna niet nog eens te beoordelen.
                          </p>
                        )}
                      </>
                    )}
                  </Field>
                )}

                <Card tone="accent" padding="none" className="px-5 py-4 text-body-sm text-slate-600">
                  <MicroLabel className="text-oker-700">Periode kiezen</MicroLabel>
                  <p className="mt-2 font-medium">
                    {!formData.startDate
                      ? 'Klik op de startdatum.'
                      : !formData.endDate
                        ? 'Klik nu op de einddatum (of dezelfde dag voor één dag verlof).'
                        : 'Periode geselecteerd. Pas aan via “Periode wissen” of klik een nieuwe startdatum aan.'}
                  </p>
                </Card>

                <Card padding="sm" className="space-y-3" {...swipeHandlers}>
                  <MaandNavigatie className="justify-between" label={monthName} onVorige={goToPrevMonth} onVolgende={goToNextMonth} />
                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAY_SHORT_MON.map((d) => (
                      <div key={d} className={cn(microLabelClass, 'text-center py-1')}>{d}</div>
                    ))}
                    {calendarDays.map((day, i) => {
                      if (day === null) return <div key={`m-empty-${i}`} />;
                      const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                      const inRange = isDateWithinDraftRange(dateStr);
                      const edge = isDraftBoundary(dateStr);
                      const isToday = dateStr === today;
                      // Verleden alleen dicht voor een eigen aanvraag; wie
                      // namens een chauffeur registreert boekt ook achteraf.
                      const isPast = dateStr < today && !magVerleden;
                      return (
                        // rauw: kalender-dagcel in de datumkiezer (eigen bereik-/randstijl)
                        <button
                          key={day}
                          type="button"
                          disabled={isPast}
                          title={isPast ? 'Je kan geen verlof aanvragen in het verleden.' : undefined}
                          onClick={() => handleCalendarDateClick(dateStr)}
                          className={cn(
                            'aspect-square rounded-xl text-xs font-semibold transition-colors flex items-center justify-center',
                            isPast && 'text-slate-300 cursor-not-allowed',
                            !isPast && !inRange && !edge && 'text-slate-500 hover:bg-oker-50',
                            !isPast && inRange && !edge && 'bg-oker-100 text-oker-700',
                            !isPast && edge && 'bg-oker-500 text-slate-950 elev-accent',
                            !isPast && isToday && !inRange && !edge && 'ring-1 ring-oker-300',
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </Card>
                {/* Gekozen periode als selectieweergave, geen (nep-)invoervelden:
                    de datums komen uit de kalender hierboven. De aria-labels
                    "Startdatum"/"Einddatum" + data-datum zijn contract met
                    e2e/verlof.spec.ts. Fout bij het veld (fase C15). */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-label">Gekozen periode</span>
                    {(formData.startDate || formData.endDate) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<X size={14} />}
                        onClick={() => { setPeriodeFout(''); setFormData((current) => ({ ...current, startDate: '', endDate: '' })); }}
                      >
                        Periode wissen
                      </Button>
                    )}
                  </div>
                  <div role="group" aria-label="Gekozen periode" className="grid grid-cols-2 gap-3">
                    <PeriodeVak label="Van" naam="Startdatum" iso={formData.startDate} actief={!formData.startDate} fout={!!periodeFout} />
                    <PeriodeVak label="Tot" naam="Einddatum" iso={formData.endDate} actief={!!formData.startDate && !formData.endDate} fout={!!periodeFout} />
                  </div>
                  {periodeFout ? (
                    <p role="alert" className="text-xs font-medium text-red-700">{periodeFout}</p>
                  ) : (
                    <p className="text-xs text-slate-500">Kies de dagen in de kalender, dezelfde dag twee keer voor één dag verlof.</p>
                  )}
                </div>
                <Field label="Type verlof">
                  {({ id }) => (
                    <Select id={id} value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value as LeaveRequest['type'] })}>
                      <option value="betaald_verlof">Betaald verlof</option>
                      <option value="klein_verlet">Klein verlet</option>
                    </Select>
                  )}
                </Field>
                <Field label="Opmerking">
                  {({ id }) => (
                    <Textarea
                      id={id}
                      value={formData.comment}
                      onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                      onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250)}
                      className="h-24"
                      placeholder="Optionele toelichting…"
                    />
                  )}
                </Field>

                {/* Live impact-preview: budget + shift-conflicten */}
                {requestPreview && (
                  <div className="space-y-2">
                    {/* Budget-saldo */}
                    {formData.type === 'betaald_verlof' && (
                      <Card
                        tone={requestPreview.wouldExceed ? 'danger' : 'success'}
                        padding="none"
                        className={cn('px-4 py-3 text-xs font-medium', requestPreview.wouldExceed ? 'text-red-700' : 'text-emerald-700')}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">
                            {requestPreview.requestedDays} {requestPreview.requestedDays === 1 ? 'verlofdag' : 'verlofdagen'} {registratie ? 'vast te leggen' : 'aangevraagd'}
                          </span>
                          <span className="font-bold tabular-nums">
                            {requestPreview.gebruikt + requestPreview.requestedDays} / {requestPreview.budget}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-medium opacity-90">
                          {requestPreview.wouldExceed
                            ? `⚠ ${Math.abs(requestPreview.remainingAfter)} ${Math.abs(requestPreview.remainingAfter) === 1 ? 'dag' : 'dagen'} boven ${namensIemandAnders ? 'het' : 'je'} jaarbudget.${registratie ? ' Controleer het papier.' : namensIemandAnders ? '' : ' Planner moet beoordelen.'}`
                            : `${requestPreview.remainingAfter} ${requestPreview.remainingAfter === 1 ? 'dag' : 'dagen'} resterend na deze ${registratie ? 'periode' : 'aanvraag'}.`}
                          {bevatVrijeDag(formData.startDate, formData.endDate) ? ' Zondagen en feestdagen tellen niet mee.' : ''}
                        </p>
                      </Card>
                    )}

                    {/* Verloflimiet: op welke dagen zijn er dan te veel chauffeurs tegelijk vrij? */}
                    {requestPreview.bovenLimiet.length > 0 && (
                      <Card tone="warning" padding="none" className="px-4 py-3 text-xs font-medium text-amber-800">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span className="font-semibold">
                            Boven de verloflimiet op {requestPreview.bovenLimiet.length} {requestPreview.bovenLimiet.length === 1 ? 'dag' : 'dagen'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-medium opacity-90">
                          {requestPreview.bovenLimiet.slice(0, 3).map((d) => `${formatShortDay(d.dag)}: ${d.afwezig} van ${d.limiet}`).join(', ')}{requestPreview.bovenLimiet.length > 3 ? ', …' : ''}.{registratie ? ' Het staat al op papier, dus je kan het gewoon vastleggen.' : ''}
                        </p>
                      </Card>
                    )}

                    {/* Shift-conflict */}
                    {requestPreview.conflictingShifts.length > 0 && (
                      <Card tone="warning" padding="none" className="px-4 py-3 text-xs font-medium text-amber-800">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span className="font-semibold">
                            {requestPreview.conflictingShifts.length}{' '}
                            {requestPreview.conflictingShifts.length === 1 ? 'dienst staat' : 'diensten staan'} al ingepland in deze periode
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-medium opacity-90">
                          De planner herverdeelt deze bij goedkeuring.
                        </p>
                      </Card>
                    )}
                  </div>
                )}

                {/* Registratie: wat staat er al voor deze chauffeur in het jaar
                    van de getoonde maand? Zo vergelijk je meteen met het papier. */}
                {registratie && voorWie && (() => {
                  const jaar = viewMonth.getFullYear();
                  const doel = users.find((u) => String(u.id) === voorWie);
                  const balans = verlofBalans(leaveRequests, voorWie, jaar, doel?.verlofBudget);
                  const vast = verlofRequests
                    .filter((r) => String(r.userId) === voorWie && r.status === 'approved' && r.startDate <= `${jaar}-12-31` && r.endDate >= `${jaar}-01-01`)
                    .sort((a, b) => a.startDate.localeCompare(b.startDate));
                  return (
                    <Card tone="muted" padding="sm" className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <MicroLabel className="text-slate-500">Al vastgelegd in {jaar}</MicroLabel>
                        <span className="text-xs font-semibold tabular-nums text-slate-700">
                          {balans.betaaldGebruikt} / {balans.betaaldBudget} betaald{balans.kleinVerletDagen > 0 ? ` · ${balans.kleinVerletDagen} klein verlet` : ''}
                        </span>
                      </div>
                      {vast.length === 0 ? (
                        <p className="text-xs text-slate-500">Nog niets voor {doel?.name ?? 'deze chauffeur'} in {jaar}.</p>
                      ) : (
                        <ul className="space-y-1">
                          {vast.map((r) => (
                            <li key={r.id} className="flex items-center justify-between gap-3 text-xs">
                              <span className="tabular-nums text-slate-700">
                                {r.startDate === r.endDate ? formatShortDay(r.startDate) : `${formatShortDay(r.startDate)} tot ${formatShortDay(r.endDate)}`}
                                <span className="ml-1.5 text-slate-500">({verlofDagen(r.startDate, r.endDate)} {verlofDagen(r.startDate, r.endDate) === 1 ? 'dag' : 'dagen'})</span>
                              </span>
                              <Badge tone={r.type === 'betaald_verlof' ? 'oker' : 'slate'} stil>{formatLeaveType(r.type)}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  );
                })()}

                <div className="space-y-2">
                  <Button type="submit" variant="primary" size="lg" full disabled={!formData.startDate || !formData.endDate || isSubmitting}>
                    {isSubmitting ? (registratie ? 'Vastleggen…' : 'Versturen…') : registratie ? 'Vastleggen' : 'Aanvraag indienen'}
                  </Button>
                  {registratie && (
                    <Button variant="secondary" size="lg" full onClick={() => { setShowRequestModal(false); setVoorWie(''); }}>Klaar</Button>
                  )}
                  {/* Reden waarom de knop nog uit staat — anders lijkt hij kapot. */}
                  {(!formData.startDate || !formData.endDate) && !periodeFout && (
                    <p className="text-center text-xs text-slate-500">
                      {!formData.startDate ? 'Kies eerst een startdatum in de kalender.' : 'Kies nu de einddatum in de kalender.'}
                    </p>
                  )}
                </div>
              </form>
      </Modal>

      {isPlanner && (
        <VerlofSaldoModal open={showSaldoModal} onClose={() => setShowSaldoModal(false)} users={users} leaveRequests={leaveRequests} />
      )}
      {user.role === 'admin' && (
        <>
          <VerlofLimietenModal open={showLimietenModal} onClose={() => setShowLimietenModal(false)} limieten={limieten} onSaved={setLimieten} />
          <VerlofFeestdagenModal open={showFeestdagenModal} onClose={() => setShowFeestdagenModal(false)} extra={feestdagenExtra} onSaved={(extra) => onFeestdagenSaved?.(extra)} />
        </>
      )}

      <EntityHistoryModal
        open={!!historyLeave}
        onClose={() => setHistoryLeave(null)}
        entityType="leave"
        entityId={historyLeave?.id ?? ''}
        title={historyLeave ? `${users.find((u) => u.id === historyLeave.userId)?.name || 'Onbekend'}, ${historyLeave.startDate} t/m ${historyLeave.endDate}` : undefined}
      />

      <ConfirmationModal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => { confirmAction?.run(); setConfirmAction(null); }}
        title={confirmAction?.title ?? ''}
        message={confirmAction?.message ?? ''}
        confirmText={confirmAction?.confirmText ?? 'Bevestigen'}
        variant={confirmAction?.variant ?? 'warning'}
      />
    </PageShell>
  );

}

/** Eén helft van de "Van — Tot"-selectieweergave in de aanvraag-modal.
 *  Geen input: de waarde komt uit de kalender. `naam` is de toegankelijke
 *  naam (aria-label), `data-datum` de ISO-datum voor tests. */
function PeriodeVak({ label, naam, iso, actief, fout }: { label: string; naam: string; iso: string; actief: boolean; fout: boolean }) {
  return (
    <div
      aria-label={naam}
      data-datum={iso || undefined}
      className={cn(
        'min-h-11 rounded-xl border px-3.5 py-2',
        fout ? 'border-red-300 bg-red-50' : iso ? 'border-oker-200 bg-oker-50' : actief ? 'border-dashed border-oker-300 bg-surface-white' : 'border-dashed border-hairline bg-surface-soft',
      )}
    >
      <span className="text-micro">{label}</span>
      <span className={cn('mt-0.5 block text-sm font-semibold tabular-nums', iso ? 'text-slate-900' : 'text-slate-500')}>
        {iso ? formatShortDay(iso) : actief ? 'Kies in de kalender' : '—'}
      </span>
    </div>
  );
}

function MyLeaveSection({ title, count, emptyText, requests, isNew, onCancel, onWithdraw }: { title: string; count: number; emptyText: string; requests: LeaveRequest[]; isNew?: (r: LeaveRequest) => boolean; onCancel?: (id: string) => void; onWithdraw?: (id: string) => void }) {
  // Compacte, uitklapbare rijen in een eigen scrollcontainer: de historiek
  // groeit onbegrensd mee, dus de dichte kaarten werden onoverzichtelijk
  // (wens Jarno). Dicht = periode + status; open = de details + acties.
  const [openIds, setOpenIds] = useState<string[]>([]);
  const toggle = (id: string) => setOpenIds((cur) => (
    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  ));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <MicroLabel className="text-slate-500">{title}</MicroLabel>
        <MicroLabel>{count}</MicroLabel>
      </div>
      <div className="max-h-[420px] overflow-y-auto overscroll-contain space-y-2 -mx-1 px-1">
        {requests.length > 0 ? requests.map((req) => {
          const fresh = isNew?.(req) ?? false;
          const open = openIds.includes(req.id);
          return (
            <Card key={req.id} padding="none" className={cn('relative overflow-hidden', fresh && 'ring-2 ring-oker-400/40')}>
              <div className={cn('absolute top-0 left-0 w-1 h-full', statusAccentClass(req.status))} />
              {/* rauw: uitklapbare kaartkop (periode + type + status + chevron) — hele rij klikbaar */}
              <button
                type="button"
                onClick={() => toggle(req.id)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-3 p-3.5 pl-4 text-left"
              >
                <div className="min-w-0 flex items-baseline gap-2.5">
                  <span className="text-md font-semibold text-slate-900 whitespace-nowrap">{new Date(`${req.startDate}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} – {new Date(`${req.endDate}T00:00:00`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}</span>
                  <span className="text-xs font-medium text-slate-500 truncate">{formatLeaveType(req.type)}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {fresh && <Badge tone="oker">Nieuw</Badge>}
                  <StatusBadge status={req.status} stil />

                  <ChevronDown size={16} className={uitklapChevron(open, 180, 'text-slate-400')} />
                </div>
              </button>
              <Uitklap open={open}>
                <div className="px-4 pb-4 pt-0.5">
                  <p className="text-xs font-medium text-slate-500">Aangevraagd op {formatDateHuman(req.createdAt)}</p>
                  {req.comment && <p className="text-xs text-slate-500 italic mt-2">"{req.comment}"</p>}
                  {onCancel && req.status === 'approved' && (
                    <Button variant="danger" size="sm" full className="mt-3" onClick={() => onCancel(req.id)}>
                      Verlof annuleren
                    </Button>
                  )}
                  {onWithdraw && req.status === 'pending' && (
                    <Button variant="secondary" size="sm" full className="mt-3" onClick={() => onWithdraw(req.id)}>
                      Aanvraag intrekken
                    </Button>
                  )}
                </div>
              </Uitklap>
            </Card>
          );
        }) : (
          <Card padding="md" className="text-center">
            <p className="text-body-sm font-medium text-slate-500">{emptyText}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
