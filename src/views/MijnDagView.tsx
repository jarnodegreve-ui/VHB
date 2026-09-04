import { useEffect, useState } from 'react';
import { AlertTriangle, Calendar, FileText, MapPin } from 'lucide-react';
import { activeDiversions } from '../lib/diversions';
import { isoDate } from '../lib/availability';
import { formatDayLong, formatShortDay, serviceNumberOf } from '../lib/format';
import { openHuidigRitblad } from '../lib/ritblad';
import { hasShiftEnded, isShiftActiveAt } from '../lib/shiftTime';
import { cn } from '../lib/ui';
import type { Diversion, Shift, User, View } from '../types';
import { Card } from '../components/Card';
import { OpsRow } from '../components/ops';
import { Button, Chip, segItemClass } from '../components/primitives';
import { ServiceChip } from '../components/ServiceChip';
import { Skeleton, SkeletonRow } from '../components/Skeleton';

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

/** 'HH:MM' → minuten (uren ≥ 24 toegestaan, busvak-notatie); null bij vuil. */
const toMin = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Start/eind van een blok in minuten; eind ≤ start = +24u (nachtdienst). */
const blokVenster = (s: { startTime: string; endTime: string }): { start: number; end: number } | null => {
  const start = toMin(s.startTime);
  const end = toMin(s.endTime);
  if (start === null || end === null) return null;
  return { start, end: end <= start ? end + 1440 : end };
};

/** "3u 16min" / "47min" / "2u" — zelfde vorm als de aftellingen in shiftTime. */
const fmtDuur = (minuten: number): string => {
  const u = Math.floor(minuten / 60);
  const m = minuten % 60;
  if (u === 0) return `${m}min`;
  if (m === 0) return `${u}u`;
  return `${u}u ${String(m).padStart(2, '0')}min`;
};

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
  const [ritbladBezig, setRitbladBezig] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const vandaag = isOffset(now, 0);
  const peildag = isOffset(now, dagOffset);
  const isVandaag = dagOffset === 0;

  const mijnShifts = shifts.filter((s) => s.driverId === user.id);
  const delen = mijnShifts
    .filter((s) => s.date === peildag)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const dienstnummers = [...new Set(delen.map((p) => serviceNumberOf(p)).filter((n) => n !== '--'))];
  const notitie = notes.find((n) => n.date === peildag)?.note;

  // Tijdlijn-rijen: blok, pauze, blok, … (pauze alleen als er echt tijd tussen zit).
  const rijen: Rij[] = [];
  delen.forEach((shift, i) => {
    const v = blokVenster(shift);
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
  const laatste = blokken[blokken.length - 1];
  const eerste = blokken[0];

  // "Nu" in minuten t.o.v. middernacht van vandaag (de peildag bij offset 0).
  const nuMin = now.getHours() * 60 + now.getMinutes();
  const nuLabel = now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  /** Positie (0–100) van de nu-lijn binnen een rij; null als "nu" er niet in valt. */
  const nuPct = (r: Rij): number | null => {
    if (!isVandaag || !eerste || !laatste) return null;
    // Vóór de eerste start: lijn bovenaan het eerste blok; na het einde: onderaan het laatste.
    if (nuMin < eerste.start) return r === eerste ? 0 : null;
    if (nuMin >= laatste.end) return r === laatste ? 100 : null;
    if (nuMin < r.start || nuMin >= r.end) return null;
    return ((nuMin - r.start) / Math.max(1, r.end - r.start)) * 100;
  };

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
  const relatieveDag = (dateIso: string): string => {
    const diff = Math.round(
      (new Date(`${dateIso}T00:00:00`).getTime() - new Date(`${vandaag}T00:00:00`).getTime()) / 86400000,
    );
    if (diff <= 0) return 'vandaag';
    if (diff === 1) return 'morgen';
    if (diff === 2) return 'overmorgen';
    return `over ${diff} dagen`;
  };

  const liveOmleidingen = activeDiversions(diversions);

  const openRitblad = async () => {
    setRitbladBezig(true);
    try {
      await openHuidigRitblad();
    } finally {
      setRitbladBezig(false);
    }
  };

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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-micro">{hoofdletter(dagWoord)}</p>
            <h1 className="text-page-title mt-1">{hoofdletter(formatDayLong(peildag))}</h1>
          </div>
          <div className="glass-segmented inline-flex shrink-0 rounded-2xl p-1" role="group" aria-label="Dag kiezen">
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
        {/* De statuszin ís de boodschap — groter dan een gewone subregel. */}
        <p className="mt-2 flex items-center gap-2 text-base font-semibold text-slate-800 tabular-nums">
          {blokken.some((b) => b.bezig) && (
            <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-oker-500" aria-label="dienst bezig" />
          )}
          {statuszin}
        </p>
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
              const pct = nuPct(rij);
              const eersteRij = i === 0;
              const laatsteRij = i === rijen.length - 1;
              // Nu-markering (Jarno 04-09): geen lijn dwars door de rij, maar
              // een kort gouden streepje op de rail (de wijzer op een
              // radio-schaal) en het "nu"-venster als lipje óver de
              // rechterrand van de kaart. De rail van het lopende blok krijgt
              // een fijne streepjesschaal, zie hieronder.
              const nuLijn = pct !== null && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 z-10 flex -translate-y-1/2 items-center"
                  style={{ top: `${pct}%` }}
                >
                  <span className="ml-5 h-0.5 w-5 -translate-x-1 rounded-full bg-oker-500" />
                  <span className="ml-auto -mr-2 rounded-full bg-oker-500 px-2 py-0.5 text-2xs font-bold tabular-nums text-slate-950 shadow-sm">
                    nu {nuLabel}
                  </span>
                </span>
              );

              if (rij.soort === 'pauze') {
                return (
                  <li key={`pauze-${rij.start}`} className="relative flex gap-4 px-5 py-3">
                    {nuLijn}
                    <span className="relative flex w-3 shrink-0 justify-center">
                      <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-slate-300" />
                    </span>
                    <p className="text-sm font-medium text-slate-500 tabular-nums">
                      pauze · {fmtDuur(rij.end - rij.start)}
                    </p>
                  </li>
                );
              }

              const { shift, nr, gereden, bezig, start, end } = rij;
              const voortgang = bezig ? Math.max(0, Math.min(100, ((nuMin - start) / Math.max(1, end - start)) * 100)) : null;
              const resterend = bezig ? end - nuMin : null;
              const totStart = isVandaag && !gereden && !bezig && start > nuMin ? start - nuMin : null;
              const sub = [
                blokken.length > 1 ? `deel ${nr}/${blokken.length}` : null,
                fmtDuur(end - start),
                gereden ? 'gereden' : resterend !== null ? `nog ${fmtDuur(resterend)}` : totStart !== null ? `start over ${fmtDuur(totStart)}` : null,
              ].filter(Boolean).join(' · ');

              return (
                <li key={shift.id} className="relative flex gap-4 px-5 py-4">
                  {nuLijn}
                  {/* Rail met stip: gedempt (gereden), oker (bezig) of open (nog te rijden).
                      Gereden blokken dempen hun inhoud, niet de nu-lijn erover. */}
                  <span className={cn('relative flex w-3 shrink-0 justify-center', gereden && 'opacity-60')}>
                    <span className={cn('absolute left-1/2 w-px bg-slate-200', eersteRij && laatsteRij && 'hidden', eersteRij ? 'top-4' : 'top-0', laatsteRij ? 'h-4' : 'bottom-0')} />
                    {/* Streepjesschaal (radio-wijzerplaat) langs het lopende blok:
                        elke streep = een stukje dienst, de gouden wijzer schuift
                        erlangs. Alleen decoratie; de voortgang zelf staat in de
                        progressbar hieronder. */}
                    {bezig && (
                      <span
                        className="absolute inset-y-4 left-1/2 w-2 -translate-x-1/2 opacity-70"
                        style={{ backgroundImage: 'repeating-linear-gradient(to bottom, var(--color-slate-300) 0 1px, transparent 1px 7px)' }}
                      />
                    )}
                    <span
                      className={cn(
                        'relative mt-2.5 h-3 w-3 shrink-0 rounded-full',
                        gereden ? 'bg-slate-300' : bezig ? 'bg-oker-500 ring-4 ring-oker-500/20' : 'border-2 border-slate-300 bg-surface-white',
                      )}
                    />
                  </span>
                  <div className={cn('min-w-0 flex-1', gereden && 'opacity-60')}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      {/* Groot en mono: tijden zijn het instrumentpaneel, leesbaar op armlengte. */}
                      <p className={cn('text-2xl font-mono font-semibold tabular-nums tracking-[-0.01em]', gereden ? 'text-slate-500' : 'text-slate-900')}>
                        {shift.startTime}–{shift.endTime}
                      </p>
                      <span className="flex items-center gap-1.5">
                        {dienstnummers.length > 1 && <ServiceChip serviceNumber={serviceNumberOf(shift)} tone={bezig ? 'oker' : 'slate'} />}
                        {shift.loopnr?.trim() && <Chip tone={bezig ? 'oker' : 'slate'} className="text-xs">loop {shift.loopnr.trim()}</Chip>}
                      </span>
                    </div>
                    <p className={cn('mt-1 text-sm font-medium tabular-nums', bezig ? 'text-oker-800' : 'text-slate-500')}>{sub}</p>
                    {voortgang !== null && (
                      <div
                        className="mt-2.5 h-1 overflow-hidden rounded-full bg-slate-200/70"
                        role="progressbar"
                        aria-valuenow={Math.round(voortgang)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="voortgang van het lopende blok"
                      >
                        <div className="h-full rounded-full bg-oker-500 transition-[width] duration-1000" style={{ width: `${voortgang}%` }} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {/* === Notitie van de planning === */}
      {notitie && (
        <Card tone="accent" padding="sm">
          <p className="text-micro text-oker-700">Notitie van de planning</p>
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed text-oker-800">{notitie}</p>
        </Card>
      )}

      {/* === Ritblad: één blad voor iedereen, dus alleen bij de dienst van vandáág === */}
      {isVandaag && delen.length > 0 && (
        <Button variant="secondary" size="lg" full icon={<FileText size={18} />} onClick={openRitblad} disabled={ritbladBezig}>
          {ritbladBezig ? 'Ritblad wordt geopend…' : 'Ritblad van vandaag'}
        </Button>
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
            primary={`${hoofdletter(relatieveDag(volgende.date))} · ${formatShortDay(volgende.date)}`}
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
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
