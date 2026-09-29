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
import { BijlageWeg, bronVanBijlage, bronVanDocument, haalVerseBijlage, laadBijlage, linkVerlopen, type LaadBron, type PersoonlijkDocument } from '../lib/bijlageLaden';
import { aantal } from '../lib/format';
import { openPdfInNewTab } from '../lib/ui';
import { isOnlineNu, useOnline } from '../lib/useOnline';

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
 * **Persoonlijke documenten** (`soort="document"`, 29-09): loonbrieven en
 * attesten openen in dezelfde viewer, maar er blijft niets op het toestel
 * (Jarno: "mogen intern openen, maar niet persistent offline"). De lader
 * draait dan zonder bewaren (geen Cache Storage, download met no-store), een
 * verse link komt uit de documentenlijst, en zonder bereik opent het document
 * niet: een foutstaat die dat uitlegt, "Extern openen" uit. Pas als de PDF in
 * de viewer staat, meldt `onGeopend` het (de leesbevestiging). Bij sluiten
 * vernietigt de viewer het pdfjs-document en laat hij na het uitfaden ook de
 * rest los; er komt nooit een object-URL aan te pas.
 *
 * "Extern openen" is de oude weg en blijft één tik weg. Die aanroep staat
 * rechtstreeks in de klik, zonder await ervoor: na een await geeft
 * window.open in iOS-standalone null.
 *
 * Lui geladen (LazyBijlageViewer in src/app/lazyViews.tsx) door de schermen
 * die bijlagen tonen (OmleidingDetail, UpdateBijlagenLezen, PdfBijlagen) en
 * door Documenten en het documentenbeheer: de viewer en pdfjs zitten niet in
 * de startbundel of de warmup. De service worker zet deze chunk bij
 * installatie in de cache (vite.config.ts), zodat een bewaarde bijlage ook na
 * een deploy zonder bereik opent.
 */

type Staat =
  | { soort: 'laden' }
  | { soort: 'fout' }
  | { soort: 'weg' }
  | { soort: 'klaar'; doc: PDFDocumentProxy; bewaard: boolean };

const HERKOMST: Record<BijlageSoort, string> = { omleiding: 'de omleiding', update: 'het bericht' };

/** De laag fadet uit in DUR.fast (Modal); daarna houdt de viewer van een
 *  persoonlijk document niets meer vast. */
const NA_UITFADEN_MS = 400;

/** Een bijlage van een omleiding of update. */
export type BijlageViewerProps = {
  soort: BijlageSoort;
  /** Id van de omleiding of update waar de bijlage bij hoort. */
  recordId: string;
  /** De bijlage die open staat; null = gesloten (de laag fadet dan nog uit). */
  bijlage: PdfBijlage | null | undefined;
  onClose: () => void;
};

/** Een persoonlijk document (loonbrief, attest): opent zonder te bewaren. */
export type DocumentViewerProps = {
  soort: 'document';
  /** Het persoonlijke document dat open staat; null = gesloten. */
  document: PersoonlijkDocument | null | undefined;
  /** De documentenlijst voor een verse link: `/api/documents` of `…?userId=`. */
  lijst: string;
  onClose: () => void;
  /** De PDF staat in de viewer: pas dan telt het document als geopend. */
  onGeopend?: (documentId: string) => void;
};

type ViewerProps = BijlageViewerProps | DocumentViewerProps;

/** Wat de viewer van een bijlage of document gebruikt. */
type Getoond = { recordId: string; slot: number; filename: string; sizeBytes?: number; uploadedAt?: string; url: string };

const getoondVan = (props: ViewerProps): Getoond | null => {
  if (props.soort === 'document') {
    const d = props.document;
    return d ? { recordId: d.id, slot: 0, filename: d.filename, sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : undefined, url: d.url ?? '' } : null;
  }
  const b = props.bijlage;
  return b ? { recordId: props.recordId, slot: b.slot, filename: b.filename, sizeBytes: b.sizeBytes, uploadedAt: b.uploadedAt, url: b.url ?? '' } : null;
};

export default function BijlageViewer(props: ViewerProps) {
  const { soort, onClose } = props;
  const persoonlijk = props.soort === 'document';
  const invoer = getoondVan(props);
  // De laatst getoonde bijlage blijft staan terwijl de laag uitfadet.
  const laatste = useRef<Getoond | null>(invoer);
  if (invoer) laatste.current = invoer;
  const b = invoer ?? laatste.current;
  const open = Boolean(invoer);

  const [staat, setStaat] = useState<Staat>({ soort: 'laden' });
  const [poging, setPoging] = useState(0);
  // De laatst bekende link, voor "Extern openen": synchroon leesbaar in de klik.
  const externUrl = useRef(b?.url ?? '');
  const online = useOnline();
  // Uit een ref, zodat een nieuwe functie bij elke render niet opnieuw laadt.
  const lijst = props.soort === 'document' ? props.lijst : '';
  const lijstRef = useRef(lijst);
  lijstRef.current = lijst;
  const onGeopend = props.soort === 'document' ? props.onGeopend : undefined;
  const onGeopendRef = useRef(onGeopend);
  onGeopendRef.current = onGeopend;

  const recordId = b?.recordId ?? '';
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
    if (!open) {
      // Persoonlijk document dicht: het pdfjs-document is al vernietigd
      // (opruimen hieronder); na het uitfaden laat de viewer ook de staat,
      // de gegevens en de link los.
      if (!persoonlijk || !laatste.current) return;
      const t = window.setTimeout(() => {
        laatste.current = null;
        externUrl.current = '';
        setStaat({ soort: 'laden' });
      }, NA_UITFADEN_MS);
      return () => window.clearTimeout(t);
    }
    if (!url && !persoonlijk) return;
    externUrl.current = url;
    // Zonder bereik opent een persoonlijk document niet: er staat niets op
    // het toestel. Geen ophaling, meteen de uitleg.
    if (persoonlijk && !isOnlineNu()) {
      setStaat({ soort: 'fout' });
      return;
    }
    const afbreker = new AbortController();
    const { signal } = afbreker;
    let doc: PDFDocumentProxy | null = null;
    setStaat({ soort: 'laden' });
    (async () => {
      const bron: LaadBron = persoonlijk
        ? bronVanDocument({ id: recordId, filename, sizeBytes, url }, lijstRef.current)
        : bronVanBijlage(soort as BijlageSoort, recordId, { slot, filename, sizeBytes, uploadedAt, url });
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
      // Een persoonlijk document telt pas als geopend nu het in beeld staat.
      if (persoonlijk) onGeopendRef.current?.(recordId);
    })().catch((err: unknown) => {
      if (signal.aborted) return; // sluiten is geen fout
      if (err instanceof BijlageWeg) {
        setStaat({ soort: 'weg' });
        return;
      }
      console.warn(persoonlijk ? 'Document laden mislukte:' : 'Bijlage laden mislukte:', err);
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
    ? (persoonlijk ? 'Document laden…' : 'Bijlage laden…')
    : staat.soort === 'klaar' ? `${aantal(staat.doc.numPages, 'pagina', 'pagina’s')}${opgeslagenLabel}` : null;
  // Een persoonlijk document opent zonder bereik ook buiten de app niet.
  const externUit = persoonlijk && !online;

  const extern = (
    <Button variant="secondary" size="sm" icon={<ExternalLink size={14} />} disabled={externUit} onClick={() => openPdfInNewTab(externUrl.current)}>
      Extern openen
    </Button>
  );

  const foutTekst = persoonlijk
    ? (online
      ? 'Probeer het opnieuw. Lukt het niet, open het document dan buiten de app.'
      : 'Persoonlijke documenten openen alleen met bereik: ze worden niet op dit toestel bewaard. Probeer het opnieuw zodra je verbinding hebt.')
    : (online
      ? 'Probeer het opnieuw. Lukt het niet, open de bijlage dan buiten de app.'
      : 'Je hebt geen bereik en deze bijlage staat nog niet op dit toestel. Probeer het opnieuw zodra je verbinding hebt.');

  return (
    <PdfLaag
      open={open}
      onClose={onClose}
      titel={filename || (persoonlijk ? 'Document' : 'Bijlage')}
      boven
      kop={(
        <header className="flex shrink-0 items-start gap-2 border-b border-hairline px-4 pb-3 pt-4">
          <IconButton label="Terug" onClick={onClose} className="-ml-2 -mt-1.5">
            <ArrowLeft size={18} />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-card-title">{filename || (persoonlijk ? 'Document' : 'Bijlage')}</h2>
            {subregel && <p className="mt-0.5 truncate text-xs font-medium tabular-nums text-slate-500">{subregel}</p>}
          </div>
        </header>
      )}
    >
      {staat.soort === 'laden' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" role="status">
          <BrandSpinner size={24} />
          <p className="text-sm font-medium text-slate-600">{persoonlijk ? 'Document laden…' : 'Bijlage laden…'}</p>
        </div>
      )}

      {staat.soort === 'fout' && (
        <div className="flex flex-1 items-center p-4">
          <div className="w-full">
            <EmptyState
              variant="fout"
              illustratie={online ? <Fout /> : <GeenBereik />}
              title={persoonlijk ? 'Document kon niet geladen worden' : 'Bijlage kon niet geladen worden'}
              message={foutTekst}
              action={(
                <>
                  <Button variant="primary" icon={<RotateCw size={16} />} onClick={() => setPoging((n) => n + 1)}>Opnieuw proberen</Button>
                  <Button variant="secondary" icon={<ExternalLink size={16} />} disabled={externUit} onClick={() => openPdfInNewTab(externUrl.current)}>Extern openen</Button>
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
              title={persoonlijk ? 'Dit document is er niet meer' : 'Deze bijlage is er niet meer'}
              message={props.soort === 'document'
                ? 'Het is intussen verwijderd. Ga terug naar de documenten.'
                : `Ze is intussen verwijderd of vervangen. Ga terug naar ${HERKOMST[props.soort]} voor de huidige bijlagen.`}
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
