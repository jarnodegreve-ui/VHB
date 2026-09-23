import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarClock, CalendarDays, IdCard, Repeat, ShieldCheck, Smartphone, UserX } from 'lucide-react';
import type { User, View } from '../types';
import { useAppDataContext } from '../app/AppDataContext';
import {
  WERK_SOORTEN, WERK_SOORT_LABELS, berekenWerkvoorraad, telPerSoort, werkvoorraadItems,
  type WerkItem, type WerkSoort,
} from '../lib/werkvoorraad';
import { EXPIRY_SOORT_LABELS, formatShortDay } from '../lib/format';
import { apiJson } from '../lib/api';
import { cn, notify } from '../lib/ui';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../components/ui';
import { AllesGedaan } from '../components/illustraties';
import { OpsRow, OpsStat } from '../components/ops';
import { Badge, Button, FilterChip, type BadgeTone } from '../components/primitives';
import { SortTh, StickyThead, TableToolbar, useSort, useTabelVoorkeur } from '../components/Table';
import { Td, Th } from '../components/TabelBasis';
import { meldSchrijffout } from '../lib/fouten';

/**
 * Werkvoorraad, het volledige overzicht (punt 14, 15-09). Het dashboardpaneel
 * "Open taken" en het menu in de topbar tonen een top-N per soort; dit scherm
 * toont álles, oudste aanvraag of dichtstbijzijnde datum eerst, met een
 * tegel én chip per soort als filter (patroon Vervaldata). Dezelfde
 * berekening als de badge (lib/werkvoorraad), dus de som van de tegels is
 * altijd het getal op de knop in de topbar.
 *
 * Elke rij brengt je naar de plek waar de beslissing genomen wordt (verlof
 * met conflictcontrole, ruil met validatie, ziekte met herverdeel-knoppen).
 * Enige actie hier: een toestel goedkeuren (admin), omdat dat schrijfpad
 * geen extra context nodig heeft; verlof en ruil bewust niet in bulk.
 */
type SoortIcoon = Record<WerkSoort, ReactNode>;
const ICOON: SoortIcoon = {
  verlof: <CalendarDays size={16} />,
  ruil: <Repeat size={16} />,
  herverdelen: <UserX size={16} />,
  dekking: <AlertTriangle size={16} />,
  toestellen: <Smartphone size={16} />,
  vervaldata: <IdCard size={16} />,
  planning: <CalendarClock size={16} />,
};
const SUB_OPEN: Record<WerkSoort, string> = {
  verlof: 'wacht op een beslissing',
  ruil: 'wacht op validatie',
  herverdelen: 'diensten van afwezigen',
  dekking: 'dagen met een gat',
  toestellen: 'wachten op goedkeuring',
  vervaldata: 'binnen 30 dagen',
  planning: 'import en horizon',
};
const BADGE_TONE: Record<WerkItem['tone'], BadgeTone> = { red: 'red', amber: 'amber', blue: 'blue' };

type Filter = WerkSoort | 'all';
type SortKolom = 'wanneer' | 'soort' | 'titel';

type DeviceRij = { userId: string; deviceToken: string; name: string; createdAt: string; status: string };

export function WerkvoorraadView({
  currentUser,
  onNavigate,
}: {
  currentUser: User;
  onNavigate: (view: View, params?: readonly string[]) => void;
}) {
  const {
    users, shifts, leaveRequests, swaps,
    planningMatrixHistory, coverageDays, vervaldata, pendingDevices,
  } = useAppDataContext();
  const isAdmin = currentUser.role === 'admin';

  // Minuutklok voor "12 min geleden" en de dagdrempels; zelfde ritme als de cockpit.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const werkvoorraad = useMemo(
    () => berekenWerkvoorraad({ users, shifts, leaveRequests, swaps, matrixHistory: planningMatrixHistory, coverageDays, vervaldata, pendingDevices, now }),
    [users, shifts, leaveRequests, swaps, planningMatrixHistory, coverageDays, vervaldata, pendingDevices, now],
  );
  const alleItems = useMemo(() => werkvoorraadItems(werkvoorraad, {
    naamVan: (id) => users.find((u) => String(u.id) === String(id))?.name || 'Onbekend',
    now,
    formatDag: formatShortDay,
    soortLabel: (s) => EXPIRY_SOORT_LABELS[s] ?? s,
  }), [werkvoorraad, users, now]);

  // Hier goedgekeurde toestellen verdwijnen meteen uit de lijst; de datalaag
  // (pendingDevices, elke 10 min en bij tab-focus) haalt de rest bij.
  const [afgehandeld, setAfgehandeld] = useState<ReadonlySet<string>>(() => new Set());
  const items = useMemo(() => alleItems.filter((it) => !afgehandeld.has(it.key)), [alleItems, afgehandeld]);
  const tellers = useMemo(() => telPerSoort(items), [items]);
  const totaal = items.reduce((n, it) => n + it.aantal, 0);
  // Toestellen komen uit een admin-only API; voor een planner is die tegel
  // altijd 0 en dus misleidend, daarom niet tonen.
  const soorten = WERK_SOORTEN.filter((s) => s !== 'toestellen' || isAdmin);

  const [filter, setFilter] = useState<Filter>('all');
  const [zoek, setZoek] = useState('');
  const sort = useSort<SortKolom>('wanneer');
  const voorkeur = useTabelVoorkeur('werkvoorraad');
  const kiesFilter = (f: WerkSoort) => setFilter((cur) => (cur === f ? 'all' : f));
  const zoekTerm = zoek.trim().toLowerCase();
  const gefilterd = items
    .filter((it) => filter === 'all' || it.soort === filter)
    .filter((it) => !zoekTerm || `${it.titel} ${it.detail ?? ''} ${it.naam ?? ''}`.toLowerCase().includes(zoekTerm));
  const gesorteerd = sort.sorteer(gefilterd, (it, k) => (
    k === 'wanneer' ? it.wanneer : k === 'soort' ? WERK_SOORT_LABELS[it.soort] : it.titel
  ));
  const filterActief = zoekTerm !== '' || filter !== 'all';
  const wisFilters = () => { setZoek(''); setFilter('all'); };

  const open = (it: WerkItem) => onNavigate(it.doel, it.doelParams);

  // Toestellen goedkeuren: dezelfde POST als het Toestellen-scherm. De
  // werkvoorraad kent bewust geen tokens (PendingDevice = userId, naam,
  // datum), dus eerst de actuele lijst ophalen en per rij matchen; wat
  // intussen al goedgekeurd of geschrapt is slaan we stil over.
  const [bezig, setBezig] = useState<string | null>(null);
  const [bevestigAlle, setBevestigAlle] = useState(false);
  const toestelItems = items.filter((it) => it.soort === 'toestellen');
  const keurGoed = async (doelen: WerkItem[], sleutel: string) => {
    if (bezig || doelen.length === 0) return;
    setBezig(sleutel);
    let gelukt = 0;
    let mislukt = 0;
    try {
      const alle = await apiJson<DeviceRij[]>('/api/devices');
      for (const it of doelen) {
        const t = it.toestel;
        const rij = Array.isArray(alle)
          ? alle.find((d) => d.status === 'pending' && String(d.userId) === String(t?.userId) && d.name === t?.name && d.createdAt === t?.createdAt)
          : undefined;
        if (!rij) { setAfgehandeld((cur) => new Set(cur).add(it.key)); continue; }
        try {
          await apiJson('/api/devices/approve', { method: 'POST', body: JSON.stringify({ userId: rij.userId, deviceToken: rij.deviceToken }) });
          gelukt += 1;
          setAfgehandeld((cur) => new Set(cur).add(it.key));
        } catch {
          mislukt += 1;
        }
      }
      if (mislukt === 0) notify(gelukt === 1 ? 'Toestel goedgekeurd.' : `${gelukt} toestellen goedgekeurd.`, 'success');
      else notify(`${gelukt} goedgekeurd, ${mislukt} mislukt. Probeer het opnieuw of open Toestellen.`, 'error');
    } catch (err) {
      meldSchrijffout('Toestellen ophalen', err);
    } finally {
      setBezig(null);
    }
  };

  const tegelTone = (soort: WerkSoort): 'red' | 'amber' | 'blue' | 'slate' => {
    if (tellers[soort] === 0) return 'slate';
    const vanSoort = items.filter((it) => it.soort === soort);
    if (vanSoort.some((it) => it.tone === 'red')) return 'red';
    return vanSoort.some((it) => it.tone === 'blue') ? 'blue' : 'amber';
  };
  const tegelSub = (soort: WerkSoort): string => {
    if (soort === 'dekking' && coverageDays === null) return 'dekking nog niet geladen';
    return tellers[soort] > 0 ? SUB_OPEN[soort] : 'niets open';
  };

  const chips = (
    <>
      <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>Alles</FilterChip>
      {soorten.map((s) => (
        <FilterChip key={s} active={filter === s} onClick={() => kiesFilter(s)}>
          {WERK_SOORT_LABELS[s]}{tellers[s] > 0 ? ` (${tellers[s]})` : ''}
        </FilterChip>
      ))}
    </>
  );
  const toonActieKolom = isAdmin && toestelItems.length > 0;

  return (
    <PageShell>
      <PageHeader
        view="werkvoorraad"
        title="Overzicht"
        description="Alles wat op een beslissing wacht, het dringendste eerst. Een rij opent het scherm waar je beslist."
      />

      {/* Tegels per soort = filter (patroon Vervaldata); de som is het getal
          op de overzicht-knop in de topbar. */}
      <div className="kpi-raster grid grid-cols-2 gap-3 md:grid-cols-4">
        {soorten.map((s) => (
          <OpsStat
            key={s}
            icon={ICOON[s]}
            tone={tegelTone(s)}
            label={WERK_SOORT_LABELS[s]}
            value={tellers[s]}
            sub={tegelSub(s)}
            onClick={() => kiesFilter(s)}
            actief={filter === s}
          />
        ))}
      </div>

      {totaal === 0 ? (
        <EmptyState
          variant="klaar"
          illustratie={<AllesGedaan />}
          title="Alles afgehandeld"
          message="Er wacht niets op een beslissing. Nieuwe aanvragen, open diensten en vervaldata verschijnen hier vanzelf."
        />
      ) : (
        <div className="surface-table rounded-3xl overflow-clip">
          <div className="border-b border-hairline px-5 py-4 md:px-6">
            <TableToolbar
              rand="kaart"
              zoek={zoek}
              onZoek={setZoek}
              placeholder="Zoek op naam of omschrijving…"
              telling={`${gesorteerd.length} van ${items.length}`}
              dichtheid={voorkeur.dichtheid}
              filters={chips}
              acties={isAdmin && toestelItems.length >= 2 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ShieldCheck size={16} />}
                  bezig={bezig === 'alle'}
                  disabled={bezig !== null}
                  onClick={() => setBevestigAlle(true)}
                >
                  Alle toestellen goedkeuren ({toestelItems.length})
                </Button>
              ) : undefined}
            />
          </div>

          {gesorteerd.length === 0 ? (
            <div className="p-6">
              <EmptyState
                variant="klaar"
                title={zoekTerm ? `Geen resultaten voor “${zoek.trim()}”` : `Niets open bij ${filter === 'all' ? 'dit filter' : WERK_SOORT_LABELS[filter].toLowerCase()}`}
                message={zoekTerm ? 'Pas de zoekterm of het filter aan.' : 'Hier valt op dit moment niets te beslissen.'}
                action={filterActief ? <Button variant="secondary" onClick={wisFilters}>Zoekterm en filter wissen</Button> : undefined}
              />
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className={cn('w-full text-left border-collapse', voorkeur.tabelClass)}>
                  <StickyThead>
                    <tr>
                      <SortTh kolom="soort" sort={sort} className="w-40">Soort</SortTh>
                      <SortTh kolom="titel" sort={sort}>Wat</SortTh>
                      <SortTh kolom="wanneer" sort={sort} align="right" className="w-44" title="Aanvragen: hoe lang ze al wachten. Datums: hoe dichtbij ze zijn.">Wanneer</SortTh>
                      {toonActieKolom && <Th className="w-40 text-right">Actie</Th>}
                    </tr>
                  </StickyThead>
                  <tbody>
                    {gesorteerd.map((it) => (
                      <tr
                        key={it.key}
                        onClick={() => open(it)}
                        className="cursor-pointer border-b border-hairline-subtle last:border-b-0 transition-colors hover:bg-surface-soft-hover"
                      >
                        <Td>
                          <Badge tone={BADGE_TONE[it.tone]} dot className="whitespace-nowrap">{WERK_SOORT_LABELS[it.soort]}</Badge>
                        </Td>
                        <Td>
                          <p className="font-semibold text-slate-800">{it.titel}</p>
                          {it.detail && <p className="text-xs font-medium text-slate-500">{it.detail}</p>}
                        </Td>
                        <Td num className={cn('text-xs font-medium', it.tone === 'red' ? 'text-red-700' : 'text-slate-600')}>{it.wanneerTekst}</Td>
                        {toonActieKolom && (
                          <Td className="text-right">
                            {it.soort === 'toestellen' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                icon={<ShieldCheck size={16} />}
                                bezig={bezig === it.key}
                                disabled={bezig !== null}
                                onClick={(e) => { e.stopPropagation(); void keurGoed([it], it.key); }}
                              >
                                Goedkeuren
                              </Button>
                            )}
                          </Td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobiel: dezelfde rijen als het dashboardpaneel. Goedkeuren van
                  een toestel gaat hier via de rij (Toestellen-scherm) of via
                  de bulkknop, geen knop in de rij (OpsRow is zelf een knop). */}
              <div className="md:hidden space-y-1.5 p-3">
                {gesorteerd.map((it) => (
                  <OpsRow
                    key={it.key}
                    tone={it.tone}
                    icon={ICOON[it.soort]}
                    primary={it.titel}
                    secondary={it.detail}
                    meta={it.wanneerTekst}
                    onClick={() => open(it)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <ConfirmationModal
        open={bevestigAlle}
        onClose={() => setBevestigAlle(false)}
        onConfirm={() => { setBevestigAlle(false); void keurGoed(toestelItems, 'alle'); }}
        title={`${toestelItems.length} toestellen goedkeuren?`}
        message={`Deze toestellen krijgen meteen toegang: ${toestelItems.map((it) => `${it.naam} (${it.detail})`).join(', ')}. Twijfel je over één ervan, keur ze dan apart goed.`}
        confirmText="Goedkeuren"
        variant="warning"
      />
    </PageShell>
  );
}
