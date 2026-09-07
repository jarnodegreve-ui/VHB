import { useMemo, useState } from 'react';
import { Download, Sparkles } from 'lucide-react';
import { Card, CardHeader } from '../../components/Card';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, Chip, Td, Th } from '../../components/primitives';
import { Field, Input, Select } from '../../components/Field';
import { DatePicker } from '../../components/DatePicker';
import { BrandSpinner } from '../../components/BrandSpinner';
import { InfoTip } from '../../components/InfoTip';
import { Fout } from '../../components/illustraties';
import { apiJson } from '../../lib/api';
import { addDays, isoDate } from '../../lib/datum';
import { formatDateHuman } from '../../lib/format';
import { downloadBlob, notify } from '../../lib/ui';

/**
 * Roostersolver in het portaal (verbeterronde 07-09, nr. 13). Het portaal
 * bouwt en tekent het verzoek (POST /api/rooster/solver-verzoek); de browser
 * stuurt het byte-exact naar de solver op Render en toont het resultaat als
 * chauffeur × dag-raster. De solver draait op een gratis Render-plan en
 * slaapt na een kwartier stilte: de eerste aanvraag kan een minuut duren,
 * vandaar de aparte "wordt wakker"-staat.
 */
type Verzoek = {
  verzoek: string;
  handtekening: string;
  solverUrl: string;
  waarschuwingen: string[];
  samenvatting: { chauffeurs: number; diensten: number; dagen: number; afwezigheden: number; dagtypes: string[] };
};
type Cel = { datum: string; dienst: string | null; type: string | null; afwezig: string | null; rust: boolean };
type Resultaat = {
  status: string;
  haalbaar: boolean;
  rekentijd_s: number;
  periode: { begin: string; einde: string; dagen: Array<{ datum: string; dag: string; dagtype: string; weekend: boolean }> };
  rooster: Array<{ chauffeur: string; naam: string; contracturen: number; cellen: Cel[]; uren: number; uren_tekst: string }>;
  waarschuwingen: string[];
  opmerkingen: string[];
  infeasibiliteit: { items: Array<{ niveau: string; categorie: string; datums: string[]; onderwerp: string; omschrijving: string; suggestie: string }> } | null;
};

type Fase = 'idle' | 'verzoek' | 'wakker' | 'rekenen' | 'klaar' | 'fout';

const TYPE_TOON: Record<string, 'oker' | 'blue' | 'rose' | 'slate' | 'emerald'> = { V: 'oker', L: 'blue', G: 'rose', N: 'slate', D: 'emerald' };
const AFWEZIG_LABEL: Record<string, string> = { VER: 'verlof', ZIE: 'ziek', KV: 'klein verlet', ADV: 'adv', FEE: 'feestdag', OPL: 'opleiding', OV: 'onbetaald' };

const volgendeMaandag = (): string => {
  const d = new Date();
  const naarMa = (8 - d.getDay()) % 7 || 7;
  return isoDate(addDays(d, naarMa));
};

async function solverAanroep(v: Verzoek, pad: '/solve' | '/solve/xlsx', signal: AbortSignal): Promise<Response> {
  return fetch(`${v.solverUrl}${pad}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-solver-signature': v.handtekening },
    body: v.verzoek,
    signal,
  });
}

export function RoosterSolverView() {
  const [van, setVan] = useState<string>(volgendeMaandag);
  const [tot, setTot] = useState<string>(() => isoDate(addDays(new Date(volgendeMaandag()), 13)));
  const [contracturen, setContracturen] = useState('38');
  const [rekentijd, setRekentijd] = useState('45');
  const [fase, setFase] = useState<Fase>('idle');
  const [fout, setFout] = useState('');
  const [verzoek, setVerzoek] = useState<Verzoek | null>(null);
  const [resultaat, setResultaat] = useState<Resultaat | null>(null);
  const [downloadBezig, setDownloadBezig] = useState(false);

  const bezig = fase === 'verzoek' || fase === 'wakker' || fase === 'rekenen';

  const bereken = async () => {
    setFout('');
    setResultaat(null);
    setFase('verzoek');
    let v: Verzoek;
    try {
      v = await apiJson<Verzoek>('/api/rooster/solver-verzoek', { method: 'POST', body: JSON.stringify({ van, tot, contracturen, rekentijd: Number(rekentijd) }) });
      setVerzoek(v);
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Het verzoek kon niet worden opgebouwd.');
      setFase('fout');
      return;
    }
    // Wakker maken: een slapende Render-service antwoordt pas na 30 tot 60 s.
    setFase('wakker');
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 4 * 60 * 1000);
    try {
      try {
        await fetch(`${v.solverUrl}/health`, { signal: ctrl.signal });
      } catch {
        // health mislukt (CORS/koud): de echte aanroep hieronder is de test
      }
      setFase('rekenen');
      const res = await solverAanroep(v, '/solve', ctrl.signal);
      if (!res.ok) {
        let detail = '';
        try { detail = String((await res.json())?.detail ?? ''); } catch { /* geen JSON */ }
        throw new Error(detail && !detail.startsWith('[') ? detail : `De solver antwoordde ${res.status}.`);
      }
      const data = (await res.json()) as Resultaat;
      setResultaat(data);
      setFase('klaar');
    } catch (err) {
      setFout(err instanceof DOMException && err.name === 'AbortError'
        ? 'De solver antwoordde niet binnen vier minuten. Probeer het zo opnieuw.'
        : err instanceof Error ? err.message : 'De berekening is mislukt.');
      setFase('fout');
    } finally {
      window.clearTimeout(timer);
    }
  };

  const downloadExcel = async () => {
    if (!verzoek) return;
    setDownloadBezig(true);
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 4 * 60 * 1000);
    try {
      const res = await solverAanroep(verzoek, '/solve/xlsx', ctrl.signal);
      if (!res.ok) throw new Error(`Download mislukt (${res.status}).`);
      await downloadBlob(`vhb-rooster-${van}_${tot}.xlsx`, await res.blob());
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Download mislukt.', 'error');
    } finally {
      window.clearTimeout(timer);
      setDownloadBezig(false);
    }
  };

  const dagen = resultaat?.periode.dagen ?? [];
  const weken = useMemo(() => {
    const uit: Array<{ week: number; aantal: number }> = [];
    for (const d of dagen) {
      const w = new Date(`${d.datum}T00:00:00`);
      const key = Math.floor((w.getTime() - new Date(`${dagen[0].datum}T00:00:00`).getTime()) / (7 * 864e5));
      const laatste = uit[uit.length - 1];
      if (laatste && laatste.week === key) laatste.aantal += 1; else uit.push({ week: key, aantal: 1 });
    }
    return uit;
  }, [dagen]);

  return (
    <PageShell>
      <PageHeader
        title="Roostersolver"
        description="Laat de solver een rooster berekenen uit het dienstoverzicht, de verwachte diensten per dagtype, de chauffeurs en het goedgekeurde verlof."
      />

      <Card>
        <CardHeader title="Periode en aannames" description="Het dienstoverzicht en de verwachte diensten per dagtype (Openstaande diensten) zijn de bron; de rest stel je hier in." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Van"><DatePicker value={van} onChange={setVan} max={tot} /></Field>
          <Field label="Tot en met"><DatePicker value={tot} onChange={setTot} min={van} /></Field>
          <Field label="Contracturen per week" hint="Voor iedereen gelijk, bv. 38 of 38:30.">
            <Input value={contracturen} onChange={(e) => setContracturen(e.target.value)} inputMode="decimal" placeholder="38" />
          </Field>
          <Field label="Rekentijd">
            <Select value={rekentijd} onChange={(e) => setRekentijd(e.target.value)}>
              <option value="30">30 seconden</option>
              <option value="45">45 seconden</option>
              <option value="90">anderhalve minuut</option>
              <option value="120">twee minuten</option>
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<Sparkles size={16} />} onClick={() => { void bereken(); }} disabled={bezig}>
            {fase === 'verzoek' ? 'Verzoek opbouwen…' : fase === 'wakker' ? 'Solver wordt wakker…' : fase === 'rekenen' ? 'Rekenen…' : 'Rooster berekenen'}
          </Button>
          {bezig && <BrandSpinner />}
          {fase === 'wakker' && <p className="text-sm text-slate-500">De solver slaapt na een kwartier stilte; de eerste aanvraag kan een minuut duren.</p>}
          {fase === 'rekenen' && verzoek && <p className="text-sm text-slate-500">{verzoek.samenvatting.chauffeurs} chauffeurs, {verzoek.samenvatting.diensten} dienstsjablonen, {verzoek.samenvatting.dagen} dagen. Maximaal {rekentijd} s rekentijd.</p>}
        </div>
        {verzoek && verzoek.waarschuwingen.length > 0 && fase !== 'idle' && (
          <ul className="mt-4 space-y-1 border-t border-slate-100 pt-4 text-sm text-slate-600">
            {verzoek.waarschuwingen.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </Card>

      {fase === 'fout' && (
        <Card tone="danger">
          <EmptyState variant="fout" illustratie={<Fout />} title="Geen rooster" message={fout} action={<Button variant="secondary" onClick={() => { void bereken(); }}>Opnieuw proberen</Button>} />
        </Card>
      )}

      {resultaat && fase === 'klaar' && (
        <>
          <Card>
            <CardHeader
              title={resultaat.haalbaar ? `Rooster ${formatDateHuman(resultaat.periode.begin)} t/m ${formatDateHuman(resultaat.periode.einde)}` : 'Geen haalbaar rooster'}
              description={`Status ${resultaat.status.toLowerCase()}, ${resultaat.rekentijd_s} s gerekend.`}
              aside={resultaat.haalbaar
                ? <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={() => { void downloadExcel(); }} disabled={downloadBezig}>{downloadBezig ? 'Bezig…' : 'Excel'}</Button>
                : <Badge tone="red">Onhaalbaar</Badge>}
            />
            {(resultaat.waarschuwingen.length > 0 || resultaat.opmerkingen.length > 0) && (
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                {[...resultaat.waarschuwingen, ...resultaat.opmerkingen].map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            {resultaat.infeasibiliteit && resultaat.infeasibiliteit.items.length > 0 && (
              <ul className="mt-3 space-y-2">
                {resultaat.infeasibiliteit.items.map((i, n) => (
                  <li key={n} className="rounded-lg bg-surface-muted p-3 text-sm">
                    <p className="font-semibold text-slate-900">{i.onderwerp}</p>
                    <p className="mt-0.5 text-slate-600">{i.omschrijving}</p>
                    {i.suggestie && <p className="mt-0.5 text-slate-500">{i.suggestie}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {resultaat.haalbaar && (
            <Card padding="none">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      <Th className="sticky left-0 z-10 bg-paper">Chauffeur</Th>
                      {weken.map((w) => <Th key={w.week} className="text-center"><span className="text-micro">week {w.week + 1}</span></Th>)}
                    </tr>
                    <tr>
                      <Th className="sticky left-0 z-10 bg-paper" />
                      {dagen.map((d) => (
                        <Th key={d.datum} className={d.weekend ? 'bg-surface-soft text-center' : 'text-center'} title={`${d.datum} · ${d.dagtype}`}>
                          <span className="block">{d.dag}</span>
                          <span className="text-micro">{d.datum.slice(8)}</span>
                        </Th>
                      ))}
                      <Th num>Uren</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultaat.rooster.map((r) => (
                      <tr key={r.chauffeur} className="border-t border-slate-100">
                        <Td className="sticky left-0 z-10 whitespace-nowrap bg-paper font-semibold text-slate-900">{r.naam}</Td>
                        {r.cellen.map((c) => (
                          <Td key={c.datum} className="text-center">
                            {c.dienst
                              ? <Chip tone={TYPE_TOON[c.type ?? 'D'] ?? 'slate'} title={c.type ?? undefined}>{c.dienst}</Chip>
                              : c.afwezig
                                ? <span className="text-micro">{AFWEZIG_LABEL[c.afwezig] ?? c.afwezig.toLowerCase()}</span>
                                : <span className="text-slate-300">—</span>}
                          </Td>
                        ))}
                        <Td num>{r.uren_tekst}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-slate-100 px-4 py-3 text-micro">
                Kleur = diensttype (vroeg, laat, gebroken, nacht, dag). Dit rooster staat los van de planning: het is een voorstel, niets is opgeslagen.
                <InfoTip label="Uitleg over overnemen">Overnemen in de planning volgt later; download nu de Excel en verwerk hem zoals een gewone matrix.</InfoTip>
              </p>
            </Card>
          )}
        </>
      )}

      {fase === 'idle' && (
        <Card tone="muted">
          <EmptyState title="Nog niets berekend" message="Kies een periode en klik op Rooster berekenen. De solver houdt rekening met rij- en rusttijden (EU 561, cao), contracturen en goedgekeurd verlof." />
        </Card>
      )}
    </PageShell>
  );
}
