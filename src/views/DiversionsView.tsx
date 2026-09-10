import { useState } from 'react';
import { Calendar, ChevronDown, ChevronRight, FileText, Search, X } from 'lucide-react';
import { LijnTegel } from '../components/LijnTegel';
import { isAlleLijnen, lijnLabel, lijnenVan, raaktLijn } from '../../shared/lijnen';
import { groepeerOmleidingen, isRecentGenoeg, omleidingsFase, omleidingsPeriode, omleidingsTijdshint, type OmleidingsFase } from '../lib/diversions';
import { isoDate } from '../lib/availability';
import type { Diversion } from '../types';
import { cn, openPdfInNewTab } from '../lib/ui';
import { kiesRecord } from '../lib/overgang';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, IconButton, MicroLabel } from '../components/primitives';
import { Card } from '../components/Card';
import { Input, Select } from '../components/Field';
import { DetailPaneel, MasterDetail, useInlinePaneel } from '../components/DetailPaneel';
import { LegeLijst, NietGevonden } from '../components/illustraties';

/**
 * Lijst + detail via het gedeelde DetailPaneel: op desktop staat de
 * omleiding rechts naast de lijst, op mobiel opent ze in een SlideOver.
 *
 * Verbeterronde 10-09 (Jarno: "in zijn geheel onoverzichtelijk"): de lijst
 * is verdeeld in secties "Nu geldig", "Binnenkort" en "Voorbij" (die laatste
 * standaard ingeklapt en na 30 dagen weg), elke rij toont periode + tijdshint
 * + eerste regel omschrijving, en de kop is één rij zoek + lijnfilter.
 */
export function DiversionsView({ diversions }: { diversions: Diversion[]; lastSyncedAt?: number | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLine, setSelectedLine] = useState<string>('all');
  const [toonVerlopen, setToonVerlopen] = useState(false);
  const inline = useInlinePaneel();
  const vandaag = isoDate(new Date());

  // Per lijn, niet per omleiding: "883, 884" telt als twee lijnen in de filter.
  // "Alle" is geen lijn maar een bereik; die omleidingen vallen onder elke filterkeuze.
  const uniqueLines = Array.from(new Set(diversions.flatMap((div) => lijnenVan(div.line)).filter((l) => !isAlleLijnen(l)))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const zoek = searchQuery.trim().toLowerCase();
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
  // Wie zoekt, wil ook een verlopen treffer zien: dan klapt "Voorbij" vanzelf open.
  const verlopenOpen = toonVerlopen || zoek.length > 0;
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
      illustratie={zoek ? <NietGevonden /> : <LegeLijst />}
      title={zoek ? 'Geen resultaten' : 'Geen omleidingen'}
      message={zoek ? `Geen omleidingen gevonden voor “${searchQuery}”` : 'Er zijn op dit moment geen omleidingen. Zodra er een wordt toegevoegd, verschijnt ze hier.'}
      action={zoek ? (
        <Button variant="secondary" size="sm" onClick={() => setSearchQuery('')}>
          Wis zoekopdracht
        </Button>
      ) : undefined}
    />
  ) : (
    <div className="space-y-6">
      {secties.filter((s) => s.items.length > 0).map((s) => (
        <section key={s.fase} aria-labelledby={`omleidingen-${s.fase}`}>
          <SectieKop id={`omleidingen-${s.fase}`} titel={s.titel} aantal={s.items.length} />
          <ul className="space-y-2" aria-label={s.titel}>
            {s.items.map((div) => (
              <OmleidingRij key={div.id} div={div} vandaag={vandaag} isCurrent={detail?.id === div.id} onClick={() => kies(div.id)} />
            ))}
          </ul>
        </section>
      ))}

      {nietsActueel && (
        <p className="text-sm text-slate-500">Geen lopende of komende omleidingen.</p>
      )}

      {groepen.verlopen.length > 0 && (
        <section aria-labelledby="omleidingen-verlopen">
          {/* rauw: sectiekop als toggle (tekst + chevron), geen knop-uiterlijk */}
          <button
            type="button"
            onClick={() => setToonVerlopen((v) => !v)}
            aria-expanded={verlopenOpen}
            aria-controls="omleidingen-verlopen-lijst"
            className="ios-pressable -mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between rounded-lg px-1 py-1 text-left transition-colors hover:bg-slate-500/6"
          >
            <SectieKop id="omleidingen-verlopen" titel="Voorbij" aantal={groepen.verlopen.length} inline />
            <span className="flex items-center gap-1 text-2xs font-medium text-slate-500">
              {verlopenOpen ? 'Verbergen' : 'Tonen'}
              <ChevronDown size={14} className={cn('transition-transform', verlopenOpen && 'rotate-180')} />
            </span>
          </button>
          {verlopenOpen && (
            <ul id="omleidingen-verlopen-lijst" className="mt-2 space-y-2" aria-label="Voorbij">
              {groepen.verlopen.map((div) => (
                <OmleidingRij key={div.id} div={div} vandaag={vandaag} isCurrent={detail?.id === div.id} onClick={() => kies(div.id)} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title="Omleidingen"
        description="Wat er anders rijdt, met begin en einde."
        actions={(
          <div className="flex w-full gap-2 md:w-auto">
            <div className="relative min-w-0 flex-1 md:w-64 group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={16} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
              </div>
              <Input
                type="text"
                placeholder="Zoek…"
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
              className="w-auto shrink-0 font-semibold cursor-pointer md:w-40"
            >
              <option value="all">Alle lijnen</option>
              {uniqueLines.map(line => (
                <option key={line} value={line}>{lijnLabel(line)}</option>
              ))}
            </Select>
          </div>
        )}
      />

      <MasterDetail
        lijst={lijst}
        paneel={gefilterd.length > 0 ? (
          <DetailPaneel
            open={!!detail}
            onClose={() => setSelectedId(null)}
            title={detail?.title ?? 'Omleiding'}
            subtitle={detail ? [lijnLabel(detail.line), detail.location].filter(Boolean).join(' · ') : undefined}
            sleutel={detail?.id}
            leegTekst="Kies een omleiding."
            icon={detail ? <LijnTegel line={detail.line} tone={omleidingsFase(detail, vandaag) === 'verlopen' ? 'muted' : 'accent'} /> : undefined}
            chip={detail ? <FaseBadge fase={omleidingsFase(detail, vandaag)} hint={omleidingsTijdshint(detail, vandaag)} /> : undefined}
          >
            {detail && <DiversionBody diversion={detail} />}
          </DetailPaneel>
        ) : undefined}
      />
    </PageShell>
  );
}

/** Rustige sectiekop met teller: "Nu geldig · 2". */
function SectieKop({ id, titel, aantal, inline = false }: { id: string; titel: string; aantal: number; inline?: boolean }) {
  return (
    <h3 id={id} className={cn('flex items-baseline gap-1.5', !inline && 'mb-2 px-0.5')}>
      <MicroLabel>{titel}</MicroLabel>
      <span className="text-2xs font-medium tabular-nums text-slate-500">{aantal}</span>
    </h3>
  );
}

/** Alleen de afwijkende toestanden krijgen een chip; "actief" is de norm.
 *  Komend draagt meteen de timing ("Start over 5 dagen"): één chip in plaats
 *  van "Komend" plus een losse hint die op mobiel naar een eigen regel brak. */
function FaseBadge({ fase, hint }: { fase: OmleidingsFase; hint?: string }) {
  if (fase === 'komend') {
    const label = hint ? hint.charAt(0).toUpperCase() + hint.slice(1) : 'Komend';
    return <Badge tone="oker" icon={<Calendar size={12} />}>{label}</Badge>;
  }
  if (fase === 'verlopen') return <Badge tone="slate">Verlopen</Badge>;
  return null;
}

/** Eén lijstrij: lijntegel, titel (+ PDF-icoontje), periode met tijdshint,
 *  eerste regel van de omschrijving. */
function OmleidingRij({ div, vandaag, isCurrent, onClick }: { div: Diversion; vandaag: string; isCurrent: boolean; onClick: () => void }) {
  const fase = omleidingsFase(div, vandaag);
  const hint = omleidingsTijdshint(div, vandaag);
  const verlopen = fase === 'verlopen';
  return (
    <Card
      as="li"
      padding="none"
      interactive
      aria-current={isCurrent ? 'true' : undefined}
      className={cn('overflow-hidden', verlopen && 'opacity-60', isCurrent && 'ring-1 ring-oker-400 bg-oker-50/40')}
    >
      {/* rauw: lijstrij van het master-detail (kaart als knop: lijntegel + titel + periode + omschrijving + chevron) */}
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50/50 md:px-4"
      >
        <LijnTegel line={div.line} size="sm" tone={verlopen ? 'muted' : 'accent'} className="mt-0.5 self-start" />
        <div className="min-w-0 flex-1">
          {/* Plaats vet en in oker vóór de titel: dát scant een chauffeur als eerste (Jarno 10-09). */}
          <h4 className="text-card-title leading-snug" data-vt-record={div.id}>
            {div.location && <span className={verlopen ? 'text-slate-600' : 'text-oker-800'}>{div.location} · </span>}
            {div.title}
            {div.pdfUrl && (
              <FileText size={14} className="ml-1.5 inline-block align-[-2px] text-slate-400" aria-label="Met PDF-bijlage" />
            )}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold tabular-nums">
            <FaseBadge fase={fase} hint={hint} />
            {fase === 'lopend' && <Calendar size={14} className="text-oker-500" />}
            <span className={verlopen ? 'text-slate-500' : 'text-slate-700'}>{omleidingsPeriode(div, vandaag)}</span>
            {hint && fase === 'lopend' && <span className="whitespace-nowrap font-medium text-slate-500">· {hint}</span>}
          </div>
          {div.description && (
            <p className="mt-1 truncate text-xs font-normal text-slate-500">{div.description}</p>
          )}
        </div>
        <ChevronRight size={20} className={cn('shrink-0', isCurrent ? 'text-oker-500' : 'text-slate-300')} />
      </button>
    </Card>
  );
}

/**
 * Inhoud van één omleiding: periode bovenaan, dan de omschrijving met behoud
 * van regeleinden, en één PDF-knop. Gedeeld met de dashboard-SlideOver.
 */
export function DiversionBody({ diversion: div }: { diversion: Diversion }) {
  const hint = omleidingsTijdshint(div);
  return (
    <div className="space-y-5">
      <Card tone="muted" padding="sm">
        <MicroLabel>Periode</MicroLabel>
        <p className="mt-1.5 text-sm font-semibold text-slate-800 tabular-nums">
          {omleidingsPeriode(div)}{!div.endDate && ', geen einddatum'}
        </p>
        {hint && <p className="mt-0.5 text-xs font-medium text-slate-500">{hint}</p>}
      </Card>

      <div>
        <MicroLabel>Omschrijving</MicroLabel>
        <p className="mt-2 whitespace-pre-line text-sm font-normal leading-relaxed text-slate-700">{div.description}</p>
      </div>

      {div.pdfUrl && (
        <Button
          variant="secondary"
          size="lg"
          full
          icon={<FileText size={16} className="text-red-500" />}
          onClick={() => openPdfInNewTab(div.pdfUrl)}
        >
          Open PDF
        </Button>
      )}
    </div>
  );
}
