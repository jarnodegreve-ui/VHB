import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouteParam } from '../app/router';
import { AlertTriangle, ChevronRight, MapPin, Phone, Repeat, UserX } from 'lucide-react';
import type { LeaveRequest, View } from '../types';
import { useAppDataContext } from '../app/AppDataContext';
import { addDays, isoDate } from '../lib/availability';
import { WEEKSTROOK_DAGEN, bouwDagBriefing, bouwWeekPunten, briefingKop, dagWoordVoor, type BriefingAfwezige, type BriefingRuil, type WeekDagPunt } from '../lib/dagBriefing';
import { WEEKDAY_SHORT_MON, formatDatumDMJ, formatDayLong } from '../lib/format';
import { cn } from '../lib/ui';
import { telHref } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { AllesGedaan } from '../components/illustraties';
import { Avatar } from '../components/Avatar';
import { LijnTegel } from '../components/LijnTegel';
import { OpsPanel, OpsRow } from '../components/ops';
import { Badge, Button, Pressable } from '../components/primitives';
import { Card } from '../components/Card';
import { ServiceChip } from '../components/ServiceChip';

/**
 * Vandaag, de dagbriefing van de planner (verbeterronde 4, punt 4). Eén dag,
 * vier vragen: wie is er afwezig en staat er nog een dienst op zijn naam,
 * welke diensten hebben geen chauffeur, welke ruilen raken deze dag, en welke
 * omleidingen lopen er. Bij alles wat nog een beslissing vraagt staat de weg
 * naar het scherm waar je beslist; wat al geregeld is staat er stil bij, zodat
 * je 's ochtends ook ziet wie er in de plaats van wie rijdt.
 *
 * Het Overzicht toont dezelfde taken over alle dagen heen; de rekenkern
 * (src/lib/dagBriefing.ts) deelt zijn regels met de werkvoorraad, dus een
 * dienst van een zieke telt ook hier niet dubbel als open dienst.
 *
 * Boven de panelen staat de weekstrook (03-10): de zeven dagen vanaf vandaag
 * met per dag het aantal punten dat nog een beslissing vraagt, en een tik op
 * een dag toont die dag. Ze verving de schakelaar Vandaag|Morgen: voor de rest
 * van de week moest je naar Openstaande diensten. De gekozen dag staat in de
 * URL (`/vandaag/<yyyy-mm-dd>`, vandaag zonder segment), zodat terugkeren uit
 * een ruil of verlofaanvraag op dezelfde dag landt.
 */
const AFWEZIG_WOORD: Record<LeaveRequest['type'], string> = { ziekte: 'Ziek', betaald_verlof: 'Verlof', klein_verlet: 'Klein verlet' };

const hoofdletter = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Eén stille regel in plaats van een lege kaart (ronde 3, compositie). */
function Stil({ children }: { children: ReactNode }) {
  return <p className="px-1 py-1 text-body-sm text-slate-500">{children}</p>;
}

/**
 * De weekstrook: zeven dagen vanaf vandaag, elk een knop. Goud alleen voor
 * vandaag (= "nu", zoals de dagstrip van de Maandplanning), de gekozen dag is
 * neutraal (`bg-surface-muted` + hairline). Het cijfer is het aantal punten
 * dat die dag nog een beslissing vraagt: amber als het er zijn, stil als het
 * nul is, een streepje zolang de dekking van die dag niet geladen is (nul mag
 * nooit "nog niet geladen" betekenen).
 */
function Weekstrook({ week, vandaag, gekozen, onKies }: {
  week: WeekDagPunt[];
  vandaag: string;
  gekozen: string;
  onKies: (dag: string) => void;
}) {
  return (
    <Card padding="none" className="overflow-hidden">
      <div role="group" aria-label="Dag kiezen" className="grid grid-cols-7 divide-x divide-hairline-subtle">
        {week.map((punt) => {
          const d = new Date(`${punt.dag}T00:00:00`);
          const isVandaag = punt.dag === vandaag;
          const actief = punt.dag === gekozen;
          const woord = hoofdletter(dagWoordVoor(punt.dag, vandaag));
          const telling = punt.onbekend
            ? 'dekking nog niet geladen'
            : punt.aandacht === 0 ? 'niets te beslissen' : `${punt.aandacht} ${punt.aandacht === 1 ? 'punt vraagt' : 'punten vragen'} een beslissing`;
          return (
            <Pressable
              key={punt.dag}
              onClick={() => onKies(punt.dag)}
              aria-pressed={actief}
              aria-label={`${woord}, ${formatDayLong(punt.dag)}: ${telling}`}
              className={cn(
                'flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-center',
                actief && 'bg-surface-muted ring-1 ring-inset ring-hairline',
              )}
            >
              <span aria-hidden="true" className="text-micro">{WEEKDAY_SHORT_MON[(d.getDay() + 6) % 7]}</span>
              <span aria-hidden="true" className={cn('text-sm font-bold tabular-nums leading-tight', isVandaag ? 'text-oker-800' : 'text-slate-800')}>
                {d.getDate()}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'mt-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-2xs font-bold tabular-nums leading-none',
                  punt.onbekend ? 'text-slate-400' : punt.aandacht > 0 ? 'bg-amber-500/15 text-amber-700' : 'text-slate-400',
                )}
              >
                {punt.onbekend ? '–' : punt.aandacht}
              </span>
            </Pressable>
          );
        })}
      </div>
    </Card>
  );
}

export function VandaagView({ onNavigate }: { onNavigate: (view: View, params?: string[]) => void }) {
  const { users, shifts, leaveRequests, swaps, diversions, coverageDays } = useAppDataContext();
  // De dag verspringt om middernacht; een tik per minuut volstaat.
  const [vandaag, setVandaag] = useState(() => isoDate(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setVandaag(isoDate(new Date())), 60000);
    return () => clearInterval(timer);
  }, []);
  // Gekozen dag uit de URL; alleen een dag binnen de week vanaf vandaag telt,
  // al de rest (ongeldig, verleden, verder weg) is vandaag.
  const [dagParam, zetDagParam] = useRouteParam(0);
  const laatsteDag = isoDate(addDays(new Date(`${vandaag}T00:00:00`), WEEKSTROOK_DAGEN - 1));
  const dag = dagParam && /^\d{4}-\d{2}-\d{2}$/.test(dagParam) && dagParam >= vandaag && dagParam <= laatsteDag ? dagParam : vandaag;
  const dagWoord = dagWoordVoor(dag, vandaag);
  const kiesDag = (d: string) => zetDagParam(d === vandaag ? null : d);

  const briefing = useMemo(
    () => bouwDagBriefing({ dag, users, shifts, leaveRequests, swaps, diversions, coverageDays }),
    [dag, users, shifts, leaveRequests, swaps, diversions, coverageDays],
  );
  const week = useMemo(
    () => bouwWeekPunten({ vandaag, users, shifts, leaveRequests, swaps, diversions, coverageDays }),
    [vandaag, users, shifts, leaveRequests, swaps, diversions, coverageDays],
  );
  const naamVan = (id: string | null) => (id ? users.find((u) => String(u.id) === id)?.name ?? `Onbekend (${id})` : 'nog geen collega');

  const teHerverdelen = briefing.afwezigen.filter((a) => a.diensten.length > 0);
  const rustigAfwezig = briefing.afwezigen.filter((a) => a.diensten.length === 0);
  const helemaalLeeg = briefing.aandacht === 0 && briefing.afwezigen.length === 0 && briefing.ruilen.length === 0
    && briefing.omleidingen.length === 0 && briefing.openDiensten !== null;

  const afwezigTekst = (a: BriefingAfwezige) =>
    `${AFWEZIG_WOORD[a.type]}${a.tot > dag ? ` t/m ${formatDatumDMJ(a.tot)}` : ''}`;
  const ruilTekst = (r: BriefingRuil) =>
    r.open
      ? `${naamVan(r.vanId)} → ${naamVan(r.naarId)}`
      : `${naamVan(r.naarId)} rijdt in de plaats van ${naamVan(r.vanId)}`;

  return (
    <PageShell>
      <PageHeader
        view="vandaag"
        title={hoofdletter(dagWoord)}
        description={`${hoofdletter(formatDayLong(dag))} · ${briefingKop(briefing, dagWoord)}`}
      />

      <Weekstrook week={week} vandaag={vandaag} gekozen={dag} onKies={kiesDag} />

      {helemaalLeeg ? (
        <EmptyState
          variant="klaar"
          illustratie={<AllesGedaan />}
          title={`Niets te melden voor ${dagWoord}`}
          message="Niemand afwezig, elke dienst heeft een chauffeur, en er lopen geen ruilen of omleidingen."
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <OpsPanel
            icon={<UserX size={16} />}
            title="Afwezig"
            aside={briefing.afwezigen.length > 0 ? `${briefing.afwezigen.length} ${briefing.afwezigen.length === 1 ? 'collega' : 'collega’s'}` : undefined}
          >
            {briefing.afwezigen.length === 0 ? (
              <Stil>Niemand afwezig gemeld.</Stil>
            ) : (
              <div className="space-y-1.5">
                {teHerverdelen.map((a) => (
                  <OpsRow
                    key={a.userId}
                    tone="red"
                    icon={<UserX size={16} />}
                    // Kort genoeg voor een telefoon: de rij kapt af, en wat
                    // er moet gebeuren mag daar niet in verdwijnen.
                    primary={a.naam}
                    secondary={`${AFWEZIG_WOORD[a.type]} · ${a.diensten.map((d) => `${d.line} (${d.startTime})`).join(', ')} te herverdelen`}
                    onClick={() => onNavigate('ziekte')}
                  />
                ))}
                {rustigAfwezig.length > 0 && (
                  <ul className="divide-y divide-hairline-subtle">
                    {rustigAfwezig.map((a) => {
                      const href = telHref(a.phone);
                      return (
                        <li key={a.userId} className="flex items-center gap-3 px-1 py-2">
                          {/* Verlof opent de aanvraag zelf (`/verlof/<id>`, tranche 3C);
                              ziekte heeft zijn eigen scherm en blijft hier stil. */}
                          {a.type === 'ziekte' ? (
                            <>
                              <Avatar naam={a.naam} size="sm" naamZichtbaar={false} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-slate-800">{a.naam}</span>
                                <span className="block text-xs text-slate-500">{afwezigTekst(a)} · geen dienst op zijn naam</span>
                              </span>
                            </>
                          ) : (
                            <Pressable
                              onClick={() => onNavigate('verlof', [a.leaveId])}
                              aria-label={`Verlofaanvraag van ${a.naam} openen`}
                              className="-my-1 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg hover:bg-surface-soft-hover"
                            >
                              <Avatar naam={a.naam} size="sm" naamZichtbaar={false} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-slate-800">{a.naam}</span>
                                <span className="block text-xs text-slate-500">{afwezigTekst(a)} · geen dienst op zijn naam</span>
                              </span>
                              <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
                            </Pressable>
                          )}
                          {href && (
                            <a href={href} aria-label={`Bel ${a.naam}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-surface-soft-hover hover:text-slate-800">
                              <Phone size={16} />
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </OpsPanel>

          <OpsPanel
            icon={<AlertTriangle size={16} />}
            title="Open diensten"
            aside={briefing.openDiensten && briefing.openDiensten.length > 0 ? `${briefing.openDiensten.length} zonder chauffeur` : undefined}
          >
            {briefing.openDiensten === null ? (
              <Stil>De dekking is nog niet geladen.</Stil>
            ) : briefing.openDiensten.length === 0 ? (
              <Stil>Elke verwachte dienst heeft een chauffeur.</Stil>
            ) : (
              <div className="space-y-3">
                <ul className="flex flex-wrap gap-1.5" aria-label="Diensten zonder chauffeur">
                  {briefing.openDiensten.map((code) => (
                    <li key={code}><ServiceChip serviceNumber={code} /></li>
                  ))}
                </ul>
                <Button variant="secondary" size="sm" full onClick={() => onNavigate('dekking', [dag.slice(0, 7)])}>
                  Chauffeur toewijzen
                </Button>
              </div>
            )}
          </OpsPanel>

          <OpsPanel
            icon={<Repeat size={16} />}
            title="Dienstruilen"
            aside={briefing.ruilen.length > 0 ? `${briefing.ruilen.length} op deze dag` : undefined}
          >
            {briefing.ruilen.length === 0 ? (
              <Stil>Geen ruilen op deze dag.</Stil>
            ) : (
              <div className="space-y-1.5">
                {briefing.ruilen.map((r) => {
                  const teKort = r.open && (r.swap.rust ?? []).some((regel) => regel.teKort);
                  return r.open ? (
                    <OpsRow
                      key={`${r.swap.id}-${r.kant}`}
                      tone={teKort ? 'amber' : 'blue'}
                      icon={<Repeat size={16} />}
                      primary={ruilTekst(r)}
                      secondary={[
                        `Dienst ${r.dienst}`,
                        r.swap.status === 'accepted' ? 'collega akkoord, wacht op validatie' : 'wacht op de collega',
                        teKort ? 'te weinig rust' : null,
                      ].filter(Boolean).join(' · ')}
                      onClick={() => onNavigate('ruil-verzoeken', [r.swap.id])}
                    />
                  ) : (
                    <div key={`${r.swap.id}-${r.kant}`} className="flex items-center gap-3 px-1 py-2">
                      <ServiceChip serviceNumber={r.dienst} />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{ruilTekst(r)}</span>
                      <Badge kaal tone="emerald">Goedgekeurd</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </OpsPanel>

          <OpsPanel
            icon={<MapPin size={16} />}
            title="Omleidingen"
            aside={briefing.omleidingen.length > 0 ? `${briefing.omleidingen.length} actief` : undefined}
          >
            {briefing.omleidingen.length === 0 ? (
              <Stil>Geen omleidingen op deze dag.</Stil>
            ) : (
              <div className="space-y-1.5">
                {briefing.omleidingen.map((d) => (
                  <OpsRow
                    key={d.id}
                    tone="amber"
                    leading={<LijnTegel line={d.line} size="sm" layout="rij" />}
                    primary={d.title}
                    secondary={`t/m ${formatDatumDMJ(d.endDate)}`}
                    onClick={() => onNavigate('omleidingen', [String(d.id)])}
                  />
                ))}
              </div>
            )}
          </OpsPanel>
        </div>
      )}
    </PageShell>
  );
}
