import { useEffect, useState } from 'react';
import { AlertTriangle, Calendar, FileText, MapPin, WifiOff } from 'lucide-react';
import { useOptioneleAppData } from '../app/AppDataContext';
import { activeDiversions } from '../lib/diversions';
import { addDays, isoDate } from '../lib/availability';
import { relatieveDag } from '../lib/datum';
import { formatDayLong, formatShortDay, formatSyncedTime, serviceNumberOf } from '../lib/format';
import { warmRitbladCache } from '../lib/ritbladCache';
import { useOnline } from '../lib/useOnline';
import { formatDuration, hasShiftEnded, isShiftActiveAt, shiftWindowMinutes } from '../lib/shiftTime';
import { cn } from '../lib/ui';
import type { Diversion, Shift, User, View } from '../types';
import { Card } from '../components/Card';
import { OpsRow } from '../components/ops';
import { Badge, Button, Chip, segItemClass } from '../components/primitives';
import { ServiceChip } from '../components/ServiceChip';
import { Skeleton, SkeletonRow } from '../components/Skeleton';
import { DienstBalk } from '../components/DienstBalk';
import { RitbladViewer } from '../components/RitbladViewer';

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

/** "Lijn 5 & 8" vs "5": prefix alleen wanneer 't nog niet in de data zit. */
const lineLabel = (line: string) =>
  line.trim().toLowerCase().startsWith('lijn') ? line.trim() : `Lijn ${line.trim()}`;

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
  // Ritblad per dienst: de viewer zoekt de pagina's van het dienstnummer in de bundel.
  const [ritbladOpen, setRitbladOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Offline (next-level 2, 06-09): de service worker serveert de laatst
  // bekende planning/omleidingen/notities en het opgeslagen ritblad; hier
  // alleen een stil label met de versheid — geen banner over het scherm.
  const online = useOnline();
  const lastSyncedAt = useOptioneleAppData()?.lastSyncedAt ?? null;

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
  const delen = mijnShifts
    .filter((s) => s.date === peildag)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const dienstnummers = [...new Set(delen.map((p) => serviceNumberOf(p)).filter((n) => n !== '--'))];
  const notitie = notes.find((n) => n.date === peildag)?.note;

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

  const liveOmleidingen = activeDiversions(diversions);

  // Ritblad alvast in de offline-cache zetten zodra er vandaag of morgen een
  // dienst is (de bundel is gedeeld; de SW sleutelt op het pad). Eén keer
  // per half uur, alleen online.
  const heeftDienstBinnenkort = mijnShifts.some((s) => s.date === vandaag || s.date === isOffset(now, 1));
  useEffect(() => {
    if (isInitialLoad || !online || !heeftDienstBinnenkort) return;
    void warmRitbladCache();
  }, [isInitialLoad, online, heeftDienstBinnenkort]);

  if (isInitialLoad) {
    return (
      <div className="mx-auto max-w-2xl space-y-5" aria-busy="true" aria-label="Mijn dag wordt geladen">
        <div className="space-y-2 px-1 pt-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Card padding="none" className="overflow-hidden">
          <SkeletonRow className="border-b border-slate-100" />
          <SkeletonRow className="border-b border-slate-100" />
          <SkeletonRow />
        </Card>
      </div>
    );
  }

  return (
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
          <div className="glass-segmented ml-auto inline-flex shrink-0 rounded-2xl p-1" role="group" aria-label="Dag kiezen">
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
              {blokken.some((b) => b.bezig) && <span className="h-2 w-2 shrink-0 rounded-full bg-oker-500 animate-pulse" aria-label="dienst bezig" />}
              {dienstnummers.length > 1 ? dienstnummers.join(' / ') : dienstnummers[0] ?? '--'}
            </span>
            <p className="text-base font-semibold text-slate-800 tabular-nums">
              {delen.length > 1 ? `${delen.length} delen · tot ${delen[delen.length - 1].endTime}` : `${delen[0].startTime}–${delen[delen.length - 1].endTime}`}
            </p>
          </div>
        )}
      </header>

      {/* === Tijdlijn === */}
      {rijen.length === 0 ? (
        <Card tone="muted" padding="sm">
          <p className="text-sm font-semibold text-slate-800">Geen dienst ingepland</p>
          <p className="mt-0.5 text-sm text-slate-500">
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
                      <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-slate-300" />
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
                          gereden ? 'bg-slate-300' : bezig ? 'bg-oker-500 ring-4 ring-oker-500/20' : 'border-2 border-slate-300 bg-surface-white',
                        )}
                      />
                    </span>
                  )}
                  <div className={cn('min-w-0 flex-1', gereden && 'opacity-60')}>
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
          <div className="border-t border-slate-100 px-5 pb-1">
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
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed text-oker-800">{notitie}</p>
        </Card>
      )}

      {/* === Ritblad: de bundel is voor iedereen, maar de viewer toont meteen de
          pagina's van jóuw dienstnummer (Jarno 04-09); alleen bij vandaag. === */}
      {isVandaag && delen.length > 0 && (
        <>
          <Button variant="secondary" size="lg" full icon={<FileText size={18} />} onClick={() => setRitbladOpen(true)}>
            Ritblad van vandaag
          </Button>
          <RitbladViewer dienstnummer={dienstnummers} open={ritbladOpen} onClose={() => setRitbladOpen(false)} />
        </>
      )}

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
                icon={<AlertTriangle size={16} />}
                primary={d.title}
                secondary={d.description}
                meta={lineLabel(d.line)}
                onClick={() => onNavigate?.('omleidingen')}
              />
            ))}
          </div>
        </section>
      )}

      {/* === Volgende dienst === */}
      <section aria-label="Volgende dienst" className="space-y-2">
        <h2 className="px-1 text-card-title">Volgende dienst</h2>
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
            <p className="text-sm font-medium text-slate-600">Niets ingepland na {dagWoord}.</p>
          </Card>
        )}
      </section>
    </div>
  );
}

/** Lokale yyyy-mm-dd van vandaag + n dagen (geen UTC-shift). */
function isOffset(now: Date, n: number): string {
  return isoDate(addDays(now, n));
}
