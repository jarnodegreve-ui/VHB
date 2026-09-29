import { Suspense, useState } from 'react';
import { FileText } from 'lucide-react';
import { omleidingsPeriode, omleidingsTijdshint } from '../lib/diversions';
import type { Diversion, PdfBijlage } from '../types';
// Lui geladen: de viewer en pdfjs horen niet in de startbundel of de warmup.
import { LazyBijlageViewer } from '../app/lazyViews';
import { Button, MicroLabel } from './primitives';
import { LijnTegel } from './LijnTegel';

/**
 * Inhoud van één omleiding: periode bovenaan, dan de bijlagen (tot vijf
 * PDF's, één knop per bestand) en pas dan de omschrijving met behoud van
 * regeleinden, zodat een lange tekst de bijlagen niet onderaan het paneel
 * verstopt. Een bijlage opent in de app (BijlageViewer): terug sluit de
 * viewer en laat deze omleiding open staan.
 *
 * Woont bewust hier en niet in DiversionsView: het dashboard toont hetzelfde
 * blok in zijn SlideOver, en een import daarvandaan maakte de (lui geladen)
 * dashboard-chunk afhankelijk van de héle omleidingenview.
 */
export function OmleidingDetail({ diversion: div }: { diversion: Diversion }) {
  const hint = omleidingsTijdshint(div);
  const bijlagen = (div.bijlagen ?? []).filter((b) => b.url);
  // undefined = nog nooit geopend (de viewer is dan niet geladen), null =
  // gesloten na een opening (de laag fadet nog uit).
  const [open, setOpen] = useState<PdfBijlage | null>();
  return (
    <div className="space-y-5">
      <LijnTegel line={div.line} layout="rij" />
      <div className="border-b border-hairline pb-5">
        <dl className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <dt><MicroLabel>Vanaf</MicroLabel></dt>
            <dd className="mt-1.5 text-md font-semibold text-slate-800 [overflow-wrap:anywhere]">
              {div.startDate ? <time dateTime={div.startDate}>{omleidingsPeriode({ startDate: div.startDate, endDate: div.startDate })}</time> : 'Niet opgegeven'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt><MicroLabel>Tot en met</MicroLabel></dt>
            <dd className="mt-1.5 text-md font-semibold text-slate-800 [overflow-wrap:anywhere]">
              {div.endDate ? <time dateTime={div.endDate}>{omleidingsPeriode({ startDate: div.endDate, endDate: div.endDate })}</time> : 'Geen einddatum'}
            </dd>
          </div>
        </dl>
        {hint && <p className="mt-3 text-xs font-medium text-slate-500">{hint}</p>}
      </div>

      {bijlagen.length > 0 && (
        <div>
          <MicroLabel>Bijlagen</MicroLabel>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Bijlagen">
            {bijlagen.map((b) => (
              <li key={b.slot} className="min-w-0 max-w-full">
                {/* max-w-full + min-w-0: zonder die twee groeit de knop met een
                    lange bestandsnaam mee en kapt de naam nooit af. Het icoon
                    volgt de tekstkleur, zoals bij de updates: rood betekent
                    in het portaal fout of dringend. */}
                <Button
                  variant="secondary"
                  size="sm"
                  className="max-w-full min-w-0"
                  icon={<FileText size={16} />}
                  onClick={() => setOpen(b)}
                >
                  <span className="min-w-0 truncate">{b.filename}</span>
                </Button>
              </li>
            ))}
          </ul>
          {open !== undefined && (
            <Suspense fallback={null}>
              <LazyBijlageViewer soort="omleiding" recordId={div.id} bijlage={open} onClose={() => setOpen(null)} />
            </Suspense>
          )}
        </div>
      )}

      <div>
        <MicroLabel>Omschrijving</MicroLabel>
        <p className="mt-3 max-w-prose whitespace-pre-wrap text-body font-normal text-slate-700 [overflow-wrap:anywhere]">{div.description}</p>
      </div>
    </div>
  );
}
