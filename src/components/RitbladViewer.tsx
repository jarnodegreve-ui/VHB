import { useEffect, useRef, useState } from 'react';
import { FileText, X, ZoomIn, ZoomOut } from 'lucide-react';
// Alleen typen — de echte pdfjs-code komt lazy binnen via ritbladPaginas.ts.
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Modal } from './Modal';
import { Button, IconButton } from './primitives';
import { BrandSpinner } from './BrandSpinner';
import { EmptyState } from './ui';
import { openPdfInNewTab } from '../lib/ui';
import { openHuidigRitblad } from '../lib/ritblad';
import { isRitbladOpgeslagen } from '../lib/ritbladCache';
import { useOnline } from '../lib/useOnline';
import { haalRitbladMeta, laadRitbladDocument, zoekPaginasVoorDienstGecached } from '../lib/ritbladPaginas';

/**
 * In-app ritbladviewer per dienst: toont uit de gedeelde ritblad-bundel
 * alleen de pagina('s) van het dienstnummer van de chauffeur, gerenderd
 * naar canvas (scherp op retina), verticaal onder elkaar, met zoom.
 *
 * Gecontroleerd component — koppelen vanuit Mijn dag:
 *   const [ritbladOpen, setRitbladOpen] = useState(false);
 *   <RitbladViewer dienstnummer={dienstnummers} open={ritbladOpen} onClose={() => setRitbladOpen(false)} />
 *
 * Vindt de viewer geen apart blad (scan zonder tekstlaag, ander nummer-
 * formaat), dan blijft de volledige bundel één tik weg — dat is de
 * bestaande openHuidigRitblad()/openPdfInNewTab-route, ongewijzigd.
 */

type Staat =
  | { soort: 'laden' }
  | { soort: 'geen-bundel' }
  | { soort: 'fout' }
  | { soort: 'niets'; url: string; totaal: number; bundelDatum: string }
  | { soort: 'klaar'; doc: PDFDocumentProxy; paginas: number[]; url: string; totaal: number; bundelDatum: string };

const ZOOM_STAPPEN = [1, 1.5, 2, 3];
const RAND = 12; // px rondom de pagina's in de scroller (p-3)

const formatBundelDatum = (iso: string | undefined): string => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }).replace(/\.$/, '');
  } catch {
    return '';
  }
};

/** "pagina 12" · "pagina's 12–13" · "pagina's 12, 15". */
export const somPaginas = (paginas: number[]): string => {
  if (paginas.length === 1) return `pagina ${paginas[0]}`;
  const aaneengesloten = paginas.every((p, i) => i === 0 || p === paginas[i - 1] + 1);
  if (aaneengesloten) return `pagina's ${paginas[0]}–${paginas[paginas.length - 1]}`;
  return `pagina's ${paginas.join(', ')}`;
};

const nummerLijst = (dienstnummer: string | string[]): string[] =>
  (Array.isArray(dienstnummer) ? dienstnummer : [dienstnummer]).map((n) => n.trim()).filter(Boolean);

/**
 * Pixelbudget per pagina-canvas (controle 05-09, nr. 35). Rekensom: een
 * A4-blad op een iPhone (scherm 390 px, dpr 3) is op zoom 1 ±366 × 518 css-
 * px → ×3 = 1,7 Mpx (7 MB RGBA); op zoom 3 ±1098 × 1553 css-px → ×3 = 15,3
 * Mpx ≈ 61 MB per pagina. Oudere iPhones tonen boven ±16,7 Mpx (of bij te
 * veel canvas-geheugen in totaal, 2–3 bladen) stil een wit vlak. Daarom
 * geen vaste dpr-cap maar een budget van 6 Mpx (24 MB) per pagina: de dpr
 * zakt vanzelf zodra breedte × hoogte × dpr² daarboven komt — op zoom 1 en
 * 1,5 blijft alles scherp (dpr 3), op zoom 2 wordt het ±2,8, op zoom 3
 * ±1,9; de effectieve resolutie (zoom × dpr) blijft daarmee altijd ≥ die
 * van zoom 1 op dpr 3. Desktop (paneel ±640 px, dpr 2): zoom 1 en 1,5 op
 * dpr 2, zoom 2 ±1,6, zoom 3 ±1,1 — op die grootte is dat nog altijd
 * scherper dan het blad op zoom 1.
 */
const MAX_CANVAS_PIXELS = 6_000_000;
const canvasDpr = (cssBreedte: number, cssHoogte: number): number => {
  const scherm = Math.min(window.devicePixelRatio || 1, 3);
  const budget = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssBreedte * cssHoogte));
  // Nooit onder 1 (dan wordt het blad waziger dan het scherm zelf) — een
  // pagina die zelfs op dpr 1 boven budget zit bestaat bij deze zoomstappen niet.
  return Math.max(1, Math.min(scherm, budget));
};

/** Eén pagina van de bundel op een canvas, op de (begrensde) devicePixelRatio. */
function PaginaCanvas({ doc, nummer, breedte }: { doc: PDFDocumentProxy; nummer: number; breedte: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (breedte <= 0) return;
    let actief = true;
    let taak: RenderTask | null = null;
    (async () => {
      const pagina = await doc.getPage(nummer);
      const canvas = ref.current;
      if (!actief || !canvas) return;
      const basis = pagina.getViewport({ scale: 1 });
      const viewport = pagina.getViewport({ scale: breedte / basis.width });
      const dpr = canvasDpr(viewport.width, viewport.height);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      taak = pagina.render({
        canvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      await taak.promise;
    })().catch((err: unknown) => {
      // Annuleren (zoomstap terwijl er nog gerenderd wordt) is geen fout.
      if ((err as { name?: string })?.name !== 'RenderingCancelledException') console.warn('Ritblad-pagina renderen mislukte:', err);
    });
    return () => {
      actief = false;
      taak?.cancel();
    };
  }, [doc, nummer, breedte]);

  // Wit blijft wit, ook in dark mode — het is een document, geen UI-vlak.
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`Pagina ${nummer} van de ritblad-bundel`}
      className="block shrink-0 bg-white shadow-sm ring-1 ring-ink/10"
    />
  );
}

export function RitbladViewer({
  dienstnummer,
  open,
  onClose,
}: {
  /** Eén dienstnummer, of meerdere bij een gesplitste dag (alle bladen onder elkaar). */
  dienstnummer: string | string[];
  open: boolean;
  onClose: () => void;
}) {
  const nummers = nummerLijst(dienstnummer);
  const nummerSleutel = nummers.join('/');
  const [staat, setStaat] = useState<Staat>({ soort: 'laden' });
  const [zoomIdx, setZoomIdx] = useState(0);
  // Offline én de bundel staat in de ritbladen-cache → "Opgeslagen exemplaar"
  // in de subregel (stil; geen banner). Online komt het blad óók uit de cache
  // (cache-first met revalidate), maar dan is dat geen boodschap.
  const online = useOnline();
  const [opgeslagen, setOpgeslagen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollBreedte, setScrollBreedte] = useState(0);

  // Metadata vers ophalen → bundel (via de service-worker-cache, dus ook
  // offline) → pdfjs → pagina's zoeken (gecached per bundel). Sluiten of een
  // ander nummer breekt af via het AbortSignal: de zoeklus stopt, en een
  // document dat pas ná het sluiten binnenkomt wordt meteen vernietigd —
  // anders bleef het in de pdfjs-worker hangen (cleanup zag nog `doc === null`).
  useEffect(() => {
    if (!open) return;
    const afbreker = new AbortController();
    const { signal } = afbreker;
    let doc: PDFDocumentProxy | null = null;
    const ruimOp = () => { doc?.loadingTask.destroy().catch(() => undefined); doc = null; };
    setStaat({ soort: 'laden' });
    setZoomIdx(0);
    (async () => {
      const meta = await haalRitbladMeta();
      if (signal.aborted) return;
      if (!meta?.url) {
        setStaat({ soort: 'geen-bundel' });
        return;
      }
      // Verlopen signed URL (storage-fout) → één keer verse metadata en opnieuw.
      const geladen = await laadRitbladDocument(meta.url, async () => (await haalRitbladMeta())?.url ?? null);
      if (signal.aborted) {
        geladen.loadingTask.destroy().catch(() => undefined);
        return;
      }
      doc = geladen;
      // Cache-sleutel: het uploadtijdstip; zonder dat (oude metadata) het
      // query-loze pad, dat óók pas bij een nieuwe upload wijzigt.
      const versie = meta.uploadedAt || new URL(meta.url).pathname;
      void isRitbladOpgeslagen(meta.url).then((ja) => { if (!signal.aborted) setOpgeslagen(ja); });
      const gevonden = new Set<number>();
      for (const n of nummers) {
        for (const p of await zoekPaginasVoorDienstGecached(doc, n, versie, signal)) gevonden.add(p);
      }
      if (signal.aborted) return;
      const paginas = [...gevonden].sort((a, b) => a - b);
      const basis = { url: meta.url, totaal: doc.numPages, bundelDatum: formatBundelDatum(meta.uploadedAt) };
      setStaat(paginas.length ? { soort: 'klaar', doc, paginas, ...basis } : { soort: 'niets', ...basis });
    })().catch((err: unknown) => {
      if (signal.aborted) return; // sluiten is geen fout
      console.warn('Ritblad laden mislukte:', err);
      setStaat({ soort: 'fout' });
    });
    return () => {
      afbreker.abort();
      ruimOp();
    };
    // nummerSleutel vat `nummers` samen; een nieuwe array met dezelfde
    // nummers mag niet opnieuw laden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nummerSleutel]);

  // Breedte van de scroller: de pagina's passen op zoom 1 precies in beeld,
  // vanaf 1,5× scrolt het horizontaal.
  useEffect(() => {
    if (staat.soort !== 'klaar') return;
    const el = scrollRef.current;
    if (!el) return;
    const meet = () => setScrollBreedte(el.clientWidth);
    meet();
    const ro = new ResizeObserver(meet);
    ro.observe(el);
    return () => ro.disconnect();
  }, [staat.soort]);

  const zoom = ZOOM_STAPPEN[zoomIdx];
  const paginaBreedte = Math.max(0, Math.floor((scrollBreedte - RAND * 2) * zoom));
  const titel = nummers.length > 1 ? `Ritblad · diensten ${nummers.join(' / ')}` : `Ritblad · dienst ${nummers[0] ?? '--'}`;
  const nummerTekst = nummers.length > 1 ? `diensten ${nummers.join(' / ')}` : `dienst ${nummers[0] ?? '--'}`;

  const opgeslagenLabel = !online && opgeslagen ? ' · opgeslagen exemplaar' : '';
  const subregel = (() => {
    switch (staat.soort) {
      case 'laden': return 'Ritblad zoeken…';
      case 'klaar': return `${somPaginas(staat.paginas)} van ${staat.totaal}${staat.bundelDatum ? ` · bundel van ${staat.bundelDatum}` : ''}${opgeslagenLabel}`;
      case 'niets': return `${staat.totaal} pagina's${staat.bundelDatum ? ` · bundel van ${staat.bundelDatum}` : ''}${opgeslagenLabel}`;
      default: return null;
    }
  })();

  return (
    <Modal open={open} onClose={onClose} maxWidth="2xl" ariaLabel={titel} className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-start gap-3 border-b border-slate-200/80 px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-card-title">{titel}</h2>
          {subregel && <p className="mt-0.5 truncate text-xs font-medium tabular-nums text-slate-500">{subregel}</p>}
        </div>
        <IconButton label="Sluiten" onClick={onClose} className="-mr-2 -mt-1.5">
          <X size={18} />
        </IconButton>
      </header>

      {staat.soort === 'laden' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" role="status">
          <BrandSpinner size={24} />
          <p className="text-sm font-medium text-slate-600">Ritblad zoeken…</p>
          <p className="text-xs font-normal text-slate-500">De bundel wordt doorzocht op {nummerTekst}.</p>
        </div>
      )}

      {staat.soort === 'geen-bundel' && (
        <div className="flex flex-1 items-center p-4">
          <div className="w-full">
            <EmptyState title="Nog geen ritblad beschikbaar" message="Zodra er een nieuw ritblad is, verschijnt het hier." />
          </div>
        </div>
      )}

      {staat.soort === 'fout' && (
        <div className="flex flex-1 items-center p-4">
          <div className="w-full">
            <EmptyState
              variant="fout"
              title="Ritblad kon niet geladen worden"
              message="Controleer je verbinding, of open de volledige bundel zoals voorheen."
              action={<Button variant="primary" icon={<FileText size={16} />} onClick={() => openHuidigRitblad()}>Volledige bundel openen</Button>}
            />
          </div>
        </div>
      )}

      {staat.soort === 'niets' && (
        <div className="flex flex-1 items-center p-4">
          <div className="w-full">
            <EmptyState
              title={`Geen apart blad gevonden voor ${nummerTekst}`}
              message="De bundel bevat geen pagina waarop dit dienstnummer herkenbaar staat — of het bestand is een scan zonder tekst. De volledige bundel werkt wel."
              action={<Button variant="primary" icon={<FileText size={16} />} onClick={() => openPdfInNewTab(staat.url)}>Volledige bundel openen</Button>}
            />
          </div>
        </div>
      )}

      {staat.soort === 'klaar' && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain bg-surface-muted">
            <div className="flex w-max min-w-full flex-col items-center gap-3 p-3">
              {paginaBreedte > 0 && staat.paginas.map((n) => (
                <PaginaCanvas key={n} doc={staat.doc} nummer={n} breedte={paginaBreedte} />
              ))}
            </div>
          </div>
          <footer className="flex shrink-0 items-center gap-1.5 border-t border-slate-200/80 px-3 py-2">
            <IconButton label="Uitzoomen" variant="secondary" size="sm" disabled={zoomIdx === 0} onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}>
              <ZoomOut size={16} />
            </IconButton>
            <span className="w-12 text-center text-xs font-semibold tabular-nums text-slate-600" aria-live="polite">{Math.round(zoom * 100)} %</span>
            <IconButton label="Inzoomen" variant="secondary" size="sm" disabled={zoomIdx === ZOOM_STAPPEN.length - 1} onClick={() => setZoomIdx((i) => Math.min(ZOOM_STAPPEN.length - 1, i + 1))}>
              <ZoomIn size={16} />
            </IconButton>
            <div className="flex-1" />
            <Button variant="secondary" size="sm" icon={<FileText size={14} />} onClick={() => openPdfInNewTab(staat.url)}>
              Volledige bundel
            </Button>
          </footer>
        </>
      )}
    </Modal>
  );
}
