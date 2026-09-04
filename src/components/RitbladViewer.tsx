import { useEffect, useRef, useState } from 'react';
import { FileText, X, ZoomIn, ZoomOut } from 'lucide-react';
// Alleen typen — de echte pdfjs-code komt lazy binnen via ritbladPaginas.ts.
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Modal } from './Modal';
import { Button, IconButton } from './primitives';
import { BrandSpinner } from './BrandSpinner';
import { EmptyState } from './ui';
import { apiFetch } from '../lib/api';
import { openPdfInNewTab } from '../lib/ui';
import { openHuidigRitblad } from '../lib/ritblad';
import { laadRitbladDocument, zoekPaginasVoorDienstGecached } from '../lib/ritbladPaginas';

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

type Meta = { url?: string; filename?: string; uploadedAt?: string };

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

/** Eén pagina van de bundel op een canvas, op devicePixelRatio. */
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
      // Begrensd op 3: een 3×-scherm op zoom 3 zou anders een canvas van
      // ±16 miljoen pixels vragen, en iOS weigert dat stil (wit vlak).
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollBreedte, setScrollBreedte] = useState(0);

  // Bundel ophalen (via de service-worker-cache, dus ook offline) → pdfjs →
  // pagina's zoeken (gecached per bundel). Sluiten of een ander nummer
  // breekt een lopende zoektocht netjes af.
  useEffect(() => {
    if (!open) return;
    let actief = true;
    let doc: PDFDocumentProxy | null = null;
    setStaat({ soort: 'laden' });
    setZoomIdx(0);
    (async () => {
      const res = await apiFetch('/api/ritblaadje');
      if (!res.ok) throw new Error(`Server antwoordde ${res.status}`);
      const meta = (await res.json()) as Meta | null;
      if (!actief) return;
      if (!meta?.url) {
        setStaat({ soort: 'geen-bundel' });
        return;
      }
      doc = await laadRitbladDocument(meta.url);
      if (!actief) return;
      // Cache-sleutel: het uploadtijdstip; zonder dat (oude metadata) het
      // query-loze pad, dat óók pas bij een nieuwe upload wijzigt.
      const versie = meta.uploadedAt || new URL(meta.url).pathname;
      const gevonden = new Set<number>();
      for (const n of nummers) {
        for (const p of await zoekPaginasVoorDienstGecached(doc, n, versie)) gevonden.add(p);
      }
      if (!actief) return;
      const paginas = [...gevonden].sort((a, b) => a - b);
      const basis = { url: meta.url, totaal: doc.numPages, bundelDatum: formatBundelDatum(meta.uploadedAt) };
      setStaat(paginas.length ? { soort: 'klaar', doc, paginas, ...basis } : { soort: 'niets', ...basis });
    })().catch((err: unknown) => {
      console.warn('Ritblad laden mislukte:', err);
      if (actief) setStaat({ soort: 'fout' });
    });
    return () => {
      actief = false;
      // Ook een document dat nog onderweg was: de promise-keten hierboven
      // stopt bij `!actief`, maar het worker-geheugen moet vrij.
      doc?.loadingTask.destroy().catch(() => undefined);
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

  const subregel = (() => {
    switch (staat.soort) {
      case 'laden': return 'Ritblad zoeken…';
      case 'klaar': return `${somPaginas(staat.paginas)} van ${staat.totaal}${staat.bundelDatum ? ` · bundel van ${staat.bundelDatum}` : ''}`;
      case 'niets': return `${staat.totaal} pagina's${staat.bundelDatum ? ` · bundel van ${staat.bundelDatum}` : ''}`;
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
