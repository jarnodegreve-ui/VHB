import { useEffect, useRef, useState } from 'react';
import type { LeaveRequest } from '../../types';
import { apiFetch, apiJson } from '../../lib/api';
import { stelExtraFeestdagenIn } from '../../lib/leaveBalance';
// Zod-vrij (shared/feestdagen.ts): deze hook zit in de startbundel.
import { parseExtraFeestdagenLos, type ExtraFeestdag } from '../../../shared/feestdagen';
import { antwoordUitCache, isRevisieConflict, useCollectieState, type DataCtx } from './kern';
import { laatSchrijffout } from '../../lib/foutenLui';

function nieuweKruising() {
  return {
    nr: 0,
    lezingNr: 0,
    laatsteToegepast: 0,
    laatsteVers: 0,
    samengesteld: false,
    lopend: new Map<number, number>(),
    recent: [] as Array<{ nr: number; id: string; van: string; record: Partial<LeaveRequest> }>,
  };
}

/**
 * Verlof: de aanvragen, beslissen (PATCH met seenStatus-guard), de
 * ziekmelding en het 'laatst gezien'-moment voor de beslissingsbadge.
 * `refreshCoverageGaps` komt uit de planning-module: een ziekmelding slaat
 * een gat dat meteen in de cockpit moet staan.
 */
export function useVerlofData(ctx: DataCtx & { refreshCoverageGaps: () => Promise<void> }) {
  const { session, currentUser, showToast, meldLaadfout, fetchActivityLog, refreshCoverageGaps } = ctx;
  const [collectie, setVerlof, zetVerlofUitAntwoord] = useCollectieState<{ lijst: LeaveRequest[]; samengesteld: boolean }>({ lijst: [], samengesteld: false });
  const leaveRequests = collectie.lijst;
  const [lastSeenLeaveDecisionAt, setLastSeenLeaveDecisionAt] = useState<string | null>(null);

  // Een lijst die vertrok vóór een eigen geslaagde beslissing, mag die
  // beslissing niet terugzetten. In een bulk met één aanvraag die al behandeld
  // was (409) ververst de lijst zonder dat de bulk erop wacht; kwam dat
  // antwoord binnen ná de beslissing over de volgende aanvraag, dan stond die
  // net goedgekeurde aanvraag weer als "in behandeling" in beeld tot de
  // volgende verversing (15-11, e2e "bulk met drie aanvragen").
  //
  // Een oudere lijst telt zolang er nog geen jongere geldig binnenkwam.
  // Een cache-antwoord maakt een vers antwoord niet achterhaald. In de lijst
  // blijven andermans wijzigingen staan. Alleen een aanvraag die nog
  // de status van vóór een eigen beslissing draagt, houdt het PATCH-antwoord.
  // Zo'n samengestelde lijst is alleen voor weergave, geen basis voor POST.
  // Lopende lezingen bewaren hun beslisstand, per lezingnummer. Bij uitloggen
  // krijgt dit alles een nieuwe ref-waarde, oude antwoorden tellen niet meer.
  const kruising = useRef<ReturnType<typeof nieuweKruising> | null>(null);
  kruising.current ??= nieuweKruising();

  const fetchLeave = async (accessToken = session?.access_token) => {
    const k = kruising.current!;
    const lezing = ++k.lezingNr;
    const stand = k.nr;
    k.lopend.set(lezing, stand);
    let uitCache = false;
    const isActueel = () => kruising.current === k && lezing > (uitCache ? k.laatsteToegepast : k.laatsteVers);
    try {
      const response = await apiFetch('/api/leave', { accessToken });
      uitCache = antwoordUitCache(response);
      if (!isActueel() || !response.ok) return;
      const data: unknown = await response.json();
      if (!isActueel() || !Array.isArray(data) || data.some((rij) => !rij || typeof rij.id !== 'string' || typeof rij.status !== 'string')) return;
      // De eigen beslissingen van na het vertrek, in volgorde over de rij
      // gevouwen (goedkeuren en daarna annuleren geeft dus geannuleerd).
      const later = k.recent.filter((b) => b.nr > stand);
      const rijen = data as LeaveRequest[];
      const lijst = later.length === 0 ? rijen : rijen.map((r) => later.reduce((rij, b) => (b.id === rij.id && rij.status === b.van ? { ...rij, ...b.record } : rij), r));
      k.laatsteToegepast = Math.max(k.laatsteToegepast, lezing);
      if (!uitCache) k.laatsteVers = lezing;
      k.samengesteld = lijst.some((rij, i) => rij !== data[i]);
      ctx.noteerAntwoord(response);
      if (k.samengesteld) {
        // Geen revisie van een lijst die afwijkt van de getoonde lijst; de
        // gewone setter maakt ook de afdruk ongeldig voor de volgende lezing.
        setVerlof({ lijst, samengesteld: true });
      } else {
        ctx.captureRevision('leave', response);
        zetVerlofUitAntwoord(response, data, { lijst, samengesteld: false });
      }
      ctx.markCollectionLoaded('leave');
    } catch (error) {
      if (!isActueel()) return;
      console.error('Error fetching leave:', error);
      meldLaadfout('de verlofaanvragen', error);
    } finally {
      k.lopend.delete(lezing);
      // Wat geen lopende lezing meer kan kruisen, hoeft niet onthouden.
      let oudste = k.nr;
      for (const lopend of k.lopend.values()) oudste = Math.min(oudste, lopend);
      k.recent = k.recent.filter((b) => b.nr > oudste);
    }
  };

  const saveLeave = async (newLeave: LeaveRequest[]): Promise<boolean> => {
    if (!ctx.guardCollectionLoaded('leave', 'De verlofaanvragen zijn')) return false;
    const k = kruising.current!;
    const isActueel = () => kruising.current === k;
    const toonSchrijffout = (tekst: string) => { if (isActueel()) showToast(tekst, 'error'); };
    const verversVoorOpnieuw = async (tekst: string): Promise<false> => {
      showToast(tekst, 'info');
      await fetchLeave();
      return false;
    };
    // Een actie uit de vorige render kan nog haar samengestelde lijst hebben
    // terwijl een verse lezing de interne revisie al heeft vervangen.
    if (k.samengesteld || collectie.samengesteld) return verversVoorOpnieuw('De verlofaanvragen worden ververst. Probeer je wijziging opnieuw.');
    try {
      const response = await apiFetch('/api/leave', {
        method: 'POST',
        headers: ctx.revisionHeader('leave'),
        body: JSON.stringify(newLeave),
      });
      if (!isActueel()) return false;
      if (response.ok) {
        setVerlof({ lijst: newLeave, samengesteld: k.samengesteld });
        ctx.captureRevision('leave', response);
        // Verlof verandert de dekking (afwezige telt als gat): meteen mee
        // verversen, anders bleven dashboard en topbar op de oude stand staan.
        void refreshCoverageGaps();
        // Logboek stil op de achtergrond: de overlay wacht er niet op.
        if (currentUser?.role === 'admin') void fetchActivityLog();
        const isNewRequest = newLeave.some((r) => !leaveRequests.some((p) => p.id === r.id));
        // Ziekte is geen verlof (Jarno 06-10): raakt de wijziging alleen
        // ziekmeldingen (einddatum bijstellen of intrekken in Beheer ›
        // Ziekte), dan zegt de toast dat ook.
        const gewijzigd = newLeave.filter((r) => {
          const vorige = leaveRequests.find((p) => p.id === r.id);
          return !vorige || vorige.status !== r.status || vorige.startDate !== r.startDate || vorige.endDate !== r.endDate;
        });
        const alleenZiekte = gewijzigd.length > 0 && gewijzigd.every((r) => r.type === 'ziekte');
        showToast(alleenZiekte ? 'Ziekmelding bijgewerkt.' : isNewRequest ? 'Aanvraag ingediend, de planner beoordeelt ze.' : 'Verlofaanvraag bijgewerkt.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      if (!isActueel()) return false;
      // Zelfde onderscheid als bij de dienstruilen (ruil.ts): alleen een echt
      // revisieconflict ververst en vraagt opnieuw; een 409 met een reden
      // ("al afgehandeld") toont die reden.
      if (isRevisieConflict(response.status, err)) {
        return verversVoorOpnieuw('De verlofaanvragen zijn intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.');
      }
      laatSchrijffout('Opslaan van verlofaanvragen', { status: response.status, message: err.details || err.error }, toonSchrijffout);
      return false;
    } catch (error) {
      if (!isActueel()) return false;
      console.error('Error saving leave:', error);
      laatSchrijffout('Opslaan van verlofaanvragen', error, toonSchrijffout);
      return false;
    }
  };

  /** Ziekmelding: aparte, directe flow (geen goedkeuring). POST → verse
   *  verloflijst ophalen zodat de ziekte-dag meteen zichtbaar is. */
  const reportSick = async (payload: { userId: string; startDate?: string; endDate?: string; comment?: string }): Promise<boolean> => {
    const k = kruising.current;
    const isActueel = () => kruising.current === k;
    const toonSchrijffout = (tekst: string) => { if (isActueel()) showToast(tekst, 'error'); };
    try {
      const response = await apiFetch('/api/leave/sick-report', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!isActueel()) return false;
      if (response.ok) {
        // Dekking meteen mee verversen: het gat dat deze ziekmelding slaat
        // moet direct in "Open taken" en Openstaande diensten staan — dít is
        // het moment waarop de planner een vervanger zoekt, niet na een
        // harde refresh. Best-effort naast de leave-fetch.
        await Promise.all([fetchLeave(), refreshCoverageGaps()]);
        if (!isActueel()) return false;
        showToast('Ziekmelding doorgegeven, de planning is verwittigd.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      if (!isActueel()) return false;
      laatSchrijffout('Ziekmelding', { status: response.status, message: err.error }, toonSchrijffout);
      return false;
    } catch (error) {
      if (!isActueel()) return false;
      console.error('Error reporting sick:', error);
      laatSchrijffout('Ziekmelding', error, toonSchrijffout);
      return false;
    }
  };

  /** `reden` = vrije tekst van de planner bij een afwijzing (wens Jarno
   *  22-09); de server negeert hem bij elke andere status. */
  const decideLeave = (id: string, status: LeaveRequest['status'], seenStatus?: string, reden?: string): Promise<boolean> => {
    const k = kruising.current!;
    const isActueel = () => kruising.current === k;
    const current = leaveRequests.find((r) => r.id === id);
    // Record niet (meer) lokaal → onze lijst is stale; ifStatus is server-
    // side verplicht, dus eerst verversen i.p.v. een kansloze PATCH.
    if (!current) { void fetchLeave(); return Promise.resolve(false); }
    // ifStatus = wat de beslisser ZAG (seenStatus uit de view), niet de live
    // state: realtime kan de lijst intussen ververst hebben met de beslissing
    // van een collega — met de live status als referentie keurt de check dan
    // altijd goed en is de guard feitelijk uitgeschakeld (controleronde 30/07).
    const van = seenStatus ?? current.status;
    return ctx.decideViaPatch('leave', id, status, van, fetchLeave, (updated) => {
      k.nr += 1;
      if (k.lopend.size > 0) k.recent.push({ nr: k.nr, id, van, record: updated });
      setVerlof((curr) => ({ ...curr, lijst: curr.lijst.map((r) => (r.id === id ? { ...r, ...updated } : r)) }));
    }, reden ? { reden } : undefined, isActueel).then((ok) => {
      if (!isActueel()) return false;
      // Een goedkeuring maakt een dienst tot dekkingsgat: dashboard en
      // topbar-badge meteen laten meebewegen.
      if (ok) void refreshCoverageGaps();
      return ok;
    });
  };

  const markLeaveDecisionsSeen = () => {
    if (!currentUser) return;
    const now = new Date().toISOString();
    setLastSeenLeaveDecisionAt(now);
    try {
      localStorage.setItem(`planx-leave-lastseen-${currentUser.id}`, now);
    } catch {
      // ignore quota / unavailable storage
    }
    // Server is de bron (15-09): per toestel in localStorage betekende dat
    // een nieuw toestel elke beslissing ooit als "nieuw" toonde.
    void apiFetch('/api/me/voorkeuren', { method: 'PATCH', body: JSON.stringify({ dashboard: { verlofGezienOp: now } }) }).catch(() => undefined);
  };

  useEffect(() => {
    if (!currentUser) {
      setLastSeenLeaveDecisionAt(null);
      return;
    }
    // Server-waarde eerst (geldt op elk toestel); localStorage als terugval
    // voor accounts van vóór deze wijziging of een niet-gelukte PATCH. De
    // jongste van de twee wint, zodat een oud servertijdstip een recentere
    // lokale "gezien" niet terugdraait.
    let lokaal: string | null = null;
    try {
      lokaal = localStorage.getItem(`planx-leave-lastseen-${currentUser.id}`);
    } catch {
      lokaal = null;
    }
    const server = currentUser.dashboardVoorkeuren?.verlofGezienOp ?? null;
    setLastSeenLeaveDecisionAt([lokaal, server].filter(Boolean).sort().pop() ?? null);
  }, [currentUser?.id]);

  // Extra vrije dagen van de beheerder (naast de wettelijke feestdagen): één
  // keer laden per sessie en meteen als standaard in de verloftelling zetten
  // (leaveBalance.stelExtraFeestdagenIn), zodat elk saldo in de app ze
  // meerekent zonder ze door te geven.
  const [feestdagenExtra, setFeestdagenExtra] = useState<ExtraFeestdag[]>([]);
  const zetFeestdagenExtra = (extra: ExtraFeestdag[]) => {
    setFeestdagenExtra(extra);
    stelExtraFeestdagenIn(extra.map((d) => d.datum));
  };
  useEffect(() => {
    // Pas zodra er met de API gepraat mag worden (DataBasis.dataKlaar).
    if (!ctx.dataKlaar || !currentUser) return;
    let weg = false;
    void (async () => {
      try {
        const data = await apiJson<unknown>('/api/verlof/feestdagen');
        if (!weg) zetFeestdagenExtra(parseExtraFeestdagenLos(data));
      } catch {
        // standaard (alleen wettelijke feestdagen) blijft staan
      }
    })();
    return () => { weg = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.dataKlaar, currentUser?.id]);

  /** Bij uitloggen: de aanvragen leeg (lastSeen wordt door het effect hierboven beheerd). */
  const resetVerlof = () => {
    kruising.current = nieuweKruising();
    ctx.captureRevision('leave');
    setVerlof({ lijst: [], samengesteld: false });
    zetFeestdagenExtra([]);
  };

  return { leaveRequests, lastSeenLeaveDecisionAt, fetchLeave, saveLeave, reportSick, decideLeave, markLeaveDecisionsSeen, resetVerlof, feestdagenExtra, zetFeestdagenExtra };
}
