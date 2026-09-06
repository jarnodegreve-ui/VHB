import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bus,
  CalendarClock,
  CalendarCog,
  CalendarDays,
  IdCard,
  Inbox,
  KeyRound,
  MapPin,
  Phone,
  Plus,
  Repeat,
  Settings,
  CheckCircle2,
  UserCheck,
  UserX,
  Users,
  Smartphone,
  Zap,
} from 'lucide-react';
import { EXPIRY_SOORT_LABELS, formatDayLong, formatShortDay, serviceNumberOf, metEenheid } from '../lib/format';
import type { ActivityLogEntry, LeaveRequest, Shift, User, View } from '../types';
import { useAppDataContext } from '../app/AppDataContext';
import { getDaypartGreeting } from '../lib/interactive';
import { addDays, isoDate, openstaandeDienstenVanAfwezigen, type OpenstaandeDienst } from '../lib/availability';
import { berekenWerkvoorraad } from '../lib/werkvoorraad';
import { kandidaatLabel, rangschikKandidaten, vrijOpDatum, werkdagenUitShifts } from '../lib/vervangers';
import { activeDiversions as activeDiversionsOf } from '../lib/diversions';
import { formatRemaining, formatStartsIn, isShiftActiveAt, isValidBusvakTime, minutesUntilShiftEnd, minutesUntilShiftStart } from '../lib/shiftTime';
import { fetchMonthPlanning } from '../lib/monthPlanning';
import { apiFetch, apiJson } from '../lib/api';
import { Skeleton, SkeletonRow, SkeletonTile } from '../components/Skeleton';
import { Modal } from '../components/Modal';
import { EmptyState, ModalHeader } from '../components/ui';
import { ServiceChip } from '../components/ServiceChip';
import { OpsPanel, OpsRow, OpsStat, relTime } from '../components/ops';
import { Button, Chip, microLabelClass, segItemClass } from '../components/primitives';
import { Card } from '../components/Card';
import { DateInput, Field, Select, Textarea } from '../components/Field';
import { cn, notify, telHref } from '../lib/ui';

/**
 * Operations Center — het planner/admin-dashboard als operationele cockpit.
 *
 * Eén scherm beantwoordt: wie rijdt er, wat staat er open, wat vraagt
 * aandacht en wat is de actuele status van de operatie. Alle cijfers komen
 * uit echte portaaldata (planning, dekking, verlof, ruilen, imports,
 * omleidingen, activiteit) — niets is decoratief.
 */
export function PlannerDashboardWidgets({
  currentUser,
  onNavigate,
}: {
  currentUser: User;
  onNavigate: (view: View) => void;
}) {
  // Alles wat uit de datalaag komt, leest de cockpit zelf uit de context:
  // de collecties, de dekking (null = nog niet geladen → 'onbekend' i.p.v.
  // vals-groen), vervaldata + wachtende toestellen (gefetcht in de datalaag
  // omdat de werkvoorraad-knop op elk scherm staat), de ziekmelding (woont
  // hier i.p.v. in de verlofview, zie de toelichting bij LeaveManagementView)
  // en de fetchers om na een dienstwissel te verversen.
  const {
    users, shifts, diversions, updates, leaveRequests, swaps,
    planningMatrixHistory: matrixHistory, activityLog, coverageDays, vervaldata, pendingDevices,
    isInitialLoad, reportSick: onSickReport,
    fetchPlanning, fetchSwaps, refreshCoverageGaps,
  } = useAppDataContext();
  /** Wissel vanuit de ziekmeld-flow: planning, ruilen en dekking meteen mee
   *  verversen zodat het dashboard niet een oude "nog te herverdelen"-rij
   *  blijft tonen. */
  const onShiftSwapped = async () => {
    await Promise.all([
      // Planner/admin-scherm: altijd de volledige planning.
      fetchPlanning(undefined, undefined, { silent: true }),
      fetchSwaps(),
      refreshCoverageGaps(),
    ]);
  };
  // Klok voor de header (60s-tick is ruim voldoende voor een dagdeel-groet).
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Afwezigheden uit de planning-matrix (Excel-codes bv/ziek/ta/tk…): de
  // verlof-module kent alleen aanvragen die vía het portaal liepen, dus
  // "Vandaag afwezig" stond onterecht op 0 wanneer het verlof alleen in de
  // geïmporteerde matrix zat. Fout → stil terugvallen op de module-data.
  const todayKey = isoDate(now);
  // Vandaag | Morgen: de bezetting-tegels en hun popups kunnen vooruitkijken
  // — 's avonds plan je voor de volgende dag (verbeterronde 01-09, nr. 1).
  // Alles wat live of werkvoorraad is (Chauffeurs actief, Open taken,
  // ziekmelden) blijft altijd op vandaag/nu.
  const [dagOffset, setDagOffset] = useState<0 | 1>(0);
  const peilDag = isoDate(addDays(now, dagOffset));
  const peilLabel = dagOffset === 0 ? 'Vandaag' : 'Morgen';
  // `absent` voedt de tegel/popup "Vandaag afwezig"; `busyNames` is breder — élke
  // matrix-cel van vandaag die géén vrije dag is (opleiding, een dienst zonder
  // bruikbare tijden, onbekende code…). Zonder dat onderscheid gold "niet in
  // de planning én niet als afwezig gemeld" als beschikbaar, waardoor iemand
  // in opleiding als inzetbare vervanger verscheen.
  const [matrix, setMatrix] = useState<{
    absent: { name: string; label: string; isSick: boolean }[];
    busyNames: string[];
  }>({ absent: [], busyNames: [] });
  const matrixAbsent = matrix.absent;
  // Popups bij de tegels: wie is er vandaag vrij ("Beschikbaar"), wie is
  // er ingepland met welke dienst ("Vandaag ingepland") en wie rijdt er
  // op dit moment ("Chauffeurs actief").
  const [showAvailable, setShowAvailable] = useState(false);
  const [showAbsent, setShowAbsent] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  const [showDriving, setShowDriving] = useState(false);
  // Laadplein-samenvatting voor de tegel "Aan de lader". Best-effort: faalt
  // de fetch (OCPI niet geconfigureerd, storing), dan verdwijnt de tegel
  // gewoon — het dashboard mag er nooit op wachten of door breken.
  const [laadplein, setLaadplein] = useState<{ evses: number; charging: number; outOfOrder: number; totalPowerKw: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const haal = () => {
      apiJson<{ evses: number; charging: number; outOfOrder: number; totalPowerKw: number }>('/api/ocpi/summary')
        .then((sum) => { if (!cancelled && sum && sum.evses > 0) setLaadplein(sum); })
        .catch(() => { /* geen OCPI = geen tegel */ });
    };
    haal();
    // Elke 5 min verversen: het dashboard staat vaak de hele dag open en de
    // tegel toonde anders de laadstand van 's ochtends.
    const timer = window.setInterval(haal, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [todayKey]);
  useEffect(() => {
    let cancelled = false;
    // Peildag i.p.v. vandaag: de Vandaag|Morgen-schakelaar kijkt naar de
    // matrixcellen van de gekozen dag (morgen kan in de volgende maand vallen).
    fetchMonthPlanning(peilDag.slice(0, 7))
      .then((mp) => {
        if (cancelled || !Array.isArray(mp?.drivers)) return;
        const cells = mp.drivers
          .map((drv) => ({ drv, cell: mp.cells?.[drv.id]?.[peilDag] }))
          .filter((x) => !!x.cell);
        // "Geen dienst" = een gewone vrije dag, geen afwezigheid — die
        // hoort niet in dit paneel (Jarno) en telt wél als beschikbaar.
        const isFreeDay = (label: string) => /geen dienst/i.test(label);
        setMatrix({
          absent: cells
            .filter((x) => (x.cell!.kind === 'leave' || x.cell!.kind === 'absence') && !isFreeDay(x.cell!.label))
            .map(({ drv, cell }) => ({
              name: drv.name,
              label: cell!.label || (cell!.kind === 'leave' ? 'Verlof' : 'Afwezig'),
              isSick: /ziek/i.test(cell!.code) || /ziek/i.test(cell!.label),
            })),
          busyNames: cells.filter((x) => !isFreeDay(x.cell!.label)).map((x) => x.drv.name),
        });
      })
      // Bij een fout niets laten staan van een vorige dag/fetch: verouderde
      // afwezigheden zouden anders iemand blijven wegfilteren uit
      // "Beschikbaar" (en als afwezige blijven tonen).
      .catch(() => {
        if (!cancelled) setMatrix({ absent: [], busyNames: [] });
      });
    return () => { cancelled = true; };
  }, [peilDag]);

  // Ziekmelding registreren (planner/admin). Komt telefonisch binnen, dus de
  // planner moet hem vanuit de cockpit kunnen invoeren zonder van scherm te
  // wisselen. De server maakt er een direct goedgekeurd 'ziekte'-verlof van.
  const [showSickModal, setShowSickModal] = useState(false);
  // Focus-herstel doet de Modal zelf (previouslyFocused in Modal.tsx) —
  // een eigen .focus() hier vocht daarmee en kon op een tussenliggende
  // renderstap de verkeerde knop pakken.
  const sickTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [sickForm, setSickForm] = useState({ userId: '', startDate: '', endDate: '', comment: '' });
  const [isSubmittingSick, setIsSubmittingSick] = useState(false);
  // Validatiefouten per veld (fase C15): bij het veld, niet onderaan of in
  // een toast. Server-/netwerkfouten blijven via onSickReport → notify.
  const [sickFouten, setSickFouten] = useState<{ userId?: string; endDate?: string }>({});
  // Stap 2 van de ziekmelding: de diensten die door de melding onbemand
  // achterblijven, meteen kunnen overzetten. Dít is de volgorde waarin het
  // echt gebeurt (chauffeur belt → registreren → wie rijdt het dan?), en het
  // scheelt een schermwissel op het drukste moment. De wissel zelf is
  // admin-only (POST /api/admin/shift-swap), planners zien alleen de lijst.
  const [ziekVervolg, setZiekVervolg] = useState<{ naam: string; diensten: OpenstaandeDienst[] } | null>(null);
  const [vervangerPerDienst, setVervangerPerDienst] = useState<Record<string, string>>({});
  const [wisselBezig, setWisselBezig] = useState<string | null>(null);
  const [afgehandeld, setAfgehandeld] = useState<Record<string, string>>({});
  const closeSickModal = () => { setShowSickModal(false); setZiekVervolg(null); setVervangerPerDienst({}); setAfgehandeld({}); };

  // LET OP: geen hooks meer onder deze regel — de skeleton-return hieronder
  // betekent dat álle hooks vóór dit punt moeten staan (React #310).
  if (isInitialLoad) {
    return (
      <section className="space-y-5">
        <div className="px-1 pt-1 space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card padding="md" className="lg:col-span-2">
            <SkeletonRow /><SkeletonRow /><SkeletonRow />
          </Card>
          <Card padding="md">
            <SkeletonRow /><SkeletonRow />
          </Card>
        </div>
      </section>
    );
  }

  const today = isoDate(now);
  const firstName = currentUser.name.split(' ')[0];
  const greeting = getDaypartGreeting(now);
  const isAdmin = currentUser.role === 'admin';

  // Goedgekeurde afwezigheid, getoetst per DIENSTDAG (niet per kalender-
  // vandaag): wie om 01:30 nog de nachtdienst van gisteren rijdt maar pas
  // vanaf vandaag ziek gemeld is, rijdt op dat moment gewoon — de dienstdag
  // (gisteren) valt buiten de ziekteperiode. Ziekte wint bij overlappende
  // records (verlof mag een ziekmelding nooit maskeren); kapotte of
  // omgekeerde datums tellen niet mee. Zelfde regels als afwezigOp op de
  // server. Stuurt het label in "Vandaag ingepland", het wegfilteren uit
  // "Chauffeurs actief" en de afwezig-tegel verderop.
  const ABSENCE_LABEL: Record<string, string> = { betaald_verlof: 'Verlof', klein_verlet: 'Klein verlet', ziekte: 'Ziek' };
  const ABSENCE_TONE: Record<string, AftelTone> = { ziekte: 'ziek', betaald_verlof: 'verlof', klein_verlet: 'verlet' };
  const isoDagRe = /^\d{4}-\d{2}-\d{2}$/;
  const afwezigOpDag = (driverId: string, date: string): { label: string; tone: AftelTone; isSick: boolean } | null => {
    let gevonden: { label: string; tone: AftelTone; isSick: boolean } | null = null;
    for (const l of leaveRequests) {
      if (l.status !== 'approved' || String(l.userId) !== driverId) continue;
      if (!isoDagRe.test(l.startDate) || !isoDagRe.test(l.endDate) || l.startDate > l.endDate) continue;
      if (l.startDate <= date && date <= l.endDate) {
        const kandidaat = { label: ABSENCE_LABEL[l.type] ?? l.type, tone: ABSENCE_TONE[l.type] ?? ('verlof' as AftelTone), isSick: l.type === 'ziekte' };
        if (kandidaat.isSick) return kandidaat;
        gevonden = kandidaat;
      }
    }
    return gevonden;
  };

  // === Operationele kerncijfers (alles uit echte data; de bezetting volgt
  // de Vandaag|Morgen-peildag, live cijfers blijven op nu) ===
  const ingeplandeIds = new Set(shifts.filter((s) => s.date === peilDag).map((s) => String(s.driverId)));
  const driversActiveToday = ingeplandeIds.size;
  // Hoeveel van de ingeplanden zijn intussen afwezig gemeld? De tegel telt ze
  // bewust mee in het hoofdcijfer (ze stáán ingepland; de popup labelt ze),
  // maar de sub-regel maakt het gat meteen zichtbaar — anders las "30 / 45"
  // alsof er niets aan de hand was terwijl er drie ziek thuis zitten.
  const ingeplandAfwezig = [...ingeplandeIds].filter((id) => afwezigOpDag(id, peilDag)).length;
  // Wie zit er nú effectief op de bus? Actuele tijd vs. de segmenttijden
  // (incl. nachtdiensten van gisteren die nog lopen); de 60s-klok hierboven
  // houdt dit cijfer live. Gesplitste diensten: pauze telt niet mee, en wie
  // vandaag afwezig gemeld is telt níét als rijdend.
  const driversDrivingNow = new Set(
    shifts
      .filter((s) => isShiftActiveAt(s, now) && !afwezigOpDag(String(s.driverId), s.date))
      .map((s) => String(s.driverId)),
  ).size;
  // Noemer van "Vandaag ingepland X / N": alleen inzetbare chauffeurs, zelfde
  // afbakening als /api/availability en de Beschikbaar-tegel — anders telt
  // "ingepland + beschikbaar" zichtbaar niet op tot N.
  const isRealDriver = (u: User) =>
    u.role === 'chauffeur' && u.isActive !== false && u.name.trim().toLowerCase() !== 'beheerder';
  const totalDrivers = users.filter(isRealDriver).length;

  // Werkvoorraad — gedeelde berekening met de topbar-knop (lib/werkvoorraad):
  // één bron van waarheid voor de teller, de rijen in 'Open taken' en de
  // empty-state. Alles wat als rij verschijnt telt mee — niets anders.
  // (Omleidingen tellen bewust niet mee: informatief, geen openstaande taak.)
  const {
    planningStale, daysSinceImport, lastImport, importIssueCount,
    planningHorizon, horizonDagenOver, horizonKrap,
    gapDays, vervalTaken, herverdeelPerChauffeur,
    pendingLeave, pendingSwaps, attentionCount,
  } = berekenWerkvoorraad({ users, shifts, leaveRequests, swaps, matrixHistory, coverageDays, vervaldata, pendingDevices, now });

  // Verlopen omleidingen (einddatum in het verleden) tellen niet mee: de
  // tegel zegt "actieve omleidingen" en moet dat dan ook zijn (gedeelde
  // helper — chauffeursdashboard gebruikt dezelfde).
  const activeDiversions = activeDiversionsOf(diversions).length;

  const werkdagen = werkdagenUitShifts(shifts);

  /** Dienst uit de ziekmeld-vervolgstap overzetten naar de gekozen collega. */
  const zetDienstOver = async (d: OpenstaandeDienst) => {
    const naarId = vervangerPerDienst[d.id];
    if (!naarId || wisselBezig) return;
    setWisselBezig(d.id);
    try {
      const res = await apiFetch('/api/admin/shift-swap', {
        method: 'POST',
        body: JSON.stringify({
          date: d.date,
          line: serviceNumberOf(d),
          fromDriverId: String(d.driverId),
          toDriverId: naarId,
          reason: d.reden,
        }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) { notify(body.error || 'Overzetten is mislukt.', 'error'); return; }
      setAfgehandeld((cur) => ({ ...cur, [d.id]: userNameById(naarId) }));
      await onShiftSwapped();
    } catch {
      notify('Overzetten is mislukt — controleer je verbinding en probeer opnieuw.', 'error');
    } finally {
      setWisselBezig(null);
    }
  };

  // Het paneel toont per soort een top-N (3 dekkingsdagen, 4 verlof, 4 ruil,
  // 3 toestellen); dit is wat daarbuiten valt, zodat de teller in de kop
  // eerlijk blijft.
  const hiddenAttentionCount =
    // Rijen zijn per chauffeur; wat niet getoond wordt is het werk van de
    // chauffeurs buiten de top-3 (niet de diensten binnen een getoonde rij —
    // die staan er met hun totaal bij).
    herverdeelPerChauffeur.slice(3).reduce((n, g) => n + g.diensten.length, 0) +
    Math.max(0, vervalTaken.length - 3) +
    Math.max(0, gapDays.length - 3) +
    Math.max(0, pendingLeave.length - 4) +
    Math.max(0, pendingSwaps.length - 4) +
    Math.max(0, pendingDevices.length - 3);
  const userNameById = (id: string) =>
    users.find((u) => String(u.id) === String(id))?.name || 'Onbekend';

  // Wie is er vandaag afwezig? Twee bronnen: goedgekeurde aanvragen uit de
  // verlof-module + de afwezigheidscodes uit de geïmporteerde matrix
  // (gededuped op naam — module-aanvraag wint, die heeft het rijkere label).
  // Zelfde regels als afwezigOpDag: kapotte/omgekeerde datums tellen niet
  // mee, en per collega wint ziekte — de popup ernaast deed dat al, deze
  // tegel liep nog op de oude losse filter.
  const moduleAbsentByUser = new Map<string, { id: string; name: string; label: string; isSick: boolean }>();
  for (const l of leaveRequests) {
    if (l.status !== 'approved') continue;
    if (!isoDagRe.test(l.startDate) || !isoDagRe.test(l.endDate) || l.startDate > l.endDate) continue;
    if (!(l.startDate <= peilDag && peilDag <= l.endDate)) continue;
    const kandidaat = { id: l.id, name: userNameById(l.userId), label: ABSENCE_LABEL[l.type] ?? l.type, isSick: l.type === 'ziekte' };
    const bestaand = moduleAbsentByUser.get(String(l.userId));
    if (!bestaand || (kandidaat.isSick && !bestaand.isSick)) moduleAbsentByUser.set(String(l.userId), kandidaat);
  }
  const moduleAbsent = [...moduleAbsentByUser.values()];
  const seenNames = new Set(moduleAbsent.map((a) => a.name.trim().toLowerCase()));
  const todayAbsent = [
    ...moduleAbsent,
    ...matrixAbsent
      .filter((m) => !seenNames.has(m.name.trim().toLowerCase()))
      .map((m, i) => ({ id: `matrix-${i}`, ...m })),
  ].sort((a, b) => {
    // Eerst op soort afwezigheid (ziek bovenaan — daar moet de planner op
    // reageren; daarna de overige soorten alfabetisch), binnen elke soort
    // op naam (verzoek Jarno 30/07).
    if (a.isSick !== b.isSick) return a.isSick ? -1 : 1;
    const byLabel = a.label.localeCompare(b.label, 'nl');
    if (byLabel !== 0) return byLabel;
    return a.name.localeCompare(b.name, 'nl');
  });

  // Wie is er vandaag beschikbaar (vrij en inzetbaar als vervanging)?
  // Actieve chauffeurs die vandaag géén dienst hebben, niet afwezig zijn,
  // in de matrix geen bezette cel hebben (opleiding, dienst zonder tijden,
  // onbekende code) én niet op dit moment nog een dienst van gisteren
  // rijden. Matrix-namen matchen op naam (de matrix kent geen user-ids).
  const nameKey = (n: string) => n.trim().toLowerCase();
  const busyNameKeys = new Set([
    ...todayAbsent.map((a) => nameKey(a.name)),
    ...matrix.busyNames.map(nameKey),
  ]);
  const todayShifts = shifts.filter((s) => s.date === peilDag);
  // Eerste dienst van de peildag (voor de morgen-variant van de actief-tegel):
  // vroegste starttijd, afwezig gemelde chauffeurs uitgesloten.
  const eersteStartMorgen = (() => {
    // timeMin staat verderop (const) — eigen mini-parser i.p.v. TDZ.
    const minuten = (t: string) => { const [h, m] = String(t).split(':'); return (Number(h) || 0) * 60 + (Number(m) || 0); };
    const kandidaten = todayShifts
      .filter((s) => isValidBusvakTime(String(s.startTime ?? '')) && !afwezigOpDag(String(s.driverId), s.date))
      .sort((a, b) => minuten(a.startTime) - minuten(b.startTime));
    const eerste = kandidaten[0];
    return eerste ? { tijd: eerste.startTime, naam: userNameById(String(eerste.driverId)), dienst: String(eerste.line || '—') } : null;
  })();
  const workingTodayIds = new Set(todayShifts.map((s) => String(s.driverId)));
  // Ook wie nú nog op de bus zit met een dienst van gisteren is niet vrij.
  const drivingNowIds = new Set(
    shifts.filter((s) => isShiftActiveAt(s, now)).map((s) => String(s.driverId)),
  );

  // Popups "Vandaag ingepland" + "Chauffeurs actief": per chauffeur de
  // dienst(en) met tijden. Segmenten van een gesplitste dienst zijn aparte
  // planning-rijen → groepeer per chauffeur, dienstnummers gededuped,
  // segmenten op starttijd. Eindtijden kunnen busvak-notatie zijn
  // ("26:16" = 02:16) — bewust zo getoond, dat is de notatie die de
  // planning zelf hanteert. Gesorteerd op dienstnummer oplopend (Jarno:
  // overzichtelijker dan op naam).
  const timeMin = (t: string) => {
    const [h, m] = String(t).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  };
  const lineNum = (lines: string) => Number((/\d+/.exec(lines) || ['0'])[0]);
  // Busvak-notatie mag: "26:16" is een geldige eindtijd (= 02:16 de nacht
  // erna). Zelfde grens als parseHHMM (t/m 47:59) — een eigen, lossere regex
  // liet "50:00" door en toonde dan "afgelopen" waar niets tonen de afspraak is.
  const tijdGeldig = (t: string) => isValidBusvakTime(String(t ?? ''));
  // Beide popups tellen af, maar "Vandaag ingepland" staat vol chauffeurs die
  // nog moeten beginnen of al klaar zijn. Vandaar drie toestanden per chauffeur
  // i.p.v. één: bezig → "nog 2u 36min", nog niet begonnen → "over 1u 20min",
  // klaar → "afgelopen". In "Chauffeurs actief" is per definitie iedereen
  // bezig, dus daar levert dezelfde berekening gewoon overal "nog …".
  const groupShiftsByDriver = (list: Shift[]) => {
    const byDriver = [...list]
      .sort((a, b) => timeMin(a.startTime) - timeMin(b.startTime))
      .reduce((acc, s) => {
        const id = String(s.driverId);
        let entry = acc.get(id);
        if (!entry) {
          entry = {
            id, name: userNameById(id), lineSet: new Set<string>(), segs: [] as string[],
            restMin: null as number | null, startMin: null as number | null, geldig: false,
          };
          acc.set(id, entry);
        }
        if (s.line) entry.lineSet.add(String(s.line));
        if (s.startTime && s.endTime) entry.segs.push(`${s.startTime}–${s.endTime}`);
        // Resterende rijtijd van het segment dat nú loopt. Bij een gesplitste
        // dienst is dat er hooguit één; de langste wint zodat een randgeval
        // (twee overlappende rijen) niet te vroeg afloopt.
        const rest = minutesUntilShiftEnd(s, now);
        if (rest !== null && (entry.restMin === null || rest > entry.restMin)) entry.restMin = rest;
        // Het eerstvolgende segment dat nog moet beginnen. Bij een gesplitste
        // dienst telt in de pauze dus af naar het tweede deel — precies wat je
        // op dat moment wil weten.
        const tot = minutesUntilShiftStart(s, now);
        if (tot !== null && (entry.startMin === null || tot < entry.startMin)) entry.startMin = tot;
        // "afgelopen" zeggen we alleen als er minstens één leesbaar tijdvak is;
        // bij rommel in de tijden weten we het niet en tonen we niets.
        if (tijdGeldig(s.startTime) && tijdGeldig(s.endTime)) entry.geldig = true;
        return acc;
      }, new Map<string, { id: string; name: string; lineSet: Set<string>; segs: string[]; restMin: number | null; startMin: number | null; geldig: boolean }>());
    return [...byDriver.values()]
      .map((d) => {
        const aftelling: { remaining: string; remainingTone: AftelTone } | undefined =
          d.restMin !== null ? { remaining: formatRemaining(d.restMin), remainingTone: 'bezig' }
          : d.startMin !== null ? { remaining: formatStartsIn(d.startMin), remainingTone: 'straks' }
          : d.geldig ? { remaining: 'afgelopen', remainingTone: 'klaar' }
          : undefined;
        return {
          id: d.id,
          name: d.name,
          phone: users.find((u) => String(u.id) === d.id)?.phone || undefined,
          lines: [...d.lineSet].join(' / ') || '•',
          // De losse blokken, niet één samengevoegde string: bij een dienst van
          // drie delen liep die tot tegen de dienstchip aan en las hij als één
          // grijze sliert. De rij zet ze nu apart met een scheidingsstip.
          segs: d.segs,
          ...aftelling,
        };
      })
      .sort((a, b) => lineNum(a.lines) - lineNum(b.lines) || a.lines.localeCompare(b.lines));
  };
  // Wie ná de import afwezig gemeld is, staat in de matrix (en dus in de
  // planning) nog op zijn dienst. De aftelling zou dan doodleuk "nog 2u"
  // tonen voor iemand die ziek thuis zit — vervang die door het afwezig-label.
  const scheduledToday = groupShiftsByDriver(todayShifts).map((d) => {
    // Morgen: geen live-aftelling — die telt vanaf "nu" en zou voor morgen
    // onzinnige uren tonen. Het afwezig-label blijft wél (dat is per dag).
    const basis = dagOffset === 1 ? { ...d, remaining: undefined, remainingTone: undefined } : d;
    const afwezig = afwezigOpDag(d.id, peilDag);
    if (!afwezig) return basis;
    return { ...basis, remaining: afwezig.label.toLowerCase(), remainingTone: afwezig.tone };
  });
  // Wie rijdt er nú? Zelfde filter als de teller op de tegel — over álle
  // shifts, want een nachtdienst van gisteren kan nu nog bezig zijn. De
  // tijden tonen alleen de segmenten die op dit moment lopen.
  const drivingNow = groupShiftsByDriver(
    shifts.filter((s) => isShiftActiveAt(s, now) && !afwezigOpDag(String(s.driverId), s.date)),
  );
  const availableToday = users
    .filter(isRealDriver)
    .filter((u) =>
      !workingTodayIds.has(String(u.id)) &&
      // "Zit nú nog op de bus" telt alleen voor vandaag — morgen zegt de
      // actuele rit niets over beschikbaarheid.
      (dagOffset === 1 || !drivingNowIds.has(String(u.id))) &&
      !busyNameKeys.has(nameKey(u.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Alleen de "vandaag (…)"-wrapper is eigen; het label zelf komt uit de
  // gedeelde formatShortDay (was hier woordelijk herbouwd).
  const formatDay = (iso: string) => {
    const label = formatShortDay(iso);
    return iso === today ? `vandaag (${label})` : label;
  };

  // "Begin hier" (fase C13): zonder chauffeurs of zonder geïmporteerde
  // planning zeggen de tegels alleen maar 0 — dan is de volgende stap de
  // boodschap, niet het cijfer. De strip en Open taken blijven staan
  // (toestellen, vervaldata en aanvragen bestaan los van de planning).
  const setupStap: { titel: string; tekst: string; actie?: { label: string; view: View } } | null =
    totalDrivers === 0
      ? {
          titel: 'Nog geen chauffeurs',
          tekst: 'Zonder chauffeursaccounts valt er niets in te plannen. Maak eerst de gebruikers aan; daarna vullen de tegels zich vanzelf.',
          actie: isAdmin ? { label: 'Naar Gebruikers', view: 'gebruikers' } : undefined,
        }
      : shifts.length === 0
        ? {
            titel: 'Nog geen planning geladen',
            tekst: 'Importeer de maandplanning uit Excel. Daarna zie je hier wie rijdt, wie vrij is en wat open staat.',
            actie: { label: 'Planning importeren', view: 'beheer-roosters' },
          }
        : null;

  // "Deze week": dekkingsstatus per dag (vandaag t/m +6) uit coverageDays —
  // de derde kolom op brede schermen. null = nog niet geladen; een lege lijst
  // of overal expected 0 = er zijn geen verwachte diensten ingesteld.
  const weekEinde = isoDate(addDays(now, 6));
  const weekDagen = (coverageDays ?? []).filter((d) => d.date >= today && d.date <= weekEinde).sort((a, b) => a.date.localeCompare(b.date));
  const geenVerwachtingen = coverageDays !== null && (weekDagen.length === 0 || weekDagen.every((d) => d.expected === 0));
  const weekOpen = weekDagen.reduce((n, d) => n + d.missing.length, 0);

  return (
    <section className="space-y-5">
      {/* === Operationele header === */}
      <div className="flex flex-col gap-3 px-1 pt-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-page-title">
            {greeting}, <span className="text-oker-700">{firstName}</span>
          </h1>
          <p className="mt-0.5 text-sm font-normal text-slate-500">
            Actuele status op{' '}
            {formatDayLong(isoDate(now))} ·{' '}
            {now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex w-fit items-center gap-2">
        {/* Vandaag | Morgen: bezetting-tegels + popups kijken vooruit
            (verbeterronde 01-09, nr. 1); live cijfers blijven op nu. */}
        <div className="glass-segmented inline-flex rounded-2xl p-1">
          {([0, 1] as const).map((offset) => (
            // rauw: segmented-control-item via segItemClass (het voorgeschreven patroon)
            <button
              key={offset}
              type="button"
              onClick={() => setDagOffset(offset)}
              aria-pressed={dagOffset === offset}
              className={segItemClass(dagOffset === offset, 'min-h-11 sm:pointer-fine:min-h-8')}
            >
              {offset === 0 ? 'Vandaag' : 'Morgen'}
            </button>
          ))}
        </div>
        {/* De "Open taken/Operationeel"-statuspil die hier stond is 31-08
            vervangen door de werkvoorraad-knop in de topbar (WerkvoorraadMenu)
            — die is vanuit elk scherm zichtbaar. Alleen de actie blijft. */}
        {/* Ziekmelding komt telefonisch binnen tijdens de rit, dus de planner
            moet er altijd bij kunnen — vandaar hier en niet achter een menu.
            Zelfde primary-knop als op het Ziekte-blad (keuze Jarno 31-08):
            de amber pil-vorm matchte de statuspil die nu weg is, en een
            registratie is een gewone handeling, geen alarm. */}
        <Button
          ref={sickTriggerRef}
          variant="primary"
          size="sm"
          className="gap-1 px-2.5"
          icon={<Plus size={14} />}
          aria-haspopup="dialog"
          onClick={() => {
            setSickForm({ userId: '', startDate: todayKey, endDate: todayKey, comment: '' });
            setSickFouten({});
            setShowSickModal(true);
          }}
        >
          Ziek melden
        </Button>
        </div>
      </div>

      {/* === Status-strip ===
          Gat-vrije verdeling op elke breedte, voor 5 én 6 tegels (de
          laadplein-tegel verschijnt alleen mét OCPI-data; de Aanvragen- en
          Laatste import-tegels zijn 31-08 vervallen — dubbelop met de
          werkvoorraad-knop in de topbar). Zonder laadplein: md = 3 à span-2
          + 2 à span-3 (rijen 3/2), en op mobiel spant Omleidingen beide
          kolommen (5 is oneven). Mét laadplein: md = 6 tegels à span-2
          (rijen 3/3). Haal je hier een tegel weg of zet je er een bij, dan
          moeten deze tellingen mee. */}
      {/* "Begin hier" bóven de strip, niet in de plaats ervan: de tegels
          blijven het vaste anker van dit scherm (ook voor de smoke-test);
          de lege staat zegt waarom ze op 0 staan en wat de volgende stap is. */}
      {setupStap && (
        <EmptyState
          icon={<CalendarCog size={24} />}
          title={setupStap.titel}
          message={setupStap.tekst}
          action={setupStap.actie ? (
            // Secundair: de enige gouden knop van de cockpit is "Ziek melden"
            // in de kop (afwerking 04-09, nr. 5).
            <Button variant="secondary" size="md" onClick={() => onNavigate(setupStap.actie!.view)}>
              {setupStap.actie.label}
            </Button>
          ) : undefined}
        />
      )}
      <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-6', laadplein ? 'xl:grid-cols-6' : 'xl:grid-cols-5')}>
        {dagOffset === 1 ? (
          // Morgen: "nu aan het rijden" is een vandaag-cijfer — het bleef staan
          // en las als "morgen zijn er al mensen actief" (melding Jarno 03-09).
          // Toon in plaats daarvan de eerste start van morgen.
          <OpsStat
            className="md:col-span-2 xl:col-span-1"
            icon={<Bus size={16} />}
            tone="slate"
            label="Eerste start morgen"
            text={eersteStartMorgen ? eersteStartMorgen.tijd : '—'}
            sub={eersteStartMorgen ? `${eersteStartMorgen.naam} · dienst ${eersteStartMorgen.dienst}` : 'nog geen diensten ingepland'}
            onClick={() => setShowScheduled(true)}
          />
        ) : (
          <OpsStat
            className="md:col-span-2 xl:col-span-1"
            icon={<Bus size={16} />}
            // Oker = er rijdt nú iemand (het enige merk-accent in de strip);
            // een lege ochtend is rusttoestand en blijft slate.
            tone={driversDrivingNow > 0 ? 'oker' : 'slate'}
            label="Chauffeurs actief"
            value={driversDrivingNow}
            sub="nu aan het rijden"
            onClick={() => setShowDriving(true)}
          />
        )}
        <OpsStat
          className="md:col-span-2 xl:col-span-1"
          icon={<Users size={16} />}
          tone="slate"
          label={`${peilLabel} ingepland`}
          value={driversActiveToday}
          suffix={totalDrivers > 0 ? ` / ${totalDrivers}` : undefined}
          sub={ingeplandAfwezig > 0 ? `waarvan ${ingeplandAfwezig} afwezig gemeld` : 'chauffeurs met dienst'}
          onClick={() => setShowScheduled(true)}
        />
        <OpsStat
          className="md:col-span-2 xl:col-span-1"
          icon={<UserCheck size={16} />}
          tone="slate"
          label="Beschikbaar"
          value={availableToday.length}
          sub={`vrij en inzetbaar ${peilLabel.toLowerCase()}`}
          onClick={() => setShowAvailable(true)}
        />
        <OpsStat
          className={cn(laadplein ? 'md:col-span-2' : 'md:col-span-3', 'xl:col-span-1')}
          icon={<CalendarClock size={16} />}
          tone={todayAbsent.some((a) => a.isSick) ? 'rose' : 'slate'}
          label={`${peilLabel} afwezig`}
          value={todayAbsent.length}
          sub={todayAbsent.length === 0
            ? 'iedereen inzetbaar'
            : `${todayAbsent.filter((a) => a.isSick).length} ziek · ${todayAbsent.filter((a) => !a.isSick).length} verlof`}
          onClick={() => setShowAbsent(true)}
        />
        <OpsStat
          className={cn(laadplein ? 'md:col-span-2' : 'col-span-2 md:col-span-3', 'xl:col-span-1')}
          icon={<MapPin size={16} />}
          tone="slate"
          label="Omleidingen"
          value={activeDiversions}
          sub={activeDiversions === 1 ? 'actieve omleiding' : 'actieve omleidingen'}
          onClick={() => onNavigate('omleidingen')}
        />
        {/* Laadplein-tegel — alleen zodra de OCPI-koppeling data levert.
            Doorklikken naar het volle OCPI-scherm kan alleen als admin;
            voor een planner is de tegel zelf de informatie. */}
        {laadplein && (
          <OpsStat
            className="md:col-span-2 xl:col-span-1"
            icon={<Zap size={16} />}
            tone={laadplein.outOfOrder > 0 ? 'red' : laadplein.charging > 0 ? 'blue' : 'slate'}
            label="Aan de lader"
            value={laadplein.charging}
            suffix={` / ${laadplein.evses}`}
            sub={laadplein.outOfOrder > 0
              ? `${laadplein.outOfOrder} in storing`
              : laadplein.totalPowerKw > 0
                ? `${metEenheid(laadplein.totalPowerKw, 'kW')} op dit moment`
                : 'laadpunten bezet'}
            onClick={isAdmin ? () => onNavigate('ocpi-monitoring') : undefined}
          />
        )}
      </div>

      {/* === Operations Center ===
          Geen items-start meer: beide kolommen rekken tot dezelfde hoogte,
          zodat er geen leeg gat onder de kortste kolom valt. */}
      {/* Gelijke helften. Ging in stappen: 2/3–1/3 was te scheef (Live
          activiteit kapte zijn regels af, "Chris Versluys — ziekte (2…"),
          60/40 hielp maar niet genoeg. Open taken heeft de breedte niet nodig
          — dat zijn korte rijen en er staan er meestal maar twee of drie.
          Op xl+ komt er een derde kolom bij ("Deze week", fase C13); onder
          xl blijft alles zoals het was. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Open taken — gecombineerde werkvoorraad */}
        <OpsPanel
          icon={<Inbox size={16} />}
          title="Open taken"
          aside={attentionCount > 0 ? `${attentionCount} ${attentionCount === 1 ? 'item' : 'items'}` : undefined}
        >
          <div className="space-y-1.5">
            {planningStale && (
              <OpsRow
                tone="amber"
                icon={<CalendarClock size={16} />}
                primary={`Planning al ${daysSinceImport} dagen niet bijgewerkt`}
                secondary="Upload je laatste Excel zodat de planning actueel blijft."
                onClick={() => onNavigate('beheer-roosters')}
              />
            )}
            {horizonKrap && (
              <OpsRow
                tone={horizonDagenOver! <= 0 ? 'red' : 'amber'}
                icon={<CalendarClock size={16} />}
                primary={horizonDagenOver! <= 0
                  ? 'De geladen planning is op'
                  : `Planning geladen t/m ${formatDay(planningHorizon)} — nog ${horizonDagenOver} ${horizonDagenOver === 1 ? 'dag' : 'dagen'}`}
                secondary="Importeer de volgende periode zodat chauffeurs vooruit kunnen kijken."
                onClick={() => onNavigate('beheer-roosters')}
              />
            )}
            {importIssueCount > 0 && lastImport && (
              <OpsRow
                tone="red"
                icon={<AlertTriangle size={16} />}
                primary="Laatste import heeft aandachtspunten"
                secondary={[
                  lastImport.unknownCodes.length > 0 ? `${lastImport.unknownCodes.length} onbekende codes` : null,
                  lastImport.unmatchedDrivers.length > 0 ? `${lastImport.unmatchedDrivers.length} niet-gematchte chauffeurs` : null,
                ].filter(Boolean).join(' · ')}
                onClick={() => onNavigate('beheer-roosters')}
              />
            )}
            {vervalTaken.slice(0, 3).map((e) => (
              <Fragment key={`${e.userId}:${e.soort}`}>
              <OpsRow
                tone={e.dagen < 0 ? 'red' : 'amber'}
                icon={<IdCard size={16} />}
                primary={`${EXPIRY_SOORT_LABELS[e.soort] ?? e.soort} · ${userNameById(e.userId)}`}
                secondary={e.dagen < 0
                  ? `Verlopen sinds ${e.validUntil}`
                  : e.dagen === 0
                    ? `Verloopt vandaag (${e.validUntil})`
                    : `Verloopt over ${e.dagen} ${e.dagen === 1 ? 'dag' : 'dagen'} (${e.validUntil})`}
                onClick={() => onNavigate('vervaldata')}
              />
              </Fragment>
            ))}
            {herverdeelPerChauffeur.slice(0, 3).map((g) => (
              <Fragment key={`herverdeel:${g.driverId}`}>
              <OpsRow
                tone="red"
                icon={<UserX size={16} />}
                primary={`${g.diensten.length} ${g.diensten.length === 1 ? 'dienst' : 'diensten'} nog niet herverdeeld — ${userNameById(g.driverId)}`}
                secondary={`${g.reden} · ${g.diensten.slice(0, 4).map((s) => `${formatDay(s.date)} (${serviceNumberOf(s)})`).join(', ')}${g.diensten.length > 4 ? `, +${g.diensten.length - 4}` : ''}`}
                // Ziekte-blad, niet de maandplanning: dáár staan de
                // herverdeel-knoppen (kortste route naar de actie).
                onClick={() => onNavigate('ziekte')}
              />
              </Fragment>
            ))}
            {gapDays.slice(0, 3).map((d) => (
              <Fragment key={d.date}>
              <OpsRow
                tone="red"
                icon={<AlertTriangle size={16} />}
                primary={`${d.missing.length} open ${d.missing.length === 1 ? 'dienst' : 'diensten'} — ${formatDay(d.date)}`}
                secondary={`Dienst ${d.missing.slice(0, 6).join(', ')}${d.missing.length > 6 ? '…' : ''}`}
                onClick={() => onNavigate('dekking')}
              />
              </Fragment>
            ))}
            {pendingDevices.slice(0, 3).map((d) => (
              <Fragment key={`${d.userId}:${d.name}:${d.createdAt}`}>
              <OpsRow
                tone="amber"
                icon={<Smartphone size={16} />}
                primary={`Toestel wacht op goedkeuring · ${userNameById(d.userId)}`}
                secondary={d.name}
                meta={relTime(d.createdAt)}
                onClick={() => onNavigate('toestellen')}
              />
              </Fragment>
            ))}
            {pendingLeave.slice(0, 4).map((req) => (
              <Fragment key={req.id}>
              <OpsRow
                tone="amber"
                icon={<CalendarDays size={16} />}
                primary={`Verlofaanvraag · ${userNameById(req.userId)}`}
                secondary={`${req.startDate}${req.startDate !== req.endDate ? ` → ${req.endDate}` : ''} · ${req.type === 'betaald_verlof' ? 'betaald verlof' : 'klein verlet'}`}
                meta={relTime(req.createdAt)}
                onClick={() => onNavigate('verlof')}
              />
              </Fragment>
            ))}
            {pendingSwaps.slice(0, 4).map((swap) => (
              <Fragment key={swap.id}>
              <OpsRow
                tone="blue"
                icon={<Repeat size={16} />}
                primary={`${swap.swapType === 'overname' ? 'Overname' : 'Dienstruil'} · ${swap.targetDriverId
                  ? `${userNameById(swap.requesterId)} → ${userNameById(swap.targetDriverId)}`
                  : userNameById(swap.requesterId)}`}
                secondary={swap.status === 'accepted' ? 'Collega akkoord — wacht op validatie' : swap.reason || 'Wacht op een collega'}
                meta={relTime(swap.createdAt)}
                onClick={() => onNavigate('ruil-verzoeken')}
              />
              </Fragment>
            ))}
            {/* De lijst toont bewust een top-N; zonder deze regel suggereerde
                de teller in de kop dat je alles ziet. */}
            {hiddenAttentionCount > 0 && (
              <p className="px-4 pt-1 text-xs font-medium text-slate-500">
                +{hiddenAttentionCount} niet getoond — open Verlof, Dienstruil, Toestellen of Vervaldata voor de volledige lijst.
              </p>
            )}
            {attentionCount === 0 && (
              /* Neutrale kaart met alleen een groen vinkje: "alles ok" is
                 rusttoestand, geen melding (afwerking 04-09, nr. 6). */
              <Card tone="muted" padding="none" className="flex items-center gap-3 px-4 py-3.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-paper text-emerald-700 ring-1 ring-hairline">
                  <CheckCircle2 size={16} />

                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Alles ok</p>
                  <p className="text-xs font-normal text-slate-500">Geen open taken of openstaande diensten.</p>
                </div>
              </Card>
            )}
          </div>
        </OpsPanel>

        {/* Rechterflank: live activiteit. Het vroegere "Systeemstatus"-paneel
            is bewust weg: import-status en dekking staan al in de status-strip
            bovenaan, en "Portaal Online"/"Realtime Actief" waren hardcoded
            (decoratie) — tegen het eigen niets-is-decoratief-principe in. */}
        <div className="flex flex-col gap-4">
          {isAdmin && activityLog.length > 0 ? (
            <OpsPanel
              className="flex-1"
              icon={<Activity size={16} />}
              title="Live activiteit"
              aside="laatste acties"
              onSeeAll={() => onNavigate('activiteit')}
              seeAllLabel="Volledige log"
            >
              <div className="space-y-0.5">
                {activityLog.slice(0, 6).map((entry) => (
                  <Fragment key={entry.id}><FeedRow entry={entry} /></Fragment>
                ))}
              </div>
            </OpsPanel>
          ) : (
            updates.length > 0 && (
              <OpsPanel
                className="flex-1"
                icon={<Bell size={16} />}
                title="Recente updates"
                onSeeAll={() => onNavigate('updates')}
                seeAllLabel="Alle updates"
              >
                <div className="space-y-1.5">
                  {updates.slice(0, 3).map((u) => (
                    <OpsRow
                      tone={u.isUrgent ? 'red' : 'slate'}
                      icon={<Bell size={16} />}
                      primary={u.title}
                      secondary={u.date}
                      onClick={() => onNavigate('updates')}
                    />
                  ))}
                </div>
              </OpsPanel>
            )
          )}
          {/* Deze week als compacte strook onder de activiteit (afwerking 04-09,
              nr. 10): zeven dagcellen i.p.v. een derde smalle kolom met
              afgekapte regels. Mobiel: een tik verder op Openstaande diensten. */}
        <OpsPanel
          className="hidden lg:block"
          icon={<CalendarDays size={16} />}
          title="Deze week"
          aside={coverageDays === null ? 'laden…' : geenVerwachtingen ? undefined : weekOpen === 0 ? 'alles gedekt' : `${weekOpen} open`}
          onSeeAll={() => onNavigate('dekking')}
          seeAllLabel="Openstaande diensten"
        >
          {coverageDays === null ? (
            <div className="space-y-1.5" aria-busy="true" aria-label="Dekking wordt geladen">
              <SkeletonRow /><SkeletonRow /><SkeletonRow />
            </div>
          ) : geenVerwachtingen ? (
            <EmptyState
              icon={<AlertTriangle size={24} />}
              title="Nog geen verwachte diensten"
              message="Stel per dag-type in welke diensten er verwacht worden; dan zie je hier per dag wat er nog open staat."
              action={(
                <Button variant="secondary" size="sm" onClick={() => onNavigate('dekking')}>
                  Verwachte diensten instellen
                </Button>
              )}
            />
          ) : (
            <ul className="grid grid-cols-7 gap-1.5" aria-label="Dekking per dag">
              {weekDagen.map((d) => {
                const ok = d.missing.length === 0;
                const dag = new Date(`${d.date}T00:00:00`);
                return (
                  <li
                    key={d.date}
                    title={ok ? `${formatDay(d.date)} · gedekt` : `${formatDay(d.date)} · open: ${d.missing.join(', ')}`}
                    className={cn('flex flex-col items-center gap-1 rounded-xl px-1 py-2 ring-1 ring-hairline', ok ? 'bg-surface-row' : 'bg-red-500/8')}
                  >
                    <span className="text-micro">{dag.toLocaleDateString('nl-BE', { weekday: 'short' }).replace('.', '')}</span>
                    <span className="font-mono text-sm font-semibold tabular-nums text-slate-800">{dag.getDate()}</span>
                    {ok ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="gedekt" />
                    ) : (
                      <span className="rounded-full bg-red-500/12 px-1.5 text-2xs font-bold tabular-nums text-red-700">{d.missing.length}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </OpsPanel>
        </div>
      </div>

      {/* === Popup: wie is er vandaag beschikbaar === */}
      <DashboardListModal
        open={showAvailable}
        onClose={() => setShowAvailable(false)}
        icon={<UserCheck size={16} />}
        iconClassName="bg-surface-muted text-slate-600"
        title="Beschikbare chauffeurs"
        subtitle={`${formatDay(peilDag)} · ${availableToday.length} ${availableToday.length === 1 ? 'chauffeur' : 'chauffeurs'}`}
      >
        {availableToday.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm font-medium text-slate-500">
            Niemand beschikbaar {peilLabel.toLowerCase()} — iedereen rijdt of is afwezig.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {availableToday.map((u) => {
              // Naam + nummer als tel:-link: op iPhone opent dit meteen het
              // belscherm — beschikbare vervanger in één tik aan de lijn.
              const href = telHref(u.phone);
              const inner = (
                <>
                  <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{u.name}</span>
                    <span className="block text-2xs font-mono font-medium text-slate-500 tabular-nums">
                      {u.phone || 'geen nummer bekend'}
                    </span>
                  </span>
                  {href && <Phone size={16} className="shrink-0 text-emerald-700" />}
                </>
              );
              return (
                <li key={u.id}>
                  {href ? (
                    <a
                      href={href}
                      aria-label={`Bel ${u.name}`}
                      className="ios-pressable flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-soft-hover active:bg-slate-100"
                    >
                      {inner}
                    </a>
                  ) : (
                    <span className="flex items-center gap-3 rounded-xl px-3 py-2.5">{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DashboardListModal>

      {/* === Popup: wie is er vandaag afwezig (ziek/verlof) === */}
      <DashboardListModal
        open={showAbsent}
        onClose={() => setShowAbsent(false)}
        icon={<CalendarClock size={16} />}
        iconClassName="bg-surface-muted text-slate-600"
        title={`${peilLabel} afwezig`}
        subtitle={`${formatDay(peilDag)} · ${todayAbsent.length} ${todayAbsent.length === 1 ? 'collega' : "collega's"}`}
      >
        {todayAbsent.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm font-medium text-slate-500">Iedereen inzetbaar {peilLabel.toLowerCase()}.</p>
        ) : (
          <ul className="space-y-0.5">
            {todayAbsent.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5">
                <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{a.name}</span>
                <Chip mono={false} tone={a.isSick ? 'rose' : 'slate'}>{a.label}</Chip>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" size="md" full className="mt-2" onClick={() => { setShowAbsent(false); onNavigate('verlof-kalender'); }}>
          Volledige kalender openen
        </Button>
      </DashboardListModal>

      {/* === Popup: wie is er vandaag ingepland, met hun dienst(en) === */}
      <DashboardListModal
        open={showScheduled}
        onClose={() => setShowScheduled(false)}
        icon={<Users size={16} />}
        iconClassName="bg-surface-muted text-slate-600"
        title={`${peilLabel} ingepland`}
        subtitle={`${formatDay(peilDag)} · ${scheduledToday.length} ${scheduledToday.length === 1 ? 'chauffeur' : 'chauffeurs'}`}
      >
        <DriverShiftRows items={scheduledToday} emptyText={`Niemand ingepland ${peilLabel.toLowerCase()}.`} />
      </DashboardListModal>

      {/* === Popup: wie rijdt er op dit moment === */}
      <DashboardListModal
        open={showDriving}
        onClose={() => setShowDriving(false)}
        icon={<Bus size={16} />}
        iconClassName="bg-surface-muted text-slate-600"
        title="Chauffeurs actief"
        subtitle={`nu aan het rijden · ${drivingNow.length} ${drivingNow.length === 1 ? 'chauffeur' : 'chauffeurs'}`}
      >
        <DriverShiftRows items={drivingNow} emptyText="Niemand aan het rijden op dit moment." />
      </DashboardListModal>

      {/* Ziekmelding registreren — chauffeur + periode. Formulier-modal, dus
          niet via DashboardListModal (die is voor lijsten). */}
      <Modal
        open={showSickModal}
        onClose={closeSickModal}
        maxWidth="sm"
        className="flex max-h-[80dvh] flex-col !overflow-hidden !p-0"
      >
        <ModalHeader
          leading={
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
              <AlertTriangle size={16} />
            </span>
          }
          eyebrow={ziekVervolg ? 'Ziekmelding geregistreerd' : 'Meteen onbeschikbaar'}
          title={ziekVervolg ? 'Wie neemt de dienst over?' : 'Ziekmelding registreren'}
          onClose={closeSickModal}
        />
        {ziekVervolg ? (
          <div className="p-6 md:p-7 space-y-4 overflow-y-auto overscroll-contain flex-1">
            <p className="text-sm font-medium text-slate-600 leading-relaxed">
              {ziekVervolg.naam} is afgemeld, maar {ziekVervolg.diensten.length === 1
                ? 'deze dienst staat'
                : `deze ${ziekVervolg.diensten.length} diensten staan`} nog op naam.
              {isAdmin ? ' Zet ze meteen over.' : ' Een admin kan ze overzetten in de Maandplanning.'}
            </p>
            {/* Voortgang expliciet: bij een langere ziekte staat de lijst vol en
                scrol je makkelijk over de laatste heen — dan lijkt het klaar
                terwijl er nog diensten open staan (melding Jarno 14-08). */}
            {isAdmin && (
              <p className={cn(microLabelClass, 'tabular-nums')}>
                {Object.keys(afgehandeld).length} van {ziekVervolg.diensten.length} overgezet
                {Object.keys(afgehandeld).length < ziekVervolg.diensten.length
                  ? ` · nog ${ziekVervolg.diensten.length - Object.keys(afgehandeld).length} te doen`
                  : ' · alles rond'}
              </p>
            )}
            <div className="space-y-3">
              {ziekVervolg.diensten.map((d) => {
                const klaar = afgehandeld[d.id];
                return (
                  <Card key={d.id} tone="muted" padding="none" className="px-3.5 py-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-800 tabular-nums">
                        Dienst {serviceNumberOf(d)}
                      </span>
                      <span className={cn(microLabelClass, 'tabular-nums')}>{formatDay(d.date)}</span>
                    </div>
                    {klaar ? (
                      <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 size={14} /> Overgezet naar {klaar}
                      </p>
                    ) : isAdmin ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Select
                          aria-label={`Vervanger voor dienst ${serviceNumberOf(d)} op ${d.date}`}
                          value={vervangerPerDienst[d.id] ?? ''}
                          onChange={(e) => setVervangerPerDienst((cur) => ({ ...cur, [d.id]: e.target.value }))}
                          className="min-w-0 flex-1"
                        >
                          <option value="">Kies een chauffeur…</option>
                          {/* Vrij die dag bovenaan, daarbinnen minst gewerkt
                              die week — zelfde criteria als de advisor
                              (keuze Jarno 19-08). */}
                          {rangschikKandidaten(
                            users.filter((u) => u.role === 'chauffeur' && u.isActive !== false && String(u.id) !== String(d.driverId)),
                            vrijOpDatum(shifts, d.date),
                            werkdagen,
                            d.date,
                          ).map((k) => <option key={k.user.id} value={String(k.user.id)}>{kandidaatLabel(k)}</option>)}
                        </Select>
                        {/* Secundair per rij: er staan er zoveel als er
                            diensten open zijn; de ene primaire van dit
                            venster is "Klaar" zodra alles overgezet is. */}
                        <Button
                          variant="secondary"
                          size="md"
                          disabled={!vervangerPerDienst[d.id] || wisselBezig === d.id}
                          onClick={() => void zetDienstOver(d)}
                        >

                          {wisselBezig === d.id ? 'Bezig…' : 'Zet over'}
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
            <Button
              variant={Object.keys(afgehandeld).length === ziekVervolg.diensten.length ? 'primary' : 'secondary'}
              size="lg"
              full
              onClick={closeSickModal}
            >
              {Object.keys(afgehandeld).length === ziekVervolg.diensten.length
                ? 'Klaar'
                : `Later doen (${ziekVervolg.diensten.length - Object.keys(afgehandeld).length} blijven open)`}
            </Button>
          </div>
        ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (isSubmittingSick) return;
            const startDate = sickForm.startDate || todayKey;
            const endDate = sickForm.endDate || startDate;
            const fouten: { userId?: string; endDate?: string } = {};
            if (!sickForm.userId) fouten.userId = 'Kies de chauffeur die ziek is.';
            if (endDate < startDate) fouten.endDate = 'De einddatum ligt vóór de startdatum.';
            setSickFouten(fouten);
            if (fouten.userId || fouten.endDate) return;
            setIsSubmittingSick(true);
            const ok = await onSickReport({ userId: sickForm.userId, startDate, endDate, comment: sickForm.comment })
              .finally(() => setIsSubmittingSick(false));
            if (!ok) return;
            // Blijven de diensten van deze chauffeur in die periode open staan?
            // Dan meteen doorschakelen naar het herverdelen; zo niet, sluiten.
            const open = openstaandeDienstenVanAfwezigen(
              shifts,
              // De verse leave-lijst is nog onderweg; reken met de zojuist
              // geregistreerde periode zodat stap 2 niet één render te laat komt.
              [{ id: 'net-gemeld', userId: sickForm.userId, startDate, endDate, type: 'ziekte', status: 'approved', createdAt: '' } as LeaveRequest],
              today,
              { driverId: sickForm.userId, totIso: endDate },
            );
            if (open.length === 0) { closeSickModal(); return; }
            setZiekVervolg({ naam: userNameById(sickForm.userId), diensten: open });
          }}
          className="p-6 md:p-7 space-y-4 overflow-y-auto overscroll-contain flex-1"
        >
          <Field label="Chauffeur" required error={sickFouten.userId}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={sickForm.userId}
                onChange={(e) => { setSickForm({ ...sickForm, userId: e.target.value }); setSickFouten((f) => ({ ...f, userId: undefined })); }}
              >
                <option value="">Kies een chauffeur…</option>
                {users
                  .filter((u) => u.role === 'chauffeur' && u.isActive !== false)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Van">
              {({ id }) => (
                <DateInput
                  id={id}
                  value={sickForm.startDate}
                  onChange={(v) => { setSickForm({ ...sickForm, startDate: v, endDate: sickForm.endDate < v ? v : sickForm.endDate }); setSickFouten((f) => ({ ...f, endDate: undefined })); }}
                />
              )}
            </Field>
            <Field label="Tot en met" error={sickFouten.endDate}>
              {({ id, describedBy, invalid }) => (
                <DateInput
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={sickForm.endDate}
                  min={sickForm.startDate}
                  onChange={(v) => { setSickForm({ ...sickForm, endDate: v }); setSickFouten((f) => ({ ...f, endDate: undefined })); }}
                />
              )}
            </Field>
          </div>
          <Field label="Opmerking (optioneel)">
            {({ id }) => (
              <Textarea
                id={id}
                value={sickForm.comment}
                onChange={(e) => setSickForm({ ...sickForm, comment: e.target.value })}
                className="h-20"
                placeholder="bv. gemeld via telefoon om 6u"
              />
            )}
          </Field>
          <p className="text-2xs font-medium text-slate-500">
            De dag(en) komen meteen als onbeschikbaar in de planning; de andere planners krijgen een melding.
          </p>
          <Button type="submit" variant="primary" size="lg" full disabled={isSubmittingSick}>
            {isSubmittingSick ? 'Registreren…' : 'Ziekmelding registreren'}
          </Button>
        </form>
        )}
      </Modal>
    </section>
  );
}

/** Rijenlijst voor de dienst-popups: naam + tijden links, dienst-chip rechts.
 *  Bewust zónder hover-highlight: deze rijen zijn niet klikbaar, en in de
 *  Beschikbaar-popup betekent diezelfde highlight "tik = bellen". */
/** Waar in zijn dag zit deze chauffeur: bezig · moet nog beginnen · klaar —
 *  of afwezig gemeld, uitgesplitst per soort zodat de kleur de toestand draagt. */
type AftelTone = 'bezig' | 'straks' | 'klaar' | 'ziek' | 'verlof' | 'verlet';

/** Toon van de aftelling. Merk-oker blijft voorbehouden aan wie nú rijdt,
 *  zodat die kleur op het hele dashboard hetzelfde betekent; "over …" en
 *  "afgelopen" zijn bijschrift en blijven grijs (allebei slate-500 —
 *  slate-400 haalde op 11 px geen leesbaar contrast). De afwezig-tonen
 *  volgen de statuskleurtaal uit lib/statusColors: ziekte rose, verlof
 *  emerald, klein verlet blue — "verlof" en "over 1u" zijn zo ook op kleur
 *  te onderscheiden (komt-niet vs. komt-nog). */
const AFTEL_TOON: Record<AftelTone, string> = {
  bezig: 'text-oker-700',
  straks: 'text-slate-500',
  klaar: 'text-slate-500',
  ziek: 'text-rose-700',
  verlof: 'text-emerald-700',
  verlet: 'text-blue-700',
};

function DriverShiftRows({ items, emptyText }: { items: { id: string; name: string; phone?: string; lines: string; segs: string[]; remaining?: string; remainingTone?: AftelTone }[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-sm font-medium text-slate-500">{emptyText}</p>;
  }
  return (
    <ul className="space-y-0.5">
      {items.map((d) => (
        <li key={d.id} className="flex items-center gap-3 rounded-xl px-3 py-2">
          {/* Bel-icoon vóór de naam in een vaste kolom: achter de naam
              sprong het per naamlengte heen en weer (Jarno 04-09). Zonder
              nummer blijft de kolom leeg zodat de namen uitgelijnd blijven.
              Klein tel-doelwit met marge-compensatie zodat de rij niet
              hoger wordt (vraag Jarno 01-09). */}
          {d.phone ? (
            <a
              href={telHref(d.phone)}
              aria-label={`Bel ${d.name}`}
              title={d.phone}
              className="-my-1.5 -ml-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-lg text-slate-400 transition-colors hover:bg-slate-100/80 hover:text-oker-700"
            >
              <Phone size={14} />
            </a>
          ) : (
            <span aria-hidden="true" className="-ml-1.5 h-8 w-8 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-slate-800">{d.name}</span>
            </span>
            {/* Elk dienstblok als eigen element, met een stip ertussen en
                flex-wrap: bij één of twee blokken staat het op één regel zoals
                voorheen, bij drie wijkt het netjes uit naar een tweede regel
                in plaats van tegen de dienstchip te duwen. */}
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs font-mono font-medium text-slate-500 tabular-nums">
              {d.segs.map((seg, i) => (
                <Fragment key={seg}>
                  {i > 0 && <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-slate-300" />}
                  <span className="whitespace-nowrap">{seg}</span>
                </Fragment>
              ))}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <ServiceChip serviceNumber={d.lines} />
            {/* Aftelling onder de dienstchip, rechts uitgelijnd. Ververst mee
                met de minuut-klok van het dashboard. Dit staat alleen op het
                planner/admin-scherm: PlannerDashboardWidgets rendert niet voor
                een chauffeur. */}
            {/* pr-2 spiegelt de RECHTER binnenmarge van ServiceChip. Zonder dat
                eindigt de aftelling 8 px verder naar rechts dan de cijfers ín
                de pil: de pilrand is een vorm, de tekst is de lijn waar je oog
                op afgaat, en die twee lagen dus niet gelijk.
                De -ml-2 heft de padding op in de breedteberekening: de kolom
                blijft even breed als voorheen, alleen de tekst schuift 8 px
                naar links. Zonder die compensatie gaat de ruimte van de
                dienstblokken af en wipt een dienst van drie delen naar een
                tweede regel (rijhoogte 59 → 75 px). Marges en geen transform:
                een extra compositing-laag geeft in Safari rasterrandjes. */}
            {d.remaining && (
              <span className={cn('-ml-2 whitespace-nowrap pr-2 text-2xs font-mono font-semibold tabular-nums', AFTEL_TOON[d.remainingTone ?? 'bezig'])}>
                {d.remaining}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Popup-schil voor de dashboard-tegels. Bouwt op de gedeelde Modal (portal,
 *  Escape-handler, safe-area-padding, geen backdrop-nasleep) — de eerdere
 *  eigen kopie miste dat alles. */
function DashboardListModal({
  open,
  onClose,
  icon,
  iconClassName,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  icon: ReactNode;
  iconClassName: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidth="sm" className="flex max-h-[80dvh] flex-col !overflow-hidden !p-0">
      <ModalHeader
        leading={
          <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', iconClassName)}>
            {icon}
          </span>
        }
        eyebrow={subtitle}
        title={title}
        onClose={onClose}
      />
      {/* flex-1 + min-h-0: zonder die twee krimpt dit vak in de flex-kolom
          niet onder zijn inhoud (min-height:auto), dus was er niets te
          scrollen en werd een lange lijst gewoon afgekapt (iPhone-bug van
          Jarno). overscroll-contain: anders chained het scrollen door naar
          het document (rubber-band / pull-to-refresh in standalone iOS). */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3">{children}</div>
    </Modal>
  );
}

// === Subcomponents ===

const FEED_ICONS: Partial<Record<ActivityLogEntry['category'], ReactNode>> = {
  users: <Users size={14} />,
  planning: <CalendarClock size={14} />,
  planning_codes: <Settings size={14} />,
  services: <CalendarClock size={14} />,
  diversions: <MapPin size={14} />,
  updates: <Bell size={14} />,
  auth: <KeyRound size={14} />,
  leave: <CalendarDays size={14} />,
  swaps: <Repeat size={14} />,
};

/** Activiteit-feedregel: wie deed wat, hoelang geleden. */
function FeedRow({ entry }: { entry: ActivityLogEntry }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-1.5 py-2">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-500/12 text-slate-500">
        {FEED_ICONS[entry.category] ?? <Activity size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        {/* Twee regels i.p.v. truncate: de details zijn juist het interessante
            deel en die viel er structureel af ("Chris Versluys — ziekte (2…",
            "Systeem (cron) · 16 fouten gemeld aan 1 on…"). Nog steeds begrensd,
            zodat één lange regel de zes feed-items niet uit elkaar duwt; wie
            het volledige verhaal wil, klikt door naar de log. */}
        <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-700">
          <span className="font-semibold text-slate-900">{entry.actorName}</span> · {entry.details || entry.action}
        </p>
        <p className="text-2xs font-normal text-slate-500">{relTime(entry.createdAt)}</p>
      </div>
    </div>
  );
}
