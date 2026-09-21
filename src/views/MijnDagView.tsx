import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Calendar, FileText, MapPin, WifiOff, Wrench } from 'lucide-react';
import { useOptioneleAppData } from '../app/AppDataContext';
import { lopendeDiversions } from '../lib/diversions';
import { addDays, isoDate } from '../lib/availability';
import { relatieveDag } from '../lib/datum';
import { formatDayLong, formatShortDay, formatSyncedTime, serviceNumberOf } from '../lib/format';
import { geruildeDiensten, ruilBadgeLabel, ruilSleutel, type RuilBadge } from '../lib/ruilBadge';
import { warmRitbladCache } from '../lib/ritbladCache';
import { spiegelStartscherm } from '../lib/dashboardVoorkeuren';
import { useOnline } from '../lib/useOnline';
import { formatDuration, hasShiftEnded, isShiftActiveAt, shiftWindowMinutes } from '../lib/shiftTime';
import { cn } from '../lib/ui';
import type { Diversion, Shift, SwapRequest, User, View } from '../types';
import { Card } from '../components/Card';
import { OpsRow } from '../components/ops';
import { LijnTegel } from '../components/LijnTegel';
import { Badge, Button, Chip, Segmented } from '../components/primitives';
import { Verwissel } from '../components/Verwissel';
import { RichtingWissel } from '../components/RichtingWissel';
import { overgangActief } from '../lib/overgang';
import { ServiceChip } from '../components/ServiceChip';
import { Skeleton, SkeletonRow } from '../components/Skeleton';
import { DienstBalk } from '../components/DienstBalk';
import { RitbladViewer } from '../components/RitbladViewer';

// Defect melden (techniek, 13-09): pas laden bij de klik, de chunk van Mijn dag blijft licht.
const LazyDefectMeldenModal = lazy(() => import('../components/DefectMeldenModal').then((m) => ({ default: m.DefectMeldenModal })));

/**
 * Mijn dag — het broekzakscherm van de chauffeur.
 *
 * Eén dag (vandaag of morgen) als tijdlijn: elk blok van de dienst groot en
 * leesbaar op armlengte, de pauze ertussen, een live "nu"-lijn, de notitie
 * van de planning, het ritblad, de actieve omleidingen en de volgende
 * dienst. Bewust geen tellers of tegels: wat de chauffeur nú moet weten
 * staat bovenaan, de rest is stil (productprincipes 1, 3 en 5).
 *
 * Zelfde bronnen als het dashboard (shifts/notes/diversions); alle tijd-
 * rekenwerk zit in minuten t.o.v. middernacht van de peildag, zodat de
 * busvak-notatie ("26:16") en een impliciete nachtdienst (eind ≤ start)
 * dezelfde regel volgen als isShiftActiveAt.
 */


// Stabiele lege invoer voor de ruilbadge zolang ruilen/namen nog laden
// (geruildeDiensten cachet op referentie).
const GEEN_RUILEN: readonly SwapRequest[] = [];
const GEEN_NAMEN: ReadonlyArray<Pick<User, 'id' | 'name'>> = [];
const hoofdletter = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

type Rij =
  | { soort: 'blok'; shift: Shift; nr: number; start: number; end: number; gereden: boolean; bezig: boolean }
  | { soort: 'pauze'; start: number; end: number };

export function MijnDagView({
  user,
  shifts,
  notes = [],
  diversions,
  isInitialLoad = false,
  onNavigate,
}: {
  user: User;
  shifts: Shift[];
  notes?: Array<{ date: string; note: string }>;
  diversions: Diversion[];
  isInitialLoad?: boolean;
  onNavigate?: (view: View) => void;
}) {
  const [now, setNow] = useState(new Date());
  // Vandaag | Morgen — 's avonds is "wanneer moet ik morgen beginnen" dé vraag.
  const [dagOffset, setDagOffset] = useState<0 | 1>(0);
  // Richting van de laatste dagwissel: naar Morgen schuift de inhoud naar
  // links weg en komt de nieuwe van rechts (RichtingWissel), terug omgekeerd.
  const [dagRichting, setDagRichting] = useState<1 | -1>(1);
  const kiesDag = (w: 0 | 1) => {
    if (w === dagOffset) return;
    setDagRichting(w > dagOffset ? 1 : -1);
    setDagOffset(w);
  };
  // Ritblad per dienst: de viewer zoekt de pagina's van het dienstnummer in de bundel.
  const [ritbladOpen, setRitbladOpen] = useState(false);
  const [defectMelden, setDefectMelden] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Startscherm-voorkeur naar de lokale kopie (de router leest die bij het
  // opstarten, vóór het profiel binnen is; src/lib/startscherm.ts).
  useEffect(() => { spiegelStartscherm(user); }, [user]);

  // Offline (next-level 2, 06-09): de service worker serveert de laatst
  // bekende planning/omleidingen/notities en het opgeslagen ritblad; hier
  // alleen een stil label met de versheid — geen banner over het scherm.
  const online = useOnline();
  const appData = useOptioneleAppData();
  const lastSyncedAt = appData?.lastSyncedAt ?? null;
  // "Geruild met X" op een overgenomen dienst (vraag Jarno 12-09), zelfde
  // helper als het rooster; zonder context (tests) geen badge.
  const swaps = appData?.swaps;
  const users = appData?.users;
  // Ruilen en namen laden voor een chauffeur ná de poort (useAppData): de
  // badge verschijnt pas als béíde er zijn, anders stond er even "een collega".
  const ruilDataKlaar = !!appData?.swapsGeladen && !!appData?.usersGeladen;
  const geruild = useMemo(
    () => geruildeDiensten(user.id, ruilDataKlaar ? swaps ?? [] : GEEN_RUILEN, ruilDataKlaar ? users ?? [] : GEEN_NAMEN),
    [user.id, swaps, users, ruilDataKlaar],
  );

  const vandaag = isOffset(now, 0);
  const mijnShifts = shifts.filter((s) => s.driverId === user.id);
  // Nachtdienst over middernacht: zolang de dienst van gisteren nog loopt,
  // blijft dát de dag van dit scherm en telt "nu" door in busvak-tijd
  // (00:30 = 24:30) — anders viel de dienst om 00:00 weg (controle 05-09).
  const gisteren = isOffset(now, -1);
  const nachtdienstLoopt = mijnShifts.some((s) => s.date === gisteren && isShiftActiveAt(s, now));
  const dagBasis = nachtdienstLoopt ? -1 : 0;
  const peildag = isOffset(now, dagBasis + dagOffset);
  const isVandaag = dagOffset === 0;
  // Stabiele referentie: DienstBalk is gememoiseerd en de minuutklok rendert
  // dit scherm elke minuut opnieuw.
  const delen = useMemo(
    () => mijnShifts.filter((s) => s.date === peildag).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [mijnShifts, peildag],
  );
  const dienstnummers = [...new Set(delen.map((p) => serviceNumberOf(p)).filter((n) => n !== '--'))];
  const notitie = notes.find((n) => n.date === peildag)?.note;
  const ruilBadges = dienstnummers.map((n) => geruild.get(ruilSleutel(peildag, n))).filter((b): b is RuilBadge => !!b);

  // Tijdlijn-rijen: blok, pauze, blok, … (pauze alleen als er echt tijd tussen zit).
  const rijen: Rij[] = [];
  delen.forEach((shift, i) => {
    const v = shiftWindowMinutes(shift);
    if (!v) return;
    const vorige = rijen[rijen.length - 1];
    if (vorige && vorige.soort === 'blok' && v.start > vorige.end) {
      rijen.push({ soort: 'pauze', start: vorige.end, end: v.start });
    }
    rijen.push({
      soort: 'blok',
      shift,
      nr: i + 1,
      start: v.start,
      end: v.end,
      // Alleen vandaag kan iets gereden of bezig zijn; morgen is alles nog te doen.
      gereden: isVandaag && hasShiftEnded(shift, now),
      bezig: isVandaag && isShiftActiveAt(shift, now),
    });
  });
  const blokken = rijen.filter((r): r is Extract<Rij, { soort: 'blok' }> => r.soort === 'blok');

  // "Nu" in minuten t.o.v. middernacht van vandaag (de peildag bij offset 0).
  const nuMin = now.getHours() * 60 + now.getMinutes() + (nachtdienstLoopt ? 1440 : 0);
  const nuLabel = now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  // Statuszin: "Dienst 2101 · 2 delen · tot 17:29" / "Vrij vandaag".
  const dagWoord = isVandaag ? 'vandaag' : 'morgen';
  const statuszin = (() => {
    if (delen.length === 0) return `Vrij ${dagWoord}`;
    const kop = dienstnummers.length > 1 ? `Diensten ${dienstnummers.join(' / ')}` : `Dienst ${dienstnummers[0] ?? '--'}`;
    const einde = delen[delen.length - 1].endTime;
    return delen.length > 1 ? `${kop} · ${delen.length} delen · tot ${einde}` : `${kop} · ${delen[0].startTime}–${einde}`;
  })();

  // Volgende dienst ná de peildag (de dag zelf staat al in de tijdlijn).
  const volgendeDag = mijnShifts
    .filter((s) => s.date > peildag)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const volgende = volgendeDag[0];
  const volgendeDelen = volgende ? volgendeDag.filter((s) => s.date === volgende.date) : [];

  // Mijn dag gaat over vandaag: alleen omleidingen die nu echt lopen.
  const liveOmleidingen = lopendeDiversions(diversions);

  // Ritblad alvast in de offline-cache zetten zodra er vandaag of morgen een
  // dienst is (de bundel is gedeeld; de SW sleutelt op het pad). Eén keer
  // per half uur, alleen online.
  const heeftDienstBinnenkort = mijnShifts.some((s) => s.date === vandaag || s.date === isOffset(now, 1));
  useEffect(() => {
    if (isInitialLoad || !online || !heeftDienstBinnenkort) return;
    void warmRitbladCache();
  }, [isInitialLoad, online, heeftDienstBinnenkort]);

  // Skelet met dezelfde kop-/kaartopbouw als de inhoud; Verwissel cross-fadet
  // ernaar zodra de data binnen is (minstens 180 ms skelet, geen flikker).
  const skelet = (
    <div className="mx-auto max-w-2xl space-y-5" aria-busy="true" aria-label="Mijn dag wordt geladen">
      <div className="space-y-2 px-1 pt-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Card padding="none" className="overflow-hidden">
        <SkeletonRow className="border-b border-hairline-subtle" />
        <SkeletonRow className="border-b border-hairline-subtle" />
        <SkeletonRow />
      </Card>
    </div>
  );

  return (
    <Verwissel laden={isInitialLoad} skelet={skelet}>
    <div className="mx-auto max-w-2xl space-y-5">
      {/* === Kop: dag-taal + schakelaar + statuszin === */}
      <header className="px-1 pt-1">
        {/* Zelfde kop-raster als PageHeader: schakelaar rechts via ml-auto,
            zakt onder de kop als hij niet naast de datum past. */}
        <div className="flex items-start justify-between gap-x-4 gap-y-3 md:items-end">
          <div className="min-w-0 flex-1">
            <p className="text-micro">{nachtdienstLoopt && isVandaag ? 'Nog bezig · dienst van gisteren' : hoofdletter(dagWoord)}</p>
            <h1 className="text-page-title mt-1">{hoofdletter(formatDayLong(peildag))}</h1>
            {/* Stil: een chip met amber-puntje, geen rood en geen banner —
                offline is een toestand, geen alarm. */}
            {!online && (
              <Badge tone="amber" stil icon={<WifiOff size={12} />} className="mt-2 whitespace-nowrap tabular-nums" title="Zonder bereik: je ziet de laatst geladen gegevens">
                Offline{lastSyncedAt ? ` · gegevens van ${formatSyncedTime(lastSyncedAt)}` : ' · opgeslagen gegevens'}
              </Badge>
            )}
          </div>
          <Segmented
            label="Dag kiezen"
            className="ml-auto shrink-0"
            itemClassName="min-h-11 sm:pointer-fine:min-h-8"
            waarde={dagOffset}
            opties={[{ waarde: 0 as const, label: 'Vandaag' }, { waarde: 1 as const, label: 'Morgen' }]}
            onChange={kiesDag}
          />
        </div>
        {/* De statuszin ís de boodschap — het dienstnummer voorop en groot:
            "welke dienst rijd ik" is het belangrijkste wat hier staat
            (Jarno 04-09). */}
        {delen.length === 0 ? (
          <p className="mt-2 text-base font-semibold text-slate-800">{statuszin}</p>
        ) : (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Tint i.p.v. vol goud (Jarno 04-09: te fel/druk): groot en mono
                blijft de nadruk, het goud is voor de balk en "nog …". */}
            <span className="inline-flex items-center gap-2 rounded-xl border border-oker-500/30 bg-oker-500/12 px-3 py-1.5 font-mono text-xl font-bold tabular-nums tracking-[-0.01em] text-oker-800 lg:text-lg">
              {blokken.some((b) => b.bezig) && <span className="h-2 w-2 shrink-0 rounded-full bg-oker-500 vhb-nu" aria-label="dienst bezig" />}
              {dienstnummers.length > 1 ? dienstnummers.join(' / ') : dienstnummers[0] ?? '--'}
            </span>
            <p className="text-base font-semibold text-slate-800 tabular-nums">
              {delen.length > 1 ? `${delen.length} delen · tot ${delen[delen.length - 1].endTime}` : `${delen[0].startTime}–${delen[delen.length - 1].endTime}`}
            </p>
            {ruilBadges.map((b) => (
              <Badge key={b.swapId} tone="amber" stil icon={<ArrowLeftRight size={12} />}>{ruilBadgeLabel(b)}</Badge>
            ))}
          </div>
        )}
      </header>

      {/* Alles wat van de gekozen dag afhangt wisselt met richting (opacity +
          4 px, stil tijdens een view transition en bij reduced motion). */}
      <RichtingWissel sleutel={dagOffset} richting={dagRichting} stil={overgangActief()} knip innerClassName="space-y-5">
      {/* === Ritblad en Defect melden: de twee dingen die een chauffeur hier
          écht komt doen. Stonden onderaan, ná de omleidingen, en waren op een
          telefoon zelden in beeld (puntje Jarno 21-09). Nu boven de tijdlijn,
          met het ritblad als enige gouden knop van dit scherm.
          Het ritblad toont meteen de pagina's van jóuw dienstnummer (04-09);
          ook voor morgen zodra het nummer bekend is, zodat je 's avonds al
          kan klaarleggen wat je morgen rijdt. Het blad is altijd de actuele
          bundel. Defect melden schrijft rechtstreeks in het gele boek van de
          garage (13-09) en staat er ook op een dag zonder dienst. === */}
      <div className={cn('grid gap-2', delen.length > 0 && 'grid-cols-2')}>
        {delen.length > 0 && (
          <Button variant="primary" size="lg" full icon={<FileText size={18} />} onClick={() => setRitbladOpen(true)}>
            Ritblad van {dagWoord}
          </Button>
        )}
        <Button variant="secondary" size="lg" full icon={<Wrench size={18} />} onClick={() => setDefectMelden(true)}>
          Defect melden
        </Button>
      </div>
      {delen.length > 0 && (
        <RitbladViewer dienstnummer={dienstnummers} open={ritbladOpen} onClose={() => setRitbladOpen(false)} />
      )}
      {defectMelden && (
        <Suspense fallback={null}>
          <LazyDefectMeldenModal open onClose={() => setDefectMelden(false)} currentUser={user} />
        </Suspense>
      )}
      {/* === Tijdlijn === */}
      {rijen.length === 0 ? (
        <Card tone="muted" padding="sm">
          <p className="text-md font-semibold text-slate-800">Geen dienst ingepland</p>
          <p className="mt-0.5 text-body-sm text-slate-500">
            {volgende ? 'Je volgende dienst staat hieronder.' : 'Er staat op dit moment niets ingepland.'}
          </p>
        </Card>
      ) : (
        <Card as="section" padding="none" aria-label="Tijdlijn van de dienst">
          <ol className="py-2">
            {rijen.map((rij, i) => {
              const eersteRij = i === 0;
              const laatsteRij = i === rijen.length - 1;
              // Bij één blok is er niets om langs te reizen: geen rail, geen
              // stip (Jarno 04-09). De dienstbalk onderaan is dan het
              // instrument; bij meerdere delen blijft de rail de rode draad.
              const metRail = rijen.length > 1;

              if (rij.soort === 'pauze') {
                return (
                  <li key={`pauze-${rij.start}`} className="relative flex gap-4 px-5 py-3">
                    <span className="relative flex w-3 shrink-0 justify-center">
                      <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-hairline-strong" />
                    </span>
                    <p className="text-sm font-medium text-slate-500 tabular-nums">
                      pauze · {formatDuration(rij.end - rij.start)}
                    </p>
                  </li>
                );
              }

              const { shift, nr, gereden, bezig, start, end } = rij;
              const resterend = bezig ? end - nuMin : null;
              const totStart = isVandaag && !gereden && !bezig && start > nuMin ? start - nuMin : null;
              const sub = [
                blokken.length > 1 ? `deel ${nr}/${blokken.length}` : null,
                formatDuration(end - start),
                gereden ? 'gereden' : totStart !== null ? `start over ${formatDuration(totStart)}` : null,
              ].filter(Boolean).join(' · ');

              return (
                <li key={shift.id} className="relative flex gap-4 px-5 py-4">
                  {/* Rail met stip: gedempt (gereden), oker (bezig) of open (nog te rijden). */}
                  {metRail && (
                    <span className={cn('relative flex w-3 shrink-0 justify-center', gereden && 'opacity-60')}>
                      <span className={cn('absolute left-1/2 w-px bg-slate-200', eersteRij ? 'top-4' : 'top-0', laatsteRij ? 'h-4' : 'bottom-0')} />
                      <span
                        className={cn(
                          'relative mt-2.5 h-3 w-3 shrink-0 rounded-full',
                          gereden ? 'bg-slate-300' : bezig ? 'bg-oker-500 ring-4 ring-oker-500/20' : 'border-2 border-hairline-strong bg-surface-white',
                        )}
                      />
                    </span>
                  )}
                  {/* Gereden deel gedempt, maar niet onder 4,5:1: op opacity-60
                      zakte de loop-chip naar 3,57 en faalde Lighthouse-a11y in
                      CI zodra een dienst van vandaag al voorbij was (07-09). */}
                  <div className={cn('min-w-0 flex-1', gereden && 'opacity-75')}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      {/* Groot en mono: tijden zijn het instrumentpaneel, leesbaar op armlengte. */}
                      <p className={cn('text-2xl font-mono font-semibold tabular-nums tracking-[-0.01em] lg:text-xl', gereden ? 'text-slate-500' : 'text-slate-900')}>
                        {shift.startTime}–{shift.endTime}
                      </p>
                      {/* De boodschap rechts van de tijd, groot en goud: hoelang nog. */}
                      {resterend !== null && (
                        <p className="text-xl font-mono font-semibold tabular-nums tracking-[-0.01em] text-oker-700 lg:text-lg">nog {formatDuration(resterend)}</p>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-medium tabular-nums text-slate-500">{sub}</p>
                      <span className="flex items-center gap-1.5">
                        {/* Dienstchip alleen als de dag meerdere dienstnummers heeft (anders
                            staat hij al groot in de kop); chips neutraal — bezig zie je aan
                            de balk en de "nog"-tekst. */}
                        {dienstnummers.length > 1 && <ServiceChip serviceNumber={serviceNumberOf(shift)} />}
                        {shift.loopnr?.trim() && <Chip className="text-xs">loop {shift.loopnr.trim()}</Chip>}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {/* De wijzerplaat van de dag: één balk van eerste start tot laatste
              einde, pauzes als gaten, uurstreepjes, wijzer op "nu". */}
          <div className="border-t border-hairline-subtle px-5 pb-1">
            <DienstBalk
              delen={blokken.map((b) => ({ start: b.start, end: b.end, loopnr: b.shift.loopnr }))}
              nuMin={isVandaag ? nuMin : null}
              nuLabel={nuLabel}
            />
          </div>
        </Card>
      )}

      {/* === Notitie van de planning === */}
      {notitie && (
        <Card tone="accent" padding="sm">
          <p className="text-micro text-oker-700">Notitie van de planning</p>
          <p className="mt-1 whitespace-pre-wrap text-body font-medium text-oker-800">{notitie}</p>
        </Card>
      )}

      </RichtingWissel>

      {/* === Omleidingen: allemaal, met lijnnummer — de koppeling omleiding ↔
          dienst zit niet in de data, dus we kiezen er niet voor de chauffeur. === */}
      {liveOmleidingen.length > 0 && (
        <section aria-label="Omleidingen" className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-card-title">Omleidingen</h2>
            <span className="text-xs font-medium text-slate-500">{liveOmleidingen.length} actief</span>
          </div>
          <div className="space-y-1.5">
            {liveOmleidingen.map((d) => (
              <OpsRow
                key={d.id}
                tone="amber"
                badges={<LijnTegel line={d.line} size="sm" layout="rij" />}
                primary={d.title}
                secondary={d.description}
                onClick={() => onNavigate?.('omleidingen')}
              />
            ))}
          </div>
        </section>
      )}

      {/* === Volgende dienst === */}
      <section aria-label="Volgende dienst" className="space-y-2">
        <h2 className="px-1 text-card-title">Volgende dienst</h2>
        <RichtingWissel sleutel={dagOffset} richting={dagRichting} stil={overgangActief()}>
        {volgende ? (
          <OpsRow
            tone="oker"
            icon={<Calendar size={16} />}
            primary={`${hoofdletter(relatieveDag(volgende.date, vandaag))} · ${formatShortDay(volgende.date)}`}
            secondary={
              volgendeDelen.length > 1
                ? `${volgende.startTime} · ${volgendeDelen.length} delen · tot ${volgendeDelen[volgendeDelen.length - 1].endTime}`
                : `${volgende.startTime}–${volgende.endTime}${volgende.loopnr ? ` · loop ${volgende.loopnr}` : ''}`
            }
            trailing={<ServiceChip serviceNumber={serviceNumberOf(volgende)} tone="oker" />}
            onClick={() => onNavigate?.('rooster')}
          />
        ) : (
          <Card tone="muted" padding="sm" className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600">
              <MapPin size={16} />
            </span>
            <p className="text-body-sm font-medium text-slate-600">Niets ingepland na {dagWoord}.</p>
          </Card>
        )}
        </RichtingWissel>
      </section>
    </div>
    </Verwissel>
  );
}

/** Lokale yyyy-mm-dd van vandaag + n dagen (geen UTC-shift). */
function isOffset(now: Date, n: number): string {
  return isoDate(addDays(now, n));
}
