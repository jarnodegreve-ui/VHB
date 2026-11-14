import { Suspense, useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import { verdeelFilmnummers, zoekFilmnummers, type Filmnummer, type FilmnummerLijst } from '../../shared/filmnummers';
import { haalFilmnummers, leesFilmnummersLokaal, noteerFilmnummerImport } from '../lib/filmnummers';
import { aantal, formatDatumDMJ } from '../lib/format';
import { lazyWithRetry } from '../lib/lazyRetry';
import { notify } from '../lib/ui';
import { useZelfLadend } from '../lib/zelfLadend';
import { Card } from '../components/Card';
import { SearchField } from '../components/Field';
import { LijnTegel } from '../components/LijnTegel';
import { LijstKaart } from '../components/RecordRij';
import { Skeleton } from '../components/Skeleton';
import { Verwissel } from '../components/Verwissel';
import { LegeLijst, NietGevonden } from '../components/illustraties';
import { Button, FilterChip } from '../components/primitives';
import { EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel } from '../components/ui';

// De import (bestand lezen, voorbeeld, opslaan) is admin-werk en laadt pas
// als een admin een bestand kiest: de chunk van de chauffeur blijft de lijst.
const LazyFilmnummerImport = lazyWithRetry(() => import('../components/FilmnummerImport'));

const BESTANDEN = '.csv,.txt,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Stil verversen bij terugkeer naar het scherm: de lijst wijzigt zelden. */
const VERVERS_NA_MS = 10 * 60_000;

/**
 * De laatst gekozen lijn blijft op het toestel staan (ronde 6, 11-11): wie
 * altijd lijn 50 rijdt, kiest die niet bij elke eindhalte opnieuw. Geen
 * waarde = Alle, '' = Algemeen, anders de lijn. Een voorkeur van dit toestel,
 * geen gegevens: ze blijft dus staan bij uitloggen, zoals de roosterweergave.
 * Hier en niet in src/lib/filmnummers.ts: dat bestand laadt mee met de stille
 * warmup van elke start.
 */
const LIJN_SLEUTEL = 'vhb-filmnummers-lijn';
const leesLijnKeuze = (): string | null => {
  try {
    return window.localStorage.getItem(LIJN_SLEUTEL);
  } catch {
    return null;
  }
};
const bewaarLijnKeuze = (keuze: string | null): void => {
  try {
    if (keuze === null) window.localStorage.removeItem(LIJN_SLEUTEL);
    else window.localStorage.setItem(LIJN_SLEUTEL, keuze);
  } catch {
    /* privémodus of opslag geblokkeerd: de keuze geldt dan tot het scherm sluit */
  }
};

/**
 * Filmnummers (01-10): het nummer dat een chauffeur op het bedieningstoestel
 * intoetst om de juiste bestemming op de bus te tonen. Een naslaglijst: zoeken
 * op lijn, bestemming of nummer, of één lijn kiezen. De bestemmingen staan per
 * lijn bij elkaar en vooraan, de algemene boodschappen (Geen dienst,
 * Stelplaats) erna.
 *
 * De lijst staat ook op het toestel (src/lib/filmnummers.ts): het scherm
 * toont die kopie meteen en ververst erachter, dus onderweg staat ze er
 * zonder wachten en zonder bereik. Een admin vervangt de lijst met een import
 * (CSV of Excel) op dit scherm; alle anderen lezen alleen.
 */
export function FilmnummersView({ magBeheren }: { magBeheren: boolean }) {
  const [lijst, setLijst] = useState<FilmnummerLijst | null>(leesFilmnummersLokaal);
  const [zoek, setZoek] = useState('');
  // null = alles, '' = de algemene boodschappen, anders één lijn. Begint op
  // de keuze van de vorige keer; alleen een tik bewaart (nooit een effect:
  // zolang de lijst laadt zijn er nog geen lijnen om de keuze aan te toetsen).
  const [keuze, setKeuzeState] = useState<string | null>(leesLijnKeuze);
  const setKeuze = (volgende: string | null) => {
    setKeuzeState(volgende);
    bewaarLijnKeuze(volgende);
  };
  const [importBestand, setImportBestand] = useState<File | null>(null);
  const bestandRef = useRef<HTMLInputElement>(null);

  const zl = useZelfLadend(async () => { setLijst(await haalFilmnummers()); }, {
    boodschap: 'De filmnummers konden niet laden.',
    focusIntervalMs: VERVERS_NA_MS,
  });

  const items = lijst?.items ?? [];
  const { lijnen } = useMemo(() => verdeelFilmnummers(items), [items]);
  const heeftAlgemeen = items.some((f) => f.lijn === '');
  // Een gekozen lijn die uit de lijst verdween (nieuwe import, of een keuze
  // van een vorige keer) is geen filter meer: Alle. Idem voor Algemeen zonder
  // algemene boodschappen, anders stond er een lege lijst zonder actieve chip.
  const filter = keuze === null || (keuze === '' ? heeftAlgemeen : lijnen.includes(keuze)) ? keuze : null;
  const zichtbaar = useMemo(
    () => verdeelFilmnummers(zoekFilmnummers(items, zoek).filter((f) => filter === null || f.lijn === filter)),
    [items, zoek, filter],
  );
  const gefilterd = zoek.trim() !== '' || filter !== null;
  const wisFilters = () => { setZoek(''); setKeuze(null); };

  // Een onthouden lijn kan buiten beeld staan in de schuivende filterrij: bij
  // het verschijnen van de rij schuift de gekozen chip naar het midden. Alleen
  // de rij zelf (scrollLeft), nooit de pagina; bij "Alle" verandert er niets.
  const toonGekozenChip = useCallback((rij: HTMLDivElement | null) => {
    const chip = rij?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rij || !chip) return;
    rij.scrollLeft += chip.getBoundingClientRect().left - rij.getBoundingClientRect().left - (rij.clientWidth - chip.offsetWidth) / 2;
  }, []);

  const kiesBestand = () => bestandRef.current?.click();
  const bijBestand = (e: ChangeEvent<HTMLInputElement>) => {
    const bestand = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (bestand) setImportBestand(bestand);
  };
  const naImport = (nieuw: FilmnummerLijst) => {
    // Ook voor een verversing die nog onderweg is: die vertrok vóór de import
    // en zou het scherm en de kopie anders terugzetten op de oude lijst.
    noteerFilmnummerImport(nieuw);
    setLijst(nieuw);
    wisFilters();
    notify(`Filmnummers bijgewerkt: ${aantal(nieuw.items.length, 'nummer', 'nummers')}.`, 'success');
  };

  const importKnop = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} icon={<Upload size={16} />} bezig={importBestand !== null} onClick={kiesBestand}>
      {items.length === 0 ? 'Lijst importeren' : 'Lijst vervangen'}
    </Button>
  );

  const skelet = (
    <Card padding="none" className="overflow-hidden" role="status" aria-busy="true" aria-label="Filmnummers worden geladen">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-hairline-subtle px-4 py-3 last:border-b-0">
          <Skeleton className="h-6 w-9" />
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="ml-auto h-5 w-12" />
        </div>
      ))}
    </Card>
  );

  return (
    <PageShell>
      <PageHeader
        title="Filmnummers"
        description="Het nummer dat je intoetst per bestemming."
        actions={(
          <>
            {/* Voor een chauffeur is de lijst naslag: de versheid staat er alleen
                zonder bereik ("Offline"), niet bij elke gewone laad. */}
            {(magBeheren || !zl.online) && <VersheidRegel {...zl.versheid} />}
            {magBeheren && lijst !== null && items.length > 0 && importKnop('secondary')}
          </>
        )}
      />
      {magBeheren && <input ref={bestandRef} type="file" accept={BESTANDEN} className="hidden" onChange={bijBestand} />}

      {zl.fout && lijst === null ? (
        <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
      ) : (
        <Verwissel laden={lijst === null} skelet={skelet}>
          <div className="space-y-6">
            {/* Met een kopie op het toestel is geen bereik geen fout: de lijst staat er. */}
            {zl.fout && zl.online && <Foutkaart compact boodschap={zl.fout} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}

            {items.length === 0 ? (
              <EmptyState
                illustratie={<LegeLijst />}
                title="Nog geen filmnummers"
                message={magBeheren
                  ? 'Importeer de lijst als CSV of Excel: een kolom met het nummer en een met de tekst van de film.'
                  : 'Zodra de lijst klaarstaat, verschijnt ze hier.'}
                action={magBeheren ? importKnop('primary') : undefined}
              />
            ) : (
              <>
                <div className="space-y-2.5">
                  <SearchField value={zoek} onChange={setZoek} placeholder="Lijn, bestemming of nummer…" label="Zoek in de filmnummers" className="w-full md:max-w-sm" />
                  {/* Eén schuivende regel, zoals de filterrij van een tabel; -m/p
                      van 1 houdt de focusrand binnen de overflow. */}
                  <div
                    ref={toonGekozenChip}
                    role="group"
                    aria-label="Toon"
                    className="filter-rij filter-rij-rand -m-1 flex items-center gap-1.5 overflow-x-auto p-1 [--filter-rand:var(--gutter)] max-md:mx-gutter-neg max-md:px-gutter [&>*]:shrink-0"
                  >
                    <FilterChip active={filter === null} onClick={() => setKeuze(null)}>Alle</FilterChip>
                    {heeftAlgemeen && <FilterChip active={filter === ''} onClick={() => setKeuze('')}>Algemeen</FilterChip>}
                    {lijnen.map((lijn) => (
                      <FilterChip key={lijn} active={filter === lijn} aria-label={`Lijn ${lijn}`} onClick={() => setKeuze(lijn)}>{lijn}</FilterChip>
                    ))}
                  </div>
                </div>

                {zichtbaar.bestemmingen.length === 0 && zichtbaar.algemeen.length === 0 ? (
                  <EmptyState
                    illustratie={<NietGevonden />}
                    title="Geen filmnummer gevonden"
                    message="Geen nummer voor deze zoekopdracht of lijn."
                    action={gefilterd ? <Button variant="secondary" size="sm" onClick={wisFilters}>Wis filters</Button> : undefined}
                  />
                ) : (
                  <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
                    <Sectie id="film-bestemmingen" titel="Bestemmingen" items={zichtbaar.bestemmingen} />
                    <Sectie id="film-algemeen" titel="Algemeen" items={zichtbaar.algemeen} />
                  </div>
                )}

                {lijst?.bijgewerktOp && (
                  <p className="px-0.5 text-xs text-slate-500">
                    Lijst van {formatDatumDMJ(lijst.bijgewerktOp)} · {aantal(items.length, 'nummer', 'nummers')}
                  </p>
                )}
              </>
            )}
          </div>
        </Verwissel>
      )}

      {importBestand && (
        <Suspense fallback={null}>
          <LazyFilmnummerImport bestand={importBestand} huidig={items} onKlaar={naImport} onSluit={() => setImportBestand(null)} />
        </Suspense>
      )}
    </PageShell>
  );
}

/** Eén lijst met kop en teller; leeg = niets (de andere sectie vult het scherm). */
function Sectie({ id, titel, items }: { id: string; titel: string; items: Filmnummer[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex items-center gap-2 px-0.5">
        <h2 id={id} className="text-micro">{titel}</h2>
        <span className="rounded-md bg-slate-500/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{items.length}</span>
      </div>
      <LijstKaart aria-label={titel}>
        {items.map((f) => (
          <li key={f.code} className="flex items-center gap-3 px-4 py-3">
            {/* Vaste breedte voor de lijntegel: de bestemmingen staan zo onder elkaar. */}
            {f.lijn && <span className="flex w-11 shrink-0"><LijnTegel line={f.lijn} size="sm" /></span>}
            <span className="min-w-0 flex-1 text-row-title [overflow-wrap:anywhere]">{f.tekst}</span>
            {/* Het nummer is wat je intoetst: groot en in de vaste letter, zoals een dienstnummer. */}
            <span className="shrink-0 font-mono text-lg font-semibold tabular-nums text-slate-900">{f.code}</span>
          </li>
        ))}
      </LijstKaart>
    </section>
  );
}
