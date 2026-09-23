import { Children, useCallback, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronRight, Download, Info, Link2, Printer, RotateCcw } from 'lucide-react';
import type { User, View } from '../../types';
import { isStaf } from '../../types';
import { useQueryParams, useRoute } from '../../app/router';
import { padVan } from '../../app/routes';
import { useAppDataContext } from '../../app/AppDataContext';
import { DOMEINEN, rapportVan, rapportenVanDomein, type DomeinDef } from '../../../shared/rapporten/register';
import type { RapportDefinitie, RapportFilter, RapportFilters } from '../../../shared/rapporten/types';
import { filterParams, filtersNaarQuery, heeftEigenFilters, leesFilters, periodeVanFilters } from '../../../shared/rapporten/filters';
import { periodeFout } from '../../../shared/rapporten/periode';
import { berekenTotalen, metKolommen, rijBevat, veelRijenUitleg } from '../../../shared/rapporten/opmaak';
import { SORTEER_PARAM, leesSortering, sorteringNaarParam, volgendeSortering } from '../../../shared/rapporten/sortering';
import { ZOEK_PARAM, csvBestandsnaam, laadRapport, printUrlVoor, rapportCsv, rapportQuery, type RapportAntwoord } from '../../lib/rapporten';
import { printbladKlaar, printbladUrl, printbladenVanDomein, type PrintbladDef, type PrintbladWaarden } from '../../lib/rapportPrintbladen';
import { bereikUitleg } from '../../lib/rapportBereik';
import { useZelfLadend } from '../../lib/zelfLadend';
import { addDagen, isoDate, maandPlus } from '../../lib/datum';
import { MONTH_NAMES, formatDatumDMJ } from '../../lib/format';
import { maandagVan } from '../../lib/roosterUren';
import { isoWeekOf } from '../../lib/week';
import { cn, downloadBlob, notify, openPdfInNewTab } from '../../lib/ui';
import { EmptyState, Foutkaart, ModalHeader, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { NietGevonden } from '../../components/illustraties';
import { ActieMenu } from '../../components/ActieMenu';
import { Modal } from '../../components/Modal';
import { Field, DateInput } from '../../components/Field';
import { Button, Segmented } from '../../components/primitives';
import { TableShell } from '../../components/TabelBasis';
import { TableToolbar } from '../../components/Table';
import { SkeletonRow } from '../../components/Skeleton';
import { MaandNavigatie } from '../../components/MaandNavigatie';
import { Chauffeurkiezer } from '../../components/Chauffeurkiezer';
import { JaarKiezer } from '../../components/Periodekiezer';
import { useVoertuigen } from '../../components/Voertuigkiezer';
import { RapportFilterbalk } from '../../components/RapportFilterbalk';
import { RapportTabel } from '../../components/RapportTabel';

/**
 * Rapporten (20-09): één plek voor alle overzichten, zoals het rapportenmenu
 * in de Access-databases. De URL is de bron:
 *
 *   /rapporten                       de catalogus, per domein
 *   /rapporten/<domein>/<rapport>    één rapport, filters in de querystring
 *
 * Een rapport is een definitie uit het register (shared/rapporten): dit
 * scherm, de filters, de tabel, de CSV en het printblad volgen daaruit. Een
 * nieuw rapport vraagt hier dus geen code.
 */
export function RapportenView({ currentUser }: { currentUser: User }) {
  const { params, navigeer } = useRoute();
  const rapportId = params[1] ?? null;
  const naarCatalogus = () => navigeer('rapporten');
  if (!rapportId) return <Catalogus isAdmin={currentUser.role === 'admin'} />;
  const def = rapportVan(rapportId);
  if (!def) {
    return (
      <PageShell breed>
        <PageHeader view="rapporten" eyebrow="" title="Rapporten" />
        <EmptyState
          illustratie={<NietGevonden />}
          title="Dit rapport bestaat niet"
          message="De link wijst naar een rapport dat er niet (meer) is."
          action={<Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={naarCatalogus}>Alle rapporten</Button>}
        />
      </PageShell>
    );
  }
  // key: een ander rapport begint met een schone tabel (sortering, pagina).
  return <RapportScherm key={def.id} def={def} onTerug={naarCatalogus} />;
}

// === Catalogus ===

const bevat = (tekst: string, q: string) => tekst.toLowerCase().includes(q);

function Catalogus({ isAdmin }: { isAdmin: boolean }) {
  const { navigeer } = useRoute();
  const [query, zetQuery] = useQueryParams();
  const zoek = query.get(ZOEK_PARAM) ?? '';
  const q = zoek.trim().toLowerCase();
  const [printblad, setPrintblad] = useState<PrintbladDef | null>(null);

  const groepen = DOMEINEN.map((domein) => ({
    domein,
    rapporten: rapportenVanDomein(domein.id).filter((r) => !q || bevat(`${r.titel} ${r.omschrijving}`, q)),
    printbladen: printbladenVanDomein(domein.id).filter((p) => !q || bevat(`${p.titel} ${p.omschrijving}`, q)),
    laadpalen: domein.id === 'voertuigen' && isAdmin && (!q || bevat('laadpalen verbruik sessies historiek laden', q)),
  }));
  const zichtbaar = groepen.filter((g) => (q ? g.rapporten.length + g.printbladen.length + (g.laadpalen ? 1 : 0) > 0 : true));
  const aantal = groepen.reduce((n, g) => n + g.rapporten.length + g.printbladen.length, 0);

  return (
    <PageShell breed>
      <PageHeader
        view="rapporten"
        eyebrow=""
        title="Rapporten"
        description="Alle overzichten op één plek. Kies een rapport, stel de filters in en druk af of exporteer naar CSV."
      />
      <TableToolbar
        zoek={zoek}
        onZoek={(v) => zetQuery({ [ZOEK_PARAM]: v })}
        placeholder="Zoek een rapport…"
        telling={`${aantal} ${aantal === 1 ? 'rapport' : 'rapporten'}`}
      />
      {zichtbaar.length === 0 ? (
        <EmptyState
          illustratie={<NietGevonden />}
          title={`Geen rapport gevonden voor “${zoek.trim()}”`}
          message="Probeer een ander woord, of bekijk de volledige lijst."
          action={<Button variant="secondary" onClick={() => zetQuery({ [ZOEK_PARAM]: null })}>Zoekopdracht wissen</Button>}
        />
      ) : (
        // Kolommen in plaats van een raster: de blokken zijn ongelijk van hoogte en
        // een raster liet onder het kortste blok van elke rij een gat.
        <div className="space-y-8 lg:columns-2 lg:gap-x-8 lg:space-y-0 [&>section]:break-inside-avoid lg:[&>section]:mb-8">
          {zichtbaar.map(({ domein, rapporten, printbladen, laadpalen }) => (
            <DomeinBlok key={domein.id} domein={domein}>
              {rapporten.map((r) => (
                <CatalogusRij
                  key={r.id}
                  titel={r.titel}
                  omschrijving={r.omschrijving}
                  href={padVan('rapporten', [r.domein, r.id])}
                  onKies={() => navigeer('rapporten', { params: [r.domein, r.id] })}
                  staart={<ChevronRight size={16} />}
                />
              ))}
              {printbladen.map((p) => (
                <CatalogusRij key={p.id} titel={p.titel} omschrijving={p.omschrijving} onKies={() => setPrintblad(p)} meta="Printblad" staart={<Printer size={16} />} />
              ))}
              {laadpalen && (
                <CatalogusRij
                  titel="Laadpalen"
                  omschrijving="Verbruik, sessies en historiek staan op hun eigen scherm."
                  href={padVan('ocpi-monitoring')}
                  onKies={() => navigeer('ocpi-monitoring')}
                  meta="Scherm"
                  staart={<ArrowUpRight size={16} />}
                />
              )}
            </DomeinBlok>
          ))}
        </div>
      )}
      {printblad && <PrintbladModal def={printblad} onClose={() => setPrintblad(null)} />}
    </PageShell>
  );
}

function DomeinBlok({ domein, children }: { domein: DomeinDef; children: ReactNode }) {
  const leeg = Children.toArray(children).length === 0;
  return (
    <section aria-labelledby={`domein-${domein.id}`} className={cn(domein.volgtLater && 'opacity-60')}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id={`domein-${domein.id}`} className="text-section-title">{domein.titel}</h2>
        {domein.volgtLater ? <span className="text-xs font-medium text-slate-500">Volgt later</span> : null}
      </div>
      <p className="mt-1 px-1 text-body-sm text-slate-500">{domein.omschrijving}</p>
      {/* Eén kaart met rijen, geen kaart per rapport. Een domein zonder
          rapporten is één stille regel, geen lege kaart. */}
      {leeg ? (
        <p className="mt-3 border-t border-hairline px-1 pt-3 text-body-sm text-slate-500">
          {domein.volgtLater ? 'De rapporten over gewerkte uren komen in een volgende stap.' : 'Hier komen de rapporten van dit domein.'}
        </p>
      ) : (
        <ul className="surface-card mt-3 divide-y divide-hairline-subtle overflow-hidden rounded-3xl">{children}</ul>
      )}
    </section>
  );
}

function CatalogusRij({ titel, omschrijving, href, onKies, meta, staart }: {
  titel: string;
  omschrijving: string;
  /** Echte link (nieuw tabblad, link kopiëren) als de rij naar een scherm leidt. */
  href?: string;
  onKies: () => void;
  meta?: string;
  staart: ReactNode;
}) {
  const inhoud = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block text-md font-semibold text-slate-900">{titel}</span>
        <span className="mt-0.5 block text-body-sm text-slate-500">{omschrijving}</span>
      </span>
      {meta ? <span className="shrink-0 text-xs font-medium text-slate-500 max-sm:hidden">{meta}</span> : null}
      <span aria-hidden="true" className="shrink-0 text-slate-400 transition-colors group-hover:text-slate-700">{staart}</span>
    </>
  );
  const klasse = 'group flex min-h-14 w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-soft-hover md:px-5';
  return (
    <li>
      {href ? (
        <a
          href={href}
          className={klasse}
          onClick={(e) => {
            // Gewone klik = navigeren in de app; met een toets erbij laat de browser zijn ding doen (nieuw tabblad).
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onKies();
          }}
        >
          {inhoud}
        </a>
      ) : (
        // rauw: lijstrij over de volle breedte (titel + omschrijving + icoon), geen knopvorm
        <button type="button" className={klasse} onClick={onKies}>{inhoud}</button>
      )}
    </li>
  );
}

// === Bestaande printbladen: parameters kiezen, dan hun eigen print-URL openen ===

function PrintbladModal({ def, onClose }: { def: PrintbladDef; onClose: () => void }) {
  const { users } = useAppDataContext();
  const vandaag = isoDate(new Date());
  const [w, setW] = useState<PrintbladWaarden>({ maand: vandaag.slice(0, 7), chauffeur: '', jaar: Number(vandaag.slice(0, 4)), dag: vandaag, omvang: 'open' });
  const zet = (deel: Partial<PrintbladWaarden>) => setW((v) => ({ ...v, ...deel }));
  const mensen = useMemo(() => users.filter((u) => u.name.trim().toLowerCase() !== 'beheerder'), [users]);
  const [j, m] = w.maand.split('-').map(Number);
  const maandag = w.dag ? maandagVan(w.dag) : '';
  const open = () => {
    openPdfInNewTab(printbladUrl(def, w, `${window.location.origin}${window.location.pathname}`));
    onClose();
  };
  return (
    <Modal open onClose={onClose} maxWidth="md" ariaLabel={def.titel} className="flex flex-col !p-0">
      <ModalHeader title={def.titel} description={def.omschrijving} onClose={onClose} />
      <div className="space-y-4 p-6 md:p-7">
        {def.parameters.map((p) => {
          switch (p) {
            case 'maand':
              return (
                <div key={p} className="space-y-1.5">
                  <p className="text-label">Maand</p>
                  <MaandNavigatie label={`${MONTH_NAMES[m - 1]} ${j}`} labelClassName="min-w-36" onVorige={() => zet({ maand: maandPlus(w.maand, -1) })} onVolgende={() => zet({ maand: maandPlus(w.maand, 1) })} />
                </div>
              );
            case 'chauffeur-of-alle':
              return <Chauffeurkiezer key={p} users={mensen} waarde={w.chauffeur} onChange={(chauffeur) => zet({ chauffeur })} alleLabel="Alle chauffeurs, één stapel" />;
            case 'chauffeur':
              return <Chauffeurkiezer key={p} users={mensen.filter((u) => !isStaf(u.role))} waarde={w.chauffeur} onChange={(chauffeur) => zet({ chauffeur })} label="Medewerker" alleLabel="Kies een medewerker" />;
            case 'jaar':
              return <JaarKiezer key={p} waarde={w.jaar} onChange={(jaar) => zet({ jaar })} huidigJaar={Number(vandaag.slice(0, 4))} />;
            case 'week':
              return (
                <Field key={p} label="Dag in de week" hint={maandag ? `Week ${isoWeekOf(maandag)}, ${formatDatumDMJ(maandag)} t/m ${formatDatumDMJ(addDagen(maandag, 6))}` : undefined}>
                  {({ id, describedBy }) => <DateInput id={id} aria-describedby={describedBy} value={w.dag} onChange={(dag) => zet({ dag })} />}
                </Field>
              );
            case 'omvang':
              return (
                <div key={p} className="space-y-1.5">
                  <p className="text-label">Welke werken</p>
                  <Segmented<'open' | 'alles'>
                    label="Welke werken"
                    waarde={w.omvang}
                    opties={[{ waarde: 'open', label: 'Openstaand' }, { waarde: 'alles', label: 'Alles' }]}
                    onChange={(omvang) => zet({ omvang })}
                    itemClassName="min-h-11 px-4 sm:pointer-fine:min-h-8"
                  />
                </div>
              );
          }
        })}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Annuleren</Button>
          <Button variant="primary" icon={<Printer size={16} />} onClick={open} disabled={!printbladKlaar(def, w)}>Afdrukken</Button>
        </div>
      </div>
    </Modal>
  );
}

// === Eén rapport ===

const GEEN_RIJEN: RapportAntwoord['rijen'] = [];

function RapportScherm({ def, onTerug }: { def: RapportDefinitie; onTerug: () => void }) {
  const { users } = useAppDataContext();
  const [query, zetQuery] = useQueryParams();
  const vandaag = isoDate(new Date());
  const queryTekst = query.toString();
  const filters = useMemo(() => leesFilters(def, new URLSearchParams(queryTekst), vandaag), [def, queryTekst, vandaag]);
  const zoek = query.get(ZOEK_PARAM) ?? '';
  const domein = DOMEINEN.find((d) => d.id === def.domein);

  const periodeFilter = def.filters.find((f): f is Extract<RapportFilter, { soort: 'periode' }> => f.soort === 'periode');
  const ongeldig = periodeFilter ? periodeFout({ van: filters.van, tot: filters.tot }, { heleMaanden: periodeFilter.heleMaanden }) : null;
  const sleutel = filtersNaarQuery(def, filters).toString();

  const [data, setData] = useState<RapportAntwoord | null>(null);
  const zl = useZelfLadend(async () => {
    // Een onmogelijke periode gaat niet naar de server: de fout staat bij het veld.
    if (ongeldig) { setData(null); return; }
    setData(await laadRapport(def, filters));
  }, { deps: [def.id, sleutel], boodschap: (err) => (err instanceof Error && err.message ? err.message : 'Het rapport kon niet geladen worden.') });

  const voertuigen = useVoertuigen(def.filters.some((f) => f.soort === 'voertuig'));
  // Wie er in de personenkiezer staat volgt uit het filter: standaard iedereen
  // buiten de staf, of de rollen die de definitie noemt (mecaniciens).
  const kiesRollen = def.filters.find((f): f is Extract<RapportFilter, { soort: 'chauffeur' }> => f.soort === 'chauffeur')?.rollen;
  const mensen = useMemo(
    () => users.filter((u) => (kiesRollen ? kiesRollen.includes(u.role) : !isStaf(u.role)) && u.name.trim().toLowerCase() !== 'beheerder'),
    [users, kiesRollen],
  );
  const { navigeer } = useRoute();
  const geenBronActie = def.geenBron?.actie;

  const wijzig = (w: Partial<Omit<RapportFilters, 'keuzes' | 'vinkjes'>> & { keuzes?: Record<string, string>; vinkjes?: Record<string, boolean> }) => {
    const volgende: RapportFilters = { ...filters, ...w, keuzes: { ...filters.keuzes, ...(w.keuzes ?? {}) }, vinkjes: { ...filters.vinkjes, ...(w.vinkjes ?? {}) } };
    const q = filtersNaarQuery(def, volgende);
    zetQuery(Object.fromEntries(filterParams(def).map((naam) => [naam, q.get(naam)])));
  };
  const eigenFilters = heeftEigenFilters(def, filters, vandaag) || zoek.trim() !== '';
  const wisFilters = () => zetQuery({ ...Object.fromEntries(filterParams(def).map((naam) => [naam, null])), [ZOEK_PARAM]: null });

  const uitleg = data ? bereikUitleg(def, periodeVanFilters(def, filters), data.bereik) : null;
  const buiten = uitleg?.toestand === 'geen-bron' || uitleg?.toestand === 'buiten';
  const alle = data && !buiten ? data.rijen : GEEN_RIJEN;
  // Kolommen die van de gegevens afhangen komen met het antwoord mee; tabel,
  // zoeken, totalen en CSV lezen dan die lijst. De filters blijven van `def`.
  const kolommenUitAntwoord = data?.kolommen;
  const tabelDef = useMemo(() => metKolommen(def, kolommenUitAntwoord), [def, kolommenUitAntwoord]);
  const zichtbaar = useMemo(() => (zoek.trim() ? alle.filter((r) => rijBevat(tabelDef, r, zoek)) : alle), [alle, tabelDef, zoek]);
  const totalen = useMemo(() => (zoek.trim() || !data ? berekenTotalen(tabelDef, zichtbaar) : data.totalen), [data, tabelDef, zichtbaar, zoek]);

  // Sortering in de URL (`?sorteer=kolom` of `-kolom`, weg bij de standaard;
  // shared/rapporten/sortering.ts). Geen filter: "Filters wissen" laat haar
  // staan. Historiek: de filters vervangen de entry; de eerste sorteerklik
  // krijgt één eigen terugstap (`stap`), elke volgende klik vervangt die, dus
  // "terug" = de volgorde waarmee het rapport openging, zonder een entry per klik.
  // Gelezen tegen `tabelDef`: een kolom uit het antwoord is geldig zodra ze er is.
  const sorteerTekst = query.get(SORTEER_PARAM) ?? '';
  const sortering = useMemo(() => leesSortering(tabelDef, new URLSearchParams({ [SORTEER_PARAM]: sorteerTekst })), [tabelDef, sorteerTekst]);
  const sorteer = useCallback(
    (kolom: string) => zetQuery({ [SORTEER_PARAM]: sorteringNaarParam(def, volgendeSortering(sortering, kolom)) }, { stap: 'rapport-sortering' }),
    [def, sortering, zetQuery],
  );

  const veelRijen = veelRijenUitleg(zichtbaar.length);

  const basis = `${window.location.origin}${window.location.pathname}`;
  // Blad, CSV en link volgen de sortering van het scherm (dezelfde vergelijker, `sorteerRijen`).
  const drukAf = () => openPdfInNewTab(printUrlVoor(def, filters, basis, zoek, sortering));
  const exporteer = () => {
    void downloadBlob(csvBestandsnaam(def, filters), new Blob([rapportCsv(tabelDef, zichtbaar, totalen, sortering)], { type: 'text/csv;charset=utf-8' }));
  };
  const kopieerLink = async () => {
    const q = rapportQuery(def, filters, zoek, sortering);
    try {
      await navigator.clipboard.writeText(`${basis}?${q.toString()}`);
      notify('Link naar dit rapport gekopieerd.', 'success');
    } catch {
      notify('Kopiëren lukte niet. Kopieer de link uit de adresbalk.', 'error');
    }
  };

  const toestand: 'fout' | 'ongeldig' | 'laden' | 'buiten' | 'niets' | 'tabel' =
    zl.fout && !data ? 'fout'
      : ongeldig ? 'ongeldig'
        : !data ? 'laden'
          : buiten ? 'buiten'
            : zichtbaar.length === 0 ? 'niets' : 'tabel';
  return (
    <PageShell breed>
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2" icon={<ArrowLeft size={14} />} onClick={onTerug}>Alle rapporten</Button>
        <PageHeader
          view="rapporten"
          eyebrow={`Rapporten · ${domein?.titel ?? ''}`}
          title={def.titel}
          description={def.omschrijving}
          actions={(
            <>
              <VersheidRegel {...zl.versheid} />
              <Button variant="primary" icon={<Printer size={16} />} onClick={drukAf} disabled={Boolean(ongeldig)}>Afdrukken</Button>
              <Button variant="secondary" icon={<Download size={16} />} onClick={exporteer} disabled={zichtbaar.length === 0}>CSV</Button>
              <ActieMenu
                items={[
                  { label: 'Link kopiëren', icon: <Link2 size={16} />, onClick: () => void kopieerLink() },
                  { label: 'Filters wissen', icon: <RotateCcw size={16} />, onClick: wisFilters, disabled: !eigenFilters },
                ]}
              />
            </>
          )}
        />
      </div>

      {/* Eén kader: filters bovenaan, daaronder de tabel (of haar skelet). Een
          lege staat of laadfout staat ONDER het kader, niet erin: EmptyState en
          Foutkaart zijn zelf al een vlak, en een doos in een doos is geen ontwerp. */}
      {/* TableShell `past`: kader en naam van de tabel; de tabel schuift in
          haar eigen strook (RapportTabel meet dat zelf, met de vaste eerste
          kolom), dus het kader zelf is nooit een scrollcontainer en de kop
          plakt vanaf xl. Het filterblok staat bewust in de inhoud en niet in
          `kop`: zijn hairline hoort er alleen als er een tabel of skelet
          onder volgt, bij een lege staat eindigt het kader op de filters. */}
      <TableShell past label={def.titel}>
        {/* Vanaf lg staan filters en zoekveld op één regel (de labels boven de
            filters, het zoekveld op hun onderlijn); daaronder stapelen ze. Met
            veel filters krijgt het zoekveld zijn eigen regel in plaats van te krimpen. */}
        <div className={cn('flex flex-col gap-4 px-4 py-4 md:px-6 md:py-5 lg:flex-row lg:flex-wrap lg:items-end', (toestand === 'laden' || toestand === 'tabel') && 'border-b border-hairline')}>
          <RapportFilterbalk
            def={def}
            filters={filters}
            onChange={wijzig}
            users={mensen}
            voertuigen={voertuigen}
            vandaag={vandaag}
            jaarVanaf={data?.bereik ? Number(data.bereik.van.slice(0, 4)) : undefined}
            peildatum={def.peildatum ? data?.peildatum ?? vandaag : undefined}
          />
          <TableToolbar
            zoek={zoek}
            onZoek={(v) => zetQuery({ [ZOEK_PARAM]: v })}
            placeholder="Zoek in dit rapport…"
            className="lg:min-w-80 lg:flex-1"
            telling={data && !buiten ? (zoek.trim() ? `${zichtbaar.length} van ${alle.length}` : `${alle.length} ${alle.length === 1 ? 'rij' : 'rijen'}`) : undefined}
          />
        </div>
        {toestand === 'laden' && (
          <div className="divide-y divide-hairline-subtle" role="status" aria-busy="true" aria-label="Rapport wordt geladen">
            {Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} className="px-5 py-4" />)}
          </div>
        )}
        {toestand === 'tabel' && (
          <>
            {uitleg?.toestand === 'deels' && uitleg.tekst ? (
              <p className="flex items-start gap-2 border-b border-hairline px-4 py-3 text-body-sm text-slate-600 md:px-6">
                <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500" />
                {uitleg.tekst}
              </p>
            ) : null}
            {veelRijen ? (
              <p className="flex items-start gap-2 border-b border-hairline px-4 py-3 text-body-sm text-slate-600 md:px-6">
                <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500" />
                {veelRijen}
              </p>
            ) : null}
            <RapportTabel def={tabelDef} rijen={zichtbaar} totalen={totalen} sortering={sortering} onSorteer={sorteer} />
          </>
        )}
      </TableShell>

      {/* Drie lege gevallen, elk met eigen tekst; een laadfout is nooit een lege staat. */}
      {toestand === 'fout' && zl.fout && <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}
      {toestand === 'tabel' && zl.fout && <Foutkaart compact boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}
      {toestand === 'ongeldig' && ongeldig && <EmptyState compact title="Kies eerst een geldige periode" message={ongeldig.tekst} />}
      {toestand === 'buiten' && uitleg?.toestand === 'geen-bron' && (
        // De bron is nog leeg: zeggen waar die gegevens ingevuld worden, met de knop erbij.
        <EmptyState
          title="Nog niets geregistreerd"
          message={uitleg.tekst ?? undefined}
          action={geenBronActie ? <Button variant="secondary" icon={<ArrowUpRight size={16} />} onClick={() => navigeer(geenBronActie.view as View)}>{geenBronActie.label}</Button> : undefined}
        />
      )}
      {toestand === 'buiten' && uitleg?.toestand !== 'geen-bron' && (
        <EmptyState
          title="Geen gegevens voor deze periode"
          message={uitleg?.tekst ?? undefined}
          action={eigenFilters ? <Button variant="secondary" icon={<RotateCcw size={16} />} onClick={wisFilters}>Filters wissen</Button> : undefined}
        />
      )}
      {toestand === 'niets' && (
        <EmptyState
          illustratie={<NietGevonden />}
          title="Geen resultaten voor deze filters"
          message={`${periodeVanFilters(def, filters) ? 'In deze periode zijn er wel gegevens' : 'Er zijn wel gegevens'}, maar niets past bij wat je koos. Afdrukken kan nog: het blad toont dan de filters en dat er niets was.`}
          action={<Button variant="secondary" icon={<RotateCcw size={16} />} onClick={wisFilters}>Filters wissen</Button>}
        />
      )}
    </PageShell>
  );
}
