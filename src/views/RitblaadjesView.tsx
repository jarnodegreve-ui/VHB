import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Search, Trash2, Upload } from 'lucide-react';
import { isStaf, type User } from '../types';
import { notify } from '../lib/ui';
import { openRitblad } from '../lib/ritblad';
import { formatDatumDMJ, prettySize, serviceNumberOf } from '../lib/format';
import { isoDate } from '../lib/datum';
import { useOptioneleAppData } from '../app/AppDataContext';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../components/ui';
import { apiFetch } from '../lib/api';
import { leesAlsDataUrl } from '../lib/dataUrl';
import { Badge, Button, Switch } from '../components/primitives';
import { Card, CardHeader } from '../components/Card';
import { ToonMeer, useToonMeer } from '../components/ToonMeer';
import { Field, Input } from '../components/Field';
import { RitbladViewer } from '../components/RitbladViewer';
import { Skeleton } from '../components/Skeleton';
import { meldSchrijffout } from '../lib/fouten';
import { MededelingStrook } from '../components/MededelingStrook';
import { lazyWithRetry } from '../lib/lazyRetry';
import { cacheVeiligeRitbladen, datumVoorVersie, haalRitbladen, kaartKop, volgordeVoorScherm, vorigeVoor, type RitbladRegel, type Ritbladen } from '../lib/ritbladen';

// Alleen voor de admin, lui: het beheerblok brengt het zod-schema mee en
// hoort niet in wat elke chauffeur voor Ritbladen binnenhaalt.
const LazyMededelingBeheer = lazyWithRetry(() => import('../components/MededelingBeheer'));

const MAX_PDF_MB = 20;

/**
 * Ritbladen per dienstregelingversie (13-10, keuzes Jarno). Eén kaart per
 * versie: de huidige bovenaan, dan "Vanaf dd/mm" (toekomstig, vooraf te
 * bekijken) en "Tot en met dd/mm" (de vorige, zolang haar versie bestaat).
 * Een versie zonder eigen bundel zegt dat, met een knop naar de vorige
 * ritbladen. Een admin laadt per versie op; "Chauffeurs verwittigen" stuurt
 * de push mee of niet.
 *
 * Offline-kopie van de lijst in localStorage, zonder de tokens van de
 * signed URL's (die verlenen toegang buiten de login en de toestel-whitelist
 * om, en bleven zo op een gedeelde depot-tablet achter): alleen het
 * query-loze pad, precies de sleutel waaronder de service worker de PDF
 * bewaart, zodat Openen offline blijft werken.
 */
const LIJST_CACHE_KEY = 'vhb-ritbladen-lijst';
const SYNCED_AT_KEY = 'vhb-ritbladen-synced';
// De sleutels van vóór 13-10 (één bundel): opruimen bij de eerste lading.
const OUDE_SLEUTELS = ['vhb-ritblaadje-meta', 'vhb-ritblaadje-synced'];

const formatSyncedAt = (iso: string | null) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
};

/** "2101 / 2304", "2101, 2304" of "2101 2304" → ['2101', '2304']; alleen
 *  cijfers en letters blijven over, zodat een typfout geen lege zoekterm wordt. */
export const parseDienstnummers = (invoer: string): string[] =>
  [...new Set(invoer.split(/[\s,;/]+/).map((n) => n.trim()).filter(Boolean))];

const formatUploadedAt = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

const regelSleutel = (regel: RitbladRegel): string => regel.versie?.id ?? 'huidig';

export function RitblaadjesView({ currentUser }: { currentUser: User }) {
  const [lijst, setLijst] = useState<Ritbladen | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /** De versie waarvoor een upload loopt (regelSleutel), null = geen. */
  const [uploadBezig, setUploadBezig] = useState<string | null>(null);
  const [teVerwijderen, setTeVerwijderen] = useState<RitbladRegel | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  // Keuze Jarno 13-10: de push bij een upload staat aan, maar is uit te zetten.
  const [melden, setMelden] = useState(true);
  // Op een touch-toestel (iPhone) rendert WKWebView een PDF in een <iframe>
  // als één niet-scrolbare eerste pagina — een chauffeur zag van een
  // meerpaginas ritblad dus stilzwijgend maar de helft. Daar tonen we een
  // open-kaart i.p.v. de iframe.
  const [touchToestel] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Voor welke versie het bestandsveld geopend is (id, null = zonder versies). */
  const uploadDoel = useRef<string | null>(null);

  // Ritblad per dienst (punt 15): het veld staat standaard op de dienst(en)
  // van vandaag van de ingelogde gebruiker; de viewer zoekt in de bundel de
  // pagina's van dat nummer (zelfde RitbladViewer als Mijn dag).
  const appData = useOptioneleAppData();
  const vandaag = isoDate(new Date());
  const dienstVandaag = useMemo(() => {
    const nummers = (appData?.shifts ?? [])
      .filter((s) => s.driverId === currentUser.id && s.date === vandaag)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((s) => serviceNumberOf(s))
      .filter((n) => n !== '--');
    return [...new Set(nummers)].join(' / ');
  }, [appData?.shifts, currentUser.id, vandaag]);
  const [dienstInvoer, setDienstInvoer] = useState(dienstVandaag);
  const invoerAangeraakt = useRef(false);
  // De planning komt vaak pas ná de eerste render binnen: vul het veld dan
  // alsnog, zolang de gebruiker er zelf nog niets in typte.
  useEffect(() => {
    if (!invoerAangeraakt.current) setDienstInvoer(dienstVandaag);
  }, [dienstVandaag]);
  const dienstnummers = parseDienstnummers(dienstInvoer);
  const [viewerNummers, setViewerNummers] = useState<string[] | null>(null);
  const openDienstRitblad = () => { if (dienstnummers.length > 0) setViewerNummers(dienstnummers); };

  const canEdit = currentUser.role === 'admin';
  const canDelete = currentUser.role === 'admin';
  // Bestandsnaam, uploadmoment, uploader en grootte zijn beheerinfo: voor een
  // chauffeur is alleen de knop Openen van belang (puntje Jarno 21-09).
  const toonBestandsinfo = isStaf(currentUser.role);

  // Unmount-guard: fetchLijst kan nog lopen terwijl de gebruiker al
  // weggenavigeerd is — geen setState/fouttoast meer op een andere pagina.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchLijst = async () => {
    setIsLoading(true);
    try {
      const data = await haalRitbladen();
      if (!mountedRef.current) return;
      setLijst(data);
      setFromCache(false);
      try {
        const now = new Date().toISOString();
        setSyncedAt(now);
        localStorage.setItem(SYNCED_AT_KEY, now);
        localStorage.setItem(LIJST_CACHE_KEY, JSON.stringify(cacheVeiligeRitbladen(data)));
        for (const sleutel of OUDE_SLEUTELS) localStorage.removeItem(sleutel);
      } catch {
        // localStorage geblokkeerd — geen fallback, geen ramp
      }
    } catch (error: any) {
      if (!mountedRef.current) return;
      // Offline / server onbereikbaar → val terug op de bewaarde lijst.
      let recovered = false;
      try {
        const cached = localStorage.getItem(LIJST_CACHE_KEY);
        if (cached) {
          setLijst(JSON.parse(cached));
          setSyncedAt(localStorage.getItem(SYNCED_AT_KEY));
          setFromCache(true);
          recovered = true;
        }
      } catch {
        // ongeldige cache — negeer
      }
      if (!recovered) {
        meldSchrijffout('Ritbladen laden', error, () => void fetchLijst());
        setLijst(null);
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchLijst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Het bestandsveld staat één keer buiten de kaarten: elke Upload- of
  // Vervangen-knop opent hetzelfde veld, met de versie in uploadDoel.
  const kiesBestand = (regel: RitbladRegel) => {
    uploadDoel.current = regel.versie?.id ?? null;
    fileInputRef.current?.click();
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      notify('Alleen PDF-bestanden toegestaan.', 'error');
      return;
    }
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      notify(`Bestand is te groot (max ${MAX_PDF_MB} MB).`, 'error');
      return;
    }

    const versieId = uploadDoel.current;
    setUploadBezig(versieId ?? 'huidig');
    try {
      const dataUrl = await leesAlsDataUrl(file);
      const response = await apiFetch(versieId ? `/api/ritblaadje?versie=${encodeURIComponent(versieId)}` : '/api/ritblaadje', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, dataUrl, melden }),
      });
      const text = await response.text();
      if (!response.ok) {
        let detail = '';
        try { detail = JSON.parse(text).error || ''; } catch { /* geen JSON: de status volstaat */ }
        throw Object.assign(new Error(detail), { status: response.status });
      }
      const updated = JSON.parse(text);
      notify(
        updated?.versie?.status === 'toekomstig'
          ? `Ritbladen vanaf ${formatDatumDMJ(updated.versie.geldigVanaf)} staan klaar.`
          : 'Ritbladen bijgewerkt.',
        'success',
      );
      await fetchLijst();
    } catch (error) {
      meldSchrijffout('Uploaden', error);
    } finally {
      if (mountedRef.current) setUploadBezig(null);
    }
  };

  const handleDelete = async () => {
    const regel = teVerwijderen;
    if (!regel) return;
    try {
      const response = await apiFetch(regel.versie ? `/api/ritblaadje?versie=${encodeURIComponent(regel.versie.id)}` : '/api/ritblaadje', { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({} as { error?: string }));
        throw Object.assign(new Error(data?.error || ''), { status: response.status });
      }
      notify('Ritbladen verwijderd.', 'success');
      await fetchLijst();
    } catch (error) {
      meldSchrijffout('Verwijderen', error, () => void handleDelete());
    }
  };

  const regels = useMemo(() => (lijst ? volgordeVoorScherm(lijst.bundels) : []), [lijst]);
  // Elke dienstregeling laat een kaart "Tot en met" achter zolang haar versie
  // bestaat. De jongste vorige staat er, de oudere komen vijf tegelijk achter
  // "Toon oudere" (Jarno 15-10: geen lijst die eindeloos aangroeit).
  const actueleRegels = useMemo(() => regels.filter((r) => r.versie?.status !== 'verlopen'), [regels]);
  const verlopenRegels = useMemo(() => regels.filter((r) => r.versie?.status === 'verlopen'), [regels]);
  const vorigeKaarten = useToonMeer(verlopenRegels, { begin: 1, stap: 5 });
  const heeftBundel = regels.some((r) => r.bundel);
  // Zoeken per dienst kan zodra er voor vandaag een bundel is, of de vorige.
  const kanZoeken = Boolean(lijst && (lijst.bundel || lijst.vorige));
  const eersteRegel: RitbladRegel = regels[0] ?? { versie: null, bundel: null };

  return (
    <PageShell>
      {canEdit && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleFile}
          disabled={uploadBezig !== null}
          aria-label="PDF kiezen"
        />
      )}
      <PageHeader
        title="Ritbladen"
        description="De ritbladen per dienstregeling."
        actions={canEdit && !isLoading && !heeftBundel ? (
          <Button variant="primary" icon={<Upload size={16} />} disabled={uploadBezig !== null} onClick={() => kiesBestand(eersteRegel)}>
            {uploadBezig ? 'Uploaden…' : 'Upload PDF'}
          </Button>
        ) : undefined}
      />

      <MededelingStrook />

      {isLoading ? (
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton rounded="xl" className="w-10 h-10 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-2.5 w-1/4" />
            </div>
          </div>
          <Skeleton rounded="2xl" className="w-full h-[320px]" />
        </Card>
      ) : regels.length === 0 ? (
        <EmptyState
          title="Nog geen ritblad beschikbaar"
          message={canEdit ? 'Upload een PDF via de knop bovenaan om te delen met alle chauffeurs.' : 'Zodra er een nieuw ritblad is, verschijnt het hier.'}
        />
      ) : (
        <div className="space-y-5">
          {/* Jouw dienst eerst: één veld, één knop; de viewer haalt de juiste
              pagina's uit de bundel van vandaag (of de vorige, met de melding). */}
          {kanZoeken && (
            <Card as="section" padding="sm" aria-label="Ritblad per dienst">
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(e) => { e.preventDefault(); openDienstRitblad(); }}
              >
                <Field label="Dienstnummer" className="flex-1">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={dienstInvoer}
                      inputMode="numeric"
                      autoComplete="off"
                      enterKeyHint="go"
                      placeholder="bv. 2101"
                      className="font-mono"
                      onChange={(e) => { invoerAangeraakt.current = true; setDienstInvoer(e.target.value); }}
                    />
                  )}
                </Field>
                <Button type="submit" variant="primary" icon={<Search size={16} />} disabled={dienstnummers.length === 0}>
                  Ritblad openen
                </Button>
              </form>
              <p className="mt-2 text-xs text-slate-500">
                {dienstVandaag && dienstInvoer === dienstVandaag
                  ? 'Je dienst van vandaag staat al ingevuld. Meerdere nummers scheid je met een schuine streep.'
                  : 'Bijvoorbeeld 2101. Meerdere nummers scheid je met een schuine streep.'}
              </p>
              {viewerNummers && (
                <RitbladViewer dienstnummer={viewerNummers} open onClose={() => setViewerNummers(null)} />
              )}
            </Card>
          )}

          {canEdit && (
            <Card tone="muted" padding="row" className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-label">Chauffeurs verwittigen</p>
                <p className="text-body-sm text-slate-500">Bij een upload krijgen de actieve chauffeurs een melding; bij een toekomstige dienstregeling met de datum erbij.</p>
              </div>
              <Switch checked={melden} onChange={setMelden} label="Chauffeurs verwittigen" />
            </Card>
          )}

          {[...actueleRegels, ...vorigeKaarten.zichtbaar].map((regel, index) => {
            const kop = kaartKop(regel.versie);
            const sleutel = regelSleutel(regel);
            const datum = datumVoorVersie(regel.versie, vandaag);
            const vorige = regel.bundel ? null : vorigeVoor(regels, regel.versie);
            const toontPreview = Boolean(regel.bundel?.url) && regel.versie?.status !== 'toekomstig' && regel.versie?.status !== 'verlopen';
            return (
              <Card key={sleutel} as="section" aria-label={kop.titel}>
                <CardHeader
                  size="lg"
                  title={kop.titel}
                  description={kop.toelichting ?? undefined}
                  aside={(kop.badge || (index === 0 && fromCache)) ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {kop.badge && <Badge tone={kop.badge.toon}>{kop.badge.tekst}</Badge>}
                      {index === 0 && fromCache && <Badge tone="amber" dot>Offline</Badge>}
                    </div>
                  ) : undefined}
                />
                {regel.bundel ? (
                  <>
                    {toonBestandsinfo && (
                      <p className="mt-2 text-body-sm text-slate-500">
                        <span title={regel.bundel.filename}>{regel.bundel.filename}</span>
                        {' · '}{formatUploadedAt(regel.bundel.uploadedAt)}
                        {regel.bundel.uploadedBy ? ` · door ${regel.bundel.uploadedBy}` : ''}
                        {regel.bundel.sizeBytes ? ` · ${prettySize(regel.bundel.sizeBytes)}` : ''}
                      </p>
                    )}
                    {index === 0 && formatSyncedAt(syncedAt) ? (
                      <p className="mt-1 text-body-sm text-slate-500">Laatst bijgewerkt {formatSyncedAt(syncedAt)}</p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {/* Bij elke klik opnieuw de actuele link ophalen; de pagina kan
                          al langer openstaan dan de geldigheid van de signed URL. */}
                      <Button variant="secondary" size="sm" disabled={!regel.bundel.url} onClick={() => void openRitblad(datum)} icon={<Download size={14} />}>
                        Openen
                      </Button>
                      {canEdit && (
                        <Button variant="secondary" size="sm" disabled={uploadBezig !== null} onClick={() => kiesBestand(regel)} icon={<Upload size={14} />}>
                          {uploadBezig === sleutel ? 'Uploaden…' : 'Vervangen'}
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setTeVerwijderen(regel)} aria-label={`Verwijder ${kop.titel.toLowerCase()}`}>
                          Verwijderen
                        </Button>
                      )}
                    </div>
                    {toontPreview && regel.bundel.url && (
                      <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-hairline">
                        {touchToestel ? (
                          /* Haalt bij de klik een verse link op en opent de volledige
                             PDF; de iframe-preview toont op iOS alleen pagina 1. */
                          /* rauw: grote open-kaart met eigen layout (icoontegel + titel + uitleg) */
                          <button
                            type="button"
                            onClick={() => void openRitblad(datum)}
                            className="ios-pressable flex w-full flex-col items-center justify-center gap-3 px-8 py-14 text-center"
                          >
                            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-slate-700">
                              <FileText size={20} />
                            </span>
                            <span className="text-base font-semibold text-slate-800">Volledige bundel</span>
                            <span className="max-w-sm text-body-sm font-normal text-slate-500">
                              Opent het volledige document, alle pagina's, met knijp-zoom.
                            </span>
                          </button>
                        ) : (
                          <iframe
                            src={regel.bundel.url}
                            title="Ritblad-voorbeeld"
                            className="w-full h-[70vh] min-h-[480px] bg-surface-white"
                          />
                        )}
                      </div>
                    )}
                    {toontPreview && !regel.bundel.url && (
                      /* Oude offline-kopie zonder pad — dan liever een eerlijke
                         melding dan een leeg wit vlak. */
                      <p className="mt-4 text-body-sm text-slate-500">Het ritblad is offline nog niet beschikbaar op dit toestel. Open het één keer met internet, daarna werkt het ook offline.</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-body-sm text-slate-500">
                      Nog geen ritbladen voor deze dienstregeling.{vorige ? ' Tot ze er zijn, kan je de vorige ritbladen bekijken.' : ''}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {vorige && (
                        <Button variant="secondary" size="sm" onClick={() => void openRitblad(datumVoorVersie(vorige.versie, vandaag))} icon={<FileText size={14} />}>
                          Vorige ritbladen openen
                        </Button>
                      )}
                      {canEdit && (
                        <Button variant={vorige ? 'secondary' : 'primary'} size="sm" disabled={uploadBezig !== null} onClick={() => kiesBestand(regel)} icon={<Upload size={14} />}>
                          {uploadBezig === sleutel ? 'Uploaden…' : 'Upload PDF'}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </Card>
            );
          })}
          <ToonMeer los woord="oudere" getoond={vorigeKaarten.getoond} totaal={vorigeKaarten.totaal} volgende={vorigeKaarten.volgende} onMeer={vorigeKaarten.meer} />

          {!touchToestel && heeftBundel && (
            <p className="text-xs font-medium text-slate-500 text-center">
              Werkt de preview niet op je toestel? Gebruik de <span className="text-slate-600 font-semibold">Openen</span>-knop om het bestand lokaal te openen.
            </p>
          )}
        </div>
      )}

      <ConfirmationModal
        open={teVerwijderen !== null}
        onClose={() => setTeVerwijderen(null)}
        onConfirm={handleDelete}
        title="Ritbladen verwijderen"
        message={`Weet je zeker dat je ${teVerwijderen ? kaartKop(teVerwijderen.versie).titel.toLowerCase() : 'deze ritbladen'} wilt verwijderen? Chauffeurs zien daarna geen bestand meer voor die dienstregeling tot een nieuwe PDF is geüpload.`}
      />
      {canEdit && (
        <Suspense fallback={null}>
          <LazyMededelingBeheer />
        </Suspense>
      )}
    </PageShell>
  );
}
