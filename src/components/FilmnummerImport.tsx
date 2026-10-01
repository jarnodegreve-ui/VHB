import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { parseFilmnummerLijst, verdeelFilmnummers, type Filmnummer, type FilmnummerLijst } from '../../shared/filmnummers';
import { apiFetch } from '../lib/api';
import { MAX_IMPORT_BYTES, filmnummersUitRijen, rijenUitBestand, vergelijkFilmnummers, type FilmImport } from '../lib/filmnummerImport';
import { aantal } from '../lib/format';
import { meldSchrijffout } from '../lib/fouten';
import { Callout } from './Callout';
import { Modal, SluitKnop } from './Modal';
import { Tabel, TableShell, Td, Th } from './TabelBasis';
import { Uitklap, uitklapChevron } from './Uitklap';
import { Button, Chip } from './primitives';
import { ModalHeader } from './ui';

/**
 * Het importvenster van de filmnummers (admin): leest het gekozen bestand,
 * toont wat erin staat en wat er tegenover de huidige lijst verandert, en
 * vervangt de lijst pas na bevestiging. Eigen, lui geladen chunk: een
 * chauffeur laadt dit nooit.
 */

type Staat =
  | { fase: 'lezen' }
  | { fase: 'fout'; tekst: string }
  | { fase: 'klaar'; uit: FilmImport };

const GEEN_NUMMERS = 'In dit bestand staan geen filmnummers. Verwacht: een kolom met het nummer en een kolom met de tekst van de film.';
const TE_GROOT = 'Dit bestand is groter dan 2 MB; een lijst met filmnummers is veel kleiner. Kies het juiste bestand.';
const ONLEESBAAR = 'Het bestand kon niet gelezen worden. Kies een CSV- of Excel-bestand.';

/** Hoe het bestand gelezen is, in gewone woorden: zo ziet de admin of de kolommen juist begrepen zijn. */
const leesUitleg = (g: FilmImport['gelezen']): string => {
  const delen = [
    g.kopregel
      ? 'Gelezen volgens de kopregel van het bestand.'
      : g.lijnKolom
        ? 'Geen kopregel gevonden: kolom 1 is het nummer, kolom 2 de lijn, kolom 3 de tekst.'
        : 'Kolom 1 is het nummer, kolom 2 de tekst van de film.',
  ];
  if (g.lijnKolomOngebruikt) delen.push('De kolom Lijn hoort niet bij elk blok en is niet gebruikt.');
  if (!g.lijnKolom || g.lijnKolomOngebruikt) delen.push('Bij een nummer van vier cijfers of meer is het begin van de tekst de lijn (5000: 50 Brugge Station).');
  if (g.extraCellen > 0) delen.push(`Bij ${aantal(g.extraCellen, 'regel', 'regels')} staat ook iets in een derde kolom; dat is niet gelezen.`);
  return delen.join(' ');
};

/** "5001 Maldegem, 5002 Maldegem en 3 andere": genoeg om te herkennen wat er wijzigt. */
const opsomming = (items: readonly Filmnummer[], max = 4): string => {
  const eerste = items.slice(0, max).map((f) => `${f.code} ${f.tekst}`).join(', ');
  return items.length > max ? `${eerste} en ${aantal(items.length - max, 'andere', 'andere')}` : eerste;
};

export default function FilmnummerImport({ bestand, huidig, onKlaar, onSluit }: {
  bestand: File;
  huidig: Filmnummer[];
  onKlaar: (lijst: FilmnummerLijst) => void;
  onSluit: () => void;
}) {
  const [staat, setStaat] = useState<Staat>({ fase: 'lezen' });
  const [bezig, setBezig] = useState(false);
  const [alles, setAlles] = useState(false);

  useEffect(() => {
    if (bestand.size > MAX_IMPORT_BYTES) {
      setStaat({ fase: 'fout', tekst: TE_GROOT });
      return;
    }
    let actueel = true;
    setStaat({ fase: 'lezen' });
    void (async () => {
      try {
        const uit = filmnummersUitRijen(await rijenUitBestand(bestand));
        if (!actueel) return;
        setStaat(uit.items.length === 0 && uit.overgeslagen.length === 0 ? { fase: 'fout', tekst: GEEN_NUMMERS } : { fase: 'klaar', uit });
      } catch {
        if (actueel) setStaat({ fase: 'fout', tekst: ONLEESBAAR });
      }
    })();
    return () => { actueel = false; };
  }, [bestand]);

  const uit = staat.fase === 'klaar' ? staat.uit : null;
  const items = uit?.items ?? [];
  const leesbaar = items.length > 0;
  const indeling = verdeelFilmnummers(items);
  const verschil = vergelijkFilmnummers(huidig, items);
  const gelijk = huidig.length > 0 && verschil.nieuw.length === 0 && verschil.gewijzigd.length === 0 && verschil.weg.length === 0;
  // Een bestand dat niets verandert valt niet op te slaan: alleen Sluiten.
  const kanOpslaan = leesbaar && !gelijk;
  // Rem vóór de bevestiging: een verkeerd bestand of verkeerd gelezen kolommen
  // holt de lijst uit. De admin beslist, maar ziet het eerst.
  const holtUit = kanOpslaan && verschil.weg.length * 2 > huidig.length;

  const opslaan = async () => {
    if (bezig || !kanOpslaan) return;
    setBezig(true);
    try {
      const res = await apiFetch('/api/filmnummers', { method: 'PUT', body: JSON.stringify({ items }) });
      const antwoord: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const a = antwoord as { error?: string; details?: string } | null;
        // De hele lijst in één PUT: opnieuw proberen schrijft niets dubbel.
        meldSchrijffout('Importeren', { status: res.status, message: a?.details || a?.error }, () => void opslaan());
        return;
      }
      const bewaard = parseFilmnummerLijst(antwoord);
      // De server antwoordt met de bewaarde lijst. Een 200 zonder lijst (de
      // aanmeldpagina van een wifi-netwerk, een lege body) bewijst niet dat er
      // iets bewaard is, en mag de lijst op het scherm en het toestel niet wissen.
      if (bewaard.items.length === 0) {
        meldSchrijffout('Importeren', undefined, () => void opslaan());
        return;
      }
      onKlaar(bewaard);
      onSluit();
    } catch (err) {
      meldSchrijffout('Importeren', err, () => void opslaan());
    } finally {
      setBezig(false);
    }
  };

  return (
    <Modal open onClose={onSluit} vast={bezig} maxWidth="lg" ariaLabel="Filmnummers importeren" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
      <ModalHeader title="Filmnummers importeren" description={bestand.name} onClose={bezig ? undefined : onSluit} />
      <div className="flex-1 space-y-5 overflow-y-auto p-6 md:p-7">
        {staat.fase === 'lezen' && <p role="status" className="text-body text-slate-500">Bestand lezen…</p>}

        {staat.fase === 'fout' && <Callout tone="danger" role="alert" title="Niets om te importeren">{staat.tekst}</Callout>}

        {uit && (
          <>
            {leesbaar ? (
              <div className="space-y-1.5">
                <p className="text-body text-slate-700">
                  <span className="font-semibold text-slate-900">{aantal(items.length, 'filmnummer', 'filmnummers')}</span> gevonden
                  {indeling.bestemmingen.length > 0 && `: ${aantal(indeling.bestemmingen.length, 'bestemming', 'bestemmingen')} op ${aantal(indeling.lijnen.length, 'lijn', 'lijnen')}`}
                  {indeling.bestemmingen.length > 0 && indeling.algemeen.length > 0 && ' en '}
                  {indeling.bestemmingen.length === 0 && indeling.algemeen.length > 0 && ': '}
                  {indeling.algemeen.length > 0 && aantal(indeling.algemeen.length, 'algemene boodschap', 'algemene boodschappen')}.
                </p>
                <p className="text-body-sm text-slate-500">{leesUitleg(uit.gelezen)}</p>
              </div>
            ) : (
              <Callout tone="danger" role="alert" title="Niets om te importeren">Geen enkele regel van dit bestand is een geldig filmnummer.</Callout>
            )}

            {indeling.lijnen.length > 0 && (
              <div>
                <h3 className="text-subsection-title">Lijnen in het bestand</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {indeling.lijnen.map((lijn) => (
                    <Chip key={lijn} className="text-xs">
                      {lijn}
                      <span className="font-sans font-medium text-slate-500">×{indeling.bestemmingen.filter((f) => f.lijn === lijn).length}</span>
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            {leesbaar && (
              <div>
                <h3 className="text-subsection-title">Wat er verandert</h3>
                {huidig.length === 0 ? (
                  <p className="mt-1 text-body-sm text-slate-600">Er staat nog geen lijst; dit wordt de eerste.</p>
                ) : gelijk ? (
                  <p className="mt-1 text-body-sm text-slate-600">Niets: dit bestand is gelijk aan de lijst die er staat.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-body-sm text-slate-600">
                    {verschil.nieuw.length > 0 && (
                      <li><span className="font-semibold text-slate-900">{verschil.nieuw.length} nieuw</span>: {opsomming(verschil.nieuw)}</li>
                    )}
                    {verschil.gewijzigd.length > 0 && (
                      <li><span className="font-semibold text-slate-900">{verschil.gewijzigd.length} gewijzigd</span>: {opsomming(verschil.gewijzigd.map((g) => g.na))}</li>
                    )}
                    {verschil.weg.length > 0 && (
                      <li><span className="font-semibold text-slate-900">{verschil.weg.length} {verschil.weg.length === 1 ? 'verdwijnt' : 'verdwijnen'}</span>: {opsomming(verschil.weg)}</li>
                    )}
                  </ul>
                )}
              </div>
            )}

            {holtUit && (
              <Callout tone="warning" role="alert" title="Meer dan de helft van de lijst verdwijnt">
                De lijst telt nu {aantal(huidig.length, 'nummer', 'nummers')}; na deze import {items.length === 1 ? 'blijft er 1 over' : `blijven er ${items.length} over`}. Kijk na of dit het juiste bestand is.
              </Callout>
            )}

            {uit.overgeslagen.length > 0 && (
              <Callout tone="warning" title={`${aantal(uit.overgeslagen.length, 'regel', 'regels')} overgeslagen`}>
                <ul className="space-y-0.5">
                  {uit.overgeslagen.slice(0, 8).map((o, i) => (
                    <li key={`${o.regel}-${i}`}>
                      {o.regel > 0 ? `Regel ${o.regel}` : 'Het bestand'}{o.inhoud ? ` (${o.inhoud})` : ''}: {o.reden.charAt(0).toLowerCase() + o.reden.slice(1)}.
                    </li>
                  ))}
                  {uit.overgeslagen.length > 8 && <li>En nog {aantal(uit.overgeslagen.length - 8, 'regel', 'regels')}.</li>}
                </ul>
              </Callout>
            )}

            {leesbaar && (
              <div>
                <Button variant="ghost" size="sm" aria-expanded={alles} aria-controls="film-import-alles" onClick={() => setAlles((v) => !v)} iconRechts={<ChevronDown size={14} className={uitklapChevron(alles)} />}>
                  {alles ? 'Nummers verbergen' : `Alle ${items.length} nummers bekijken`}
                </Button>
                <Uitklap open={alles} id="film-import-alles">
                  <TableShell label="Filmnummers in het bestand" className="mt-2">
                    <Tabel>
                      <thead>
                        <tr>
                          <Th>Nummer</Th>
                          <Th>Lijn</Th>
                          <Th>Tekst</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...indeling.bestemmingen, ...indeling.algemeen].map((f) => (
                          <tr key={f.code} className="border-t border-hairline-subtle">
                            <Td nowrap className="font-mono font-semibold text-slate-900">{f.code}</Td>
                            <Td nowrap>{f.lijn || <span className="text-slate-400">—</span>}</Td>
                            <Td>{f.tekst}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Tabel>
                  </TableShell>
                </Uitklap>
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-hairline p-5 sm:flex-row sm:justify-end md:px-7">
        <SluitKnop onClose={onSluit} variant="secondary" size="lg" disabled={bezig}>{kanOpslaan ? 'Annuleren' : 'Sluiten'}</SluitKnop>
        {kanOpslaan && (
          <Button variant="primary" size="lg" bezig={bezig} onClick={() => void opslaan()}>
            {huidig.length === 0 ? 'Lijst importeren' : holtUit ? 'Toch vervangen' : 'Lijst vervangen'}
          </Button>
        )}
      </div>
    </Modal>
  );
}
