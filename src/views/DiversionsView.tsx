import { useEffect, useState } from 'react';
import { Calendar, Check, ChevronDown, ChevronRight, FileText, Search, X } from 'lucide-react';
import { LijnTegel } from '../components/LijnTegel';
import { isAlleLijnen, lijnLabel, lijnenVan, raaktLijn } from '../../shared/lijnen';
import { groepeerOmleidingen, isRecentGenoeg, omleidingsFase, omleidingsPeriode, omleidingsTijdshint, type OmleidingsFase } from '../lib/diversions';
import { isoDate } from '../lib/availability';
import type { Diversion } from '../types';
import { cn } from '../lib/ui';
import { kiesRecord } from '../lib/overgang';
import { useRecordParam } from '../app/router';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, IconButton, MicroLabel, TOON_NAAR_BADGE } from '../components/primitives';
import { OMLEIDING_FASE } from '../../shared/status';
import { Uitklap, uitklapChevron } from '../components/Uitklap';
import { Card } from '../components/Card';
import { OmleidingDetail } from '../components/OmleidingDetail';
import { Input, Select } from '../components/Field';
import { DetailPaneel, MasterDetail, useInlinePaneel } from '../components/DetailPaneel';
import { LegeLijst, NietGevonden } from '../components/illustraties';

/**
 * Lijst + detail via het gedeelde DetailPaneel: op desktop staat de
 * omleiding rechts naast de lijst, op mobiel opent ze in een SlideOver.
 *
 * Elke status heeft één rustige lijst met lijnnummers, titel en periode.
 * De volledige omschrijving staat in het detail; verlopen items blijven
 * standaard ingeklapt en verdwijnen na 30 dagen.
 */
/** Vanaf dit aantal omleidingen krijgt de lijst een zoekveld en lijnfilter. */
const FILTER_VANAF = 5;

export function DiversionsView({ diversions }: { diversions: Diversion[]; lastSyncedAt?: number | null }) {
  // De keuze staat in de URL (/omleidingen/<id>): deelbaar, en een melding
  // over één omleiding landt meteen op dat item. Alleen een klik schrijft;
  // de desktop-voorselectie hieronder blijft afgeleid.
  const [selectedId, setSelectedId] = useRecordParam(0, { view: 'omleidingen' });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLine, setSelectedLine] = useState<string>('all');
  const [toonVerlopen, setToonVerlopen] = useState(false);
  const inline = useInlinePaneel();
  const vandaag = isoDate(new Date());

  // Per lijn, niet per omleiding: "883, 884" telt als twee lijnen in de filter.
  // "Alle" is geen lijn maar een bereik; die omleidingen vallen onder elke filterkeuze.
  const uniqueLines = Array.from(new Set(diversions.flatMap((div) => lijnenVan(div.line)).filter((l) => !isAlleLijnen(l)))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const zoek = searchQuery.trim().toLowerCase();
  const heeftFilter = !!zoek || selectedLine !== 'all';
  // Zoeken en filteren pas vanaf een lijst die je niet meer in één blik
  // overziet (dichtheidsronde 22-09): met twee omleidingen was de filterkaart
  // op een telefoon hoger dan de lijst zelf en duwde ze die onder de vouw.
  const toonFilters = diversions.length >= FILTER_VANAF || heeftFilter;
  const wisFilters = () => { setSearchQuery(''); setSelectedLine('all'); };
  const gefilterd = diversions.filter((div) => {
    if (!isRecentGenoeg(div, vandaag)) return false;
    const matchesSearch = !zoek
      || div.title.toLowerCase().includes(zoek)
      || (div.location ?? '').toLowerCase().includes(zoek)
      || div.description.toLowerCase().includes(zoek)
      || div.line.toLowerCase().includes(zoek);
    const matchesLine = selectedLine === 'all' || raaktLijn(div.line, selectedLine);
    return matchesSearch && matchesLine;
  });
  const groepen = groepeerOmleidingen(gefilterd, vandaag);
  // Wie zoekt, wil ook een verlopen treffer zien: dan klapt "Voorbij" vanzelf
  // open. Een link naar een verlopen omleiding (/omleidingen/<id>) klapt de
  // sectie ook open, en die blijft dan open (anders verdween de lijst weer
  // zodra je vanuit die link een ander record koos).
  const verlopenGekozen = groepen.verlopen.some((d) => d.id === selectedId);
  useEffect(() => { if (verlopenGekozen) setToonVerlopen(true); }, [verlopenGekozen]);
  const verlopenOpen = toonVerlopen || zoek.length > 0 || verlopenGekozen;
  const zichtbaar = [...groepen.lopend, ...groepen.komend, ...(verlopenOpen ? groepen.verlopen : [])];
  const nietsActueel = groepen.lopend.length === 0 && groepen.komend.length === 0;

  // Mobiel: alleen wat de chauffeur zelf opentikte (SlideOver). Desktop: valt
  // terug op de eerste zichtbare omleiding, zodat het paneel nooit leeg opent;
  // verdwijnt de keuze uit de lijst door een filter, dan springt het paneel mee.
  const gekozen = zichtbaar.find((d) => d.id === selectedId) ?? null;
  const detail = inline ? gekozen ?? zichtbaar[0] ?? null : gekozen;
  const kies = (id: string) => kiesRecord(id, detail?.id ?? null, () => setSelectedId(id));

  const secties: { fase: OmleidingsFase; titel: string; items: Diversion[] }[] = [
    { fase: 'lopend', titel: 'Nu geldig', items: groepen.lopend },
    { fase: 'komend', titel: 'Binnenkort', items: groepen.komend },
  ];

  const lijst = gefilterd.length === 0 ? (
    <EmptyState
      illustratie={heeftFilter ? <NietGevonden /> : <LegeLijst />}
      title={heeftFilter ? 'Geen resultaten' : 'Geen omleidingen'}
      message={heeftFilter ? 'Geen omleidingen voor deze zoekopdracht of lijn.' : 'Er zijn op dit moment geen omleidingen. Zodra er een wordt toegevoegd, verschijnt ze hier.'}
      action={heeftFilter ? (
        <Button variant="secondary" size="sm" onClick={wisFilters}>
          Wis filters
        </Button>
      ) : undefined}
    />
  ) : (
    <div className="space-y-6">
      {secties.filter((s) => s.items.length > 0).map((s) => (
        <section key={s.fase} aria-labelledby={`omleidingen-${s.fase}`}>
          <SectieKop id={`omleidingen-${s.fase}`} titel={s.titel} aantal={s.items.length} />
          <Card padding="none" className="overflow-hidden">
            <ul className="divide-y divide-hairline" aria-label={s.titel}>
              {s.items.map((div) => (
                <OmleidingRij key={div.id} div={div} vandaag={vandaag} isCurrent={detail?.id === div.id} onClick={() => kies(div.id)} />
              ))}
            </ul>
          </Card>
        </section>
      ))}

      {nietsActueel && (
        <p className="text-body-sm text-slate-500">Geen lopende of komende omleidingen.</p>
      )}

      {groepen.verlopen.length > 0 && (
        <section aria-labelledby="omleidingen-verlopen">
          {/* rauw: sectiekop als toggle (tekst + chevron), geen knop-uiterlijk */}
          <button
            type="button"
            onClick={() => setToonVerlopen((v) => !v)}
            aria-expanded={verlopenOpen}
            aria-controls="omleidingen-verlopen-lijst"
            className="ios-pressable -mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface-soft-hover"
          >
            <SectieKop id="omleidingen-verlopen" titel="Voorbij" aantal={groepen.verlopen.length} inline />
            <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
              {verlopenOpen ? 'Verbergen' : 'Tonen'}
              <ChevronDown size={14} className={uitklapChevron(verlopenOpen)} />
            </span>
          </button>
          <Uitklap open={verlopenOpen} id="omleidingen-verlopen-lijst">
            <Card padding="none" className="mt-2 overflow-hidden">
              <ul className="divide-y divide-hairline" aria-label="Voorbij">
                {groepen.verlopen.map((div) => (
                  <OmleidingRij key={div.id} div={div} vandaag={vandaag} isCurrent={detail?.id === div.id} onClick={() => kies(div.id)} />
                ))}
              </ul>
            </Card>
          </Uitklap>
        </section>
      )}
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title="Omleidingen"
        description="Welke lijnen anders rijden en tot wanneer."
      />

      {toonFilters ? (
      <Card padding="sm" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1 group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search size={16} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
            </div>
            <Input
              type="text"
              placeholder="Zoek op plaats, titel of lijn…"
              aria-label="Zoek in omleidingen"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn('pl-9', searchQuery && 'pr-11')}
            />
            {searchQuery && (
              <IconButton
                label="Wis zoekopdracht"
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
              >
                <X size={16} />
              </IconButton>
            )}
          </div>
          <Select
            value={selectedLine}
            onChange={(e) => setSelectedLine(e.target.value)}
            aria-label="Filter op lijn"
            className="w-full shrink-0 font-semibold cursor-pointer sm:w-44"
          >
            <option value="all">Alle lijnen</option>
            {uniqueLines.map(line => (
              <option key={line} value={line}>{lijnLabel(line)}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <p aria-live="polite">
            <span className="font-semibold text-slate-800">{groepen.lopend.length}</span> nu geldig
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="font-semibold text-slate-800">{groepen.komend.length}</span> binnenkort
            {heeftFilter && <span className="ml-2">(gefilterd)</span>}
          </p>
          {heeftFilter && <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={wisFilters}>Wis filters</Button>}
        </div>
      </Card>
      ) : (
        <p className="-mt-2 px-1 text-xs text-slate-500" aria-live="polite">
          <span className="font-semibold text-slate-800">{groepen.lopend.length}</span> nu geldig
          <span className="mx-2" aria-hidden="true">·</span>
          <span className="font-semibold text-slate-800">{groepen.komend.length}</span> binnenkort
        </p>
      )}

      <MasterDetail
        className="lg:grid-cols-[minmax(0,43%)_minmax(0,1fr)]"
        lijst={lijst}
        paneel={gefilterd.length > 0 ? (
          <DetailPaneel
            open={!!detail}
            onClose={() => setSelectedId(null)}
            title={detail?.title ?? 'Omleiding'}
            titelTerugloop
            subtitle={detail ? [lijnLabel(detail.line), detail.location].filter(Boolean).join(' · ') : undefined}
            sleutel={detail?.id}
            leegTekst="Kies een omleiding."
            chip={detail ? <FaseBadge fase={omleidingsFase(detail, vandaag)} hint={omleidingsTijdshint(detail, vandaag)} /> : undefined}
          >
            {detail && <OmleidingDetail diversion={detail} />}
          </DetailPaneel>
        ) : undefined}
      />
    </PageShell>
  );
}

/** Rustige sectiekop met teller: "Nu geldig · 2". */
function SectieKop({ id, titel, aantal, inline = false }: { id: string; titel: string; aantal: number; inline?: boolean }) {
  return (
    <h3 id={id} className={cn('flex items-center gap-2', !inline && 'mb-3 px-0.5')}>
      <MicroLabel>{titel}</MicroLabel>
      <span className="rounded-md bg-slate-500/10 px-1.5 py-0.5 text-xs font-semibold text-slate-600">{aantal}</span>
    </h3>
  );
}

/** Alleen de afwijkende toestanden krijgen een chip; "actief" is de norm.
 *  Komend draagt meteen de timing ("Start over 5 dagen"): één chip in plaats
 *  van "Komend" plus een losse hint die op mobiel naar een eigen regel brak. */
function FaseBadge({ fase, hint }: { fase: OmleidingsFase; hint?: string }) {
  if (fase === 'komend') {
    const label = hint ? hint.charAt(0).toUpperCase() + hint.slice(1) : OMLEIDING_FASE.komend.label;
    return <Badge tone={TOON_NAAR_BADGE[OMLEIDING_FASE.komend.toon]} icon={<Calendar size={12} />}>{label}</Badge>;
  }
  if (fase === 'verlopen') return <Badge tone={TOON_NAAR_BADGE[OMLEIDING_FASE.verlopen.toon]}>{OMLEIDING_FASE.verlopen.label}</Badge>;
  return null;
}

/** Vaste leesvolgorde: lijnen, titel en locatie, dan de geldigheidsperiode. */
function OmleidingRij({ div, vandaag, isCurrent, onClick }: { div: Diversion; vandaag: string; isCurrent: boolean; onClick: () => void }) {
  const fase = omleidingsFase(div, vandaag);
  const hint = omleidingsTijdshint(div, vandaag);
  const verlopen = fase === 'verlopen';
  return (
    <li
      aria-current={isCurrent ? 'true' : undefined}
      className={cn('min-w-0', isCurrent && 'bg-slate-100/60')}
    >
      {/* rauw: volledige master-detailrij als één aanraakdoel */}
      <button
        type="button"
        onClick={onClick}
        className="ios-pressable group block w-full min-w-0 space-y-2.5 p-4 text-left transition-colors hover:bg-surface-soft-hover"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {isAlleLijnen(div.line) || lijnenVan(div.line).length === 0
              ? <span className="text-xs font-semibold text-slate-600">{lijnLabel(div.line)}</span>
              : <LijnTegel line={div.line} size="sm" layout="rij" tone="muted" />}
          </div>
          <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
            {(div.bijlagen?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1"><FileText size={14} aria-hidden="true" />{pdfLabel(div.bijlagen!.length)}</span>}
            {isCurrent ? <Check size={16} className="text-slate-800" aria-label="Geselecteerd" /> : <ChevronRight size={16} aria-hidden="true" />}
          </span>
        </div>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          {div.location && <p className="mb-1 text-xs font-semibold text-slate-600">{div.location}</p>}
          <h4 className={cn('text-md font-semibold leading-snug', verlopen ? 'text-slate-600' : 'text-slate-900')} data-vt-record={div.id}>{div.title}</h4>
        </div>
        <div className="space-y-1.5 text-xs text-slate-500">
          <p className="flex items-start gap-1.5">
            <Calendar size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{omleidingsPeriode(div, vandaag) || 'Geen periode opgegeven'}</span>
          </p>
          {hint && <p className={cn('pl-5 font-medium', fase === 'lopend' && 'text-slate-700')}>{hint.charAt(0).toUpperCase() + hint.slice(1)}</p>}
        </div>
      </button>
    </li>
  );
}

/** "PDF" bij één bijlage, anders het aantal: "3 PDF's". */
export const pdfLabel = (n: number) => (n === 1 ? 'PDF' : `${n} PDF's`);
