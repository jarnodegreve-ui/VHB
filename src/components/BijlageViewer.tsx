import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, RotateCw } from 'lucide-react';
// Alleen typen — de echte pdfjs-code komt lazy binnen via ritbladPaginas.ts.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfBijlage } from '../types';
import { PdfBladen, PdfLaag, laadPdfjs } from './RitbladViewer';
import { Button, IconButton } from './primitives';
import { BrandSpinner } from './BrandSpinner';
import { EmptyState } from './ui';
import { Fout, GeenBereik, NietGevonden } from './illustraties';
import { vergeetBijlage, type BijlageSoort } from '../lib/bijlageCache';
import { BijlageWeg, bronVanBijlage, haalVerseBijlage, laadBijlage, linkVerlopen } from '../lib/bijlageLaden';
import { aantal } from '../lib/format';
import { openPdfInNewTab } from '../lib/ui';
import { useOnline } from '../lib/useOnline';

/**
 * Een PDF-bijlage van een omleiding of update, in de app (controle-ronde
 * 29-09, nr. 2). Vroeger opende elke bijlage met window.open naar de
 * ondertekende storage-URL: in een geïnstalleerde PWA valt dat buiten de
 * schil en buiten de service worker (los venster op iPhone, download of
 * Custom Tab op Android), zonder bereik een foutpagina, en na een nacht een
 * verlopen link met een rauwe fout.
 *
 * Dezelfde laag als het ritblad (PdfLaag en PdfBladen uit RitbladViewer): de
 * terugknop, de terugveeg en Escape sluiten alleen de viewer, het detail
 * eronder blijft open. In de kop staat een terugknop in plaats van een
 * kruisje: sluiten betekent hier "terug naar het detail". De bytes
 * komen van het toestel als de bijlage al eens geopend is, anders van de
 * server (met een verse link als de oude verlopen is) en daarna in de cache:
 * zie src/lib/bijlageLaden.ts en src/lib/bijlageCache.ts.
 *
 * "Extern openen" is de oude weg en blijft één tik weg. Die aanroep staat
 * rechtstreeks in de klik, zonder await ervoor: na een await geeft
 * window.open in iOS-standalone null.
 *
 * Lui geladen (LazyBijlageViewer in src/app/lazyViews.tsx) door de schermen
 * die bijlagen tonen (OmleidingDetail, UpdateBijlagenLezen, PdfBijlagen): de
 * viewer en pdfjs zitten niet in de startbundel of de warmup. De service
 * worker zet deze chunk bij installatie in de cache (vite.config.ts), zodat
 * een bewaarde bijlage ook na een deploy zonder bereik opent.
 */

type Staat =
  | { soort: 'laden' }
  | { soort: 'fout' }
  | { soort: 'weg' }
  | { soort: 'klaar'; doc: PDFDocumentProxy; bewaard: boolean };

const HERKOMST: Record<BijlageSoort, string> = { omleiding: 'de omleiding', update: 'het bericht' };

export type BijlageViewerProps = {
  soort: BijlageSoort;
  /** Id van de omleiding of update waar de bijlage bij hoort. */
  recordId: string;
  /** De bijlage die open staat; null = gesloten (de laag fadet dan nog uit). */
  bijlage: PdfBijlage | null | undefined;
  onClose: () => void;
};

export default function BijlageViewer({ soort, recordId, bijlage, onClose }: BijlageViewerProps) {
  // De laatst getoonde bijlage blijft staan terwijl de laag uitfadet.
  const laatste = useRef(bijlage);
  if (bijlage) laatste.current = bijlage;
  const b = bijlage ?? laatste.current;
  const open = Boolean(bijlage);

  const [staat, setStaat] = useState<Staat>({ soort: 'laden' });
  const [poging, setPoging] = useState(0);
  // De laatst bekende link, voor "Extern openen": synchroon leesbaar in de klik.
  const externUrl = useRef(b?.url ?? '');
  const online = useOnline();

  const slot = b?.slot ?? 0;
  const url = b?.url ?? '';
  const filename = b?.filename ?? '';
  const sizeBytes = b?.sizeBytes;
  const uploadedAt = b?.uploadedAt;

  // Bytes (toestel of server) → pdfjs. Sluiten breekt af via het
  // AbortSignal; een document dat pas ná het sluiten binnenkomt wordt meteen
  // vernietigd, anders blijft het in de pdfjs-worker hangen. De link zelf
  // staat bewust niet in de afhankelijkheden: elke lijst die binnenkomt
  // draagt een nieuw token, en dat is geen reden om opnieuw te laden. Een
  // ander uploadmoment op dezelfde plaats is wel een ander bestand.
  useEffect(() => {
    if (!open || !url) return;
    const afbreker = new AbortController();
    const { signal } = afbreker;
    let doc: PDFDocumentProxy | null = null;
    externUrl.current = url;
    setStaat({ soort: 'laden' });
    (async () => {
      const bron = bronVanBijlage(soort, recordId, { slot, filename, sizeBytes, uploadedAt, url });
      const [pdfjs, geladen] = await Promise.all([laadPdfjs(), laadBijlage(bron, signal)]);
      if (signal.aborted) return;
      externUrl.current = geladen.url;
      // De bijlage kwam van het toestel en de link is intussen verlopen: op
      // de achtergrond een verse vragen, zodat "Extern openen" blijft werken.
      if (linkVerlopen(geladen.url)) {
        void haalVerseBijlage(bron, signal).then((vers) => {
          if (!signal.aborted && vers.status === 'vers') externUrl.current = vers.bron.url;
        });
      }
      let geopend: PDFDocumentProxy;
      try {
        geopend = await pdfjs.getDocument({ data: geladen.bytes }).promise;
      } catch (err) {
        // Geen leesbare PDF: niet laten staan, anders faalt elke volgende opening.
        if (geladen.sleutel) await vergeetBijlage(geladen.sleutel);
        throw err;
      }
      if (signal.aborted) {
        geopend.loadingTask.destroy().catch(() => undefined);
        return;
      }
      doc = geopend;
      setStaat({ soort: 'klaar', doc, bewaard: geladen.bewaard });
    })().catch((err: unknown) => {
      if (signal.aborted) return; // sluiten is geen fout
      if (err instanceof BijlageWeg) {
        setStaat({ soort: 'weg' });
        return;
      }
      console.warn('Bijlage laden mislukte:', err);
      setStaat({ soort: 'fout' });
    });
    return () => {
      afbreker.abort();
      doc?.loadingTask.destroy().catch(() => undefined);
      doc = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, soort, recordId, slot, filename, sizeBytes, uploadedAt, poging]);

  // Zelfde stille aanduiding als bij het ritblad: alleen zonder bereik.
  const opgeslagenLabel = !online && staat.soort === 'klaar' && staat.bewaard ? ' · opgeslagen exemplaar' : '';
  const subregel = staat.soort === 'laden'
    ? 'Bijlage laden…'
    : staat.soort === 'klaar' ? `${aantal(staat.doc.numPages, 'pagina', 'pagina’s')}${opgeslagenLabel}` : null;

  const extern = (
    <Button variant="secondary" size="sm" icon={<ExternalLink size={14} />} onClick={() => openPdfInNewTab(externUrl.current)}>
      Extern openen
    </Button>
  );

  return (
    <PdfLaag
      open={open}
      onClose={onClose}
      titel={filename || 'Bijlage'}
      boven
      kop={(
        <header className="flex shrink-0 items-start gap-2 border-b border-hairline px-4 pb-3 pt-4">
          <IconButton label="Terug" onClick={onClose} className="-ml-2 -mt-1.5">
            <ArrowLeft size={18} />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-card-title">{filename || 'Bijlage'}</h2>
            {subregel && <p className="mt-0.5 truncate text-xs font-medium tabular-nums text-slate-500">{subregel}</p>}
          </div>
        </header>
      )}
    >
      {staat.soort === 'laden' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" role="status">
          <BrandSpinner size={24} />
          <p className="text-sm font-medium text-slate-600">Bijlage laden…</p>
        </div>
      )}

      {staat.soort === 'fout' && (
        <div className="flex flex-1 items-center p-4">
          <div className="w-full">
            <EmptyState
              variant="fout"
              illustratie={online ? <Fout /> : <GeenBereik />}
              title="Bijlage kon niet geladen worden"
              message={online
                ? 'Probeer het opnieuw. Lukt het niet, open de bijlage dan buiten de app.'
                : 'Je hebt geen bereik en deze bijlage staat nog niet op dit toestel. Probeer het opnieuw zodra je verbinding hebt.'}
              action={(
                <>
                  <Button variant="primary" icon={<RotateCw size={16} />} onClick={() => setPoging((n) => n + 1)}>Opnieuw proberen</Button>
                  <Button variant="secondary" icon={<ExternalLink size={16} />} onClick={() => openPdfInNewTab(externUrl.current)}>Extern openen</Button>
                </>
              )}
            />
          </div>
        </div>
      )}

      {staat.soort === 'weg' && (
        <div className="flex flex-1 items-center p-4">
          <div className="w-full">
            <EmptyState
              illustratie={<NietGevonden />}
              title="Deze bijlage is er niet meer"
              message={`Ze is intussen verwijderd of vervangen. Ga terug naar ${HERKOMST[soort]} voor de huidige bijlagen.`}
              action={<Button variant="secondary" onClick={onClose}>Terug</Button>}
            />
          </div>
        </div>
      )}

      {staat.soort === 'klaar' && (
        <PdfBladen
          doc={staat.doc}
          paginas={Array.from({ length: staat.doc.numPages }, (_, i) => i + 1)}
          paginaLabel={(n) => `Pagina ${n} van ${filename}`}
          voet={extern}
        />
      )}
    </PdfLaag>
  );
}
