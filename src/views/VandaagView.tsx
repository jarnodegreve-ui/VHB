import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, MapPin, Phone, Repeat, UserX } from 'lucide-react';
import type { LeaveRequest, View } from '../types';
import { useAppDataContext } from '../app/AppDataContext';
import { addDays, isoDate } from '../lib/availability';
import { bouwDagBriefing, briefingKop, type BriefingAfwezige, type BriefingRuil } from '../lib/dagBriefing';
import { formatDatumDMJ, formatDayLong } from '../lib/format';
import { telHref } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { AllesGedaan } from '../components/illustraties';
import { Avatar } from '../components/Avatar';
import { LijnTegel } from '../components/LijnTegel';
import { OpsPanel, OpsRow } from '../components/ops';
import { Badge, Button, Segmented } from '../components/primitives';
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
 */
const AFWEZIG_WOORD: Record<LeaveRequest['type'], string> = { ziekte: 'Ziek', betaald_verlof: 'Verlof', klein_verlet: 'Klein verlet' };

const hoofdletter = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Eén stille regel in plaats van een lege kaart (ronde 3, compositie). */
function Stil({ children }: { children: ReactNode }) {
  return <p className="px-1 py-1 text-body-sm text-slate-500">{children}</p>;
}

export function VandaagView({ onNavigate }: { onNavigate: (view: View, params?: string[]) => void }) {
  const { users, shifts, leaveRequests, swaps, diversions, coverageDays } = useAppDataContext();
  const [dagOffset, setDagOffset] = useState<0 | 1>(0);
  // De dag verspringt om middernacht; een tik per minuut volstaat.
  const [vandaag, setVandaag] = useState(() => isoDate(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setVandaag(isoDate(new Date())), 60000);
    return () => clearInterval(timer);
  }, []);
  const dag = dagOffset === 0 ? vandaag : isoDate(addDays(new Date(`${vandaag}T00:00:00`), 1));
  const dagWoord = dagOffset === 0 ? 'vandaag' : 'morgen';

  const briefing = useMemo(
    () => bouwDagBriefing({ dag, users, shifts, leaveRequests, swaps, diversions, coverageDays }),
    [dag, users, shifts, leaveRequests, swaps, diversions, coverageDays],
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
        actions={
          <Segmented
            label="Dag kiezen"
            itemClassName="min-h-11 sm:pointer-fine:min-h-8"
            waarde={dagOffset}
            opties={[{ waarde: 0 as const, label: 'Vandaag' }, { waarde: 1 as const, label: 'Morgen' }]}
            onChange={setDagOffset}
          />
        }
      />

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
                          <Avatar naam={a.naam} size="sm" naamZichtbaar={false} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-800">{a.naam}</span>
                            <span className="block text-xs text-slate-500">{afwezigTekst(a)} · geen dienst op zijn naam</span>
                          </span>
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
                        r.swap.status === 'accepted' ? 'collega akkoord, te valideren' : 'wacht op de collega',
                        teKort ? 'te weinig rust' : null,
                      ].filter(Boolean).join(' · ')}
                      onClick={() => onNavigate('ruil-verzoeken')}
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
