import { FileText } from 'lucide-react';
import { omleidingsPeriode, omleidingsTijdshint } from '../lib/diversions';
import type { Diversion } from '../types';
import { openPdfInNewTab } from '../lib/ui';
import { Button, MicroLabel } from './primitives';
import { LijnTegel } from './LijnTegel';

/**
 * Inhoud van één omleiding: periode bovenaan, dan de omschrijving met behoud
 * van regeleinden. De PDF-knop staat bij de kop van de omschrijving, zodat
 * een lange tekst de bijlage niet onderaan het paneel verstopt.
 *
 * Woont bewust hier en niet in DiversionsView: het dashboard toont hetzelfde
 * blok in zijn SlideOver, en een import daarvandaan maakte de (lui geladen)
 * dashboard-chunk afhankelijk van de héle omleidingenview.
 */
export function OmleidingDetail({ diversion: div }: { diversion: Diversion }) {
  const hint = omleidingsTijdshint(div);
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

      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MicroLabel>Omschrijving</MicroLabel>
          {div.pdfUrl && (
            <Button
              variant="secondary"
              size="sm"
              icon={<FileText size={16} className="text-red-500" />}
              onClick={() => openPdfInNewTab(div.pdfUrl)}
            >
              Open PDF
            </Button>
          )}
        </div>
        <p className="mt-3 max-w-prose whitespace-pre-wrap text-body font-normal text-slate-700 [overflow-wrap:anywhere]">{div.description}</p>
      </div>
    </div>
  );
}
