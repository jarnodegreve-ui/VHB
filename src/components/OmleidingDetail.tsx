import { Calendar, FileText } from 'lucide-react';
import { omleidingsPeriode, omleidingsTijdshint } from '../lib/diversions';
import type { Diversion } from '../types';
import { openPdfInNewTab } from '../lib/ui';
import { Button, MicroLabel } from './primitives';
import { Card } from './Card';

/**
 * Inhoud van één omleiding: periode bovenaan, dan de omschrijving met behoud
 * van regeleinden, en één PDF-knop.
 *
 * Woont bewust hier en niet in DiversionsView: het dashboard toont hetzelfde
 * blok in zijn SlideOver, en een import daarvandaan maakte de (lui geladen)
 * dashboard-chunk afhankelijk van de héle omleidingenview.
 */
export function OmleidingDetail({ diversion: div }: { diversion: Diversion }) {
  const hint = omleidingsTijdshint(div);
  return (
    <div className="space-y-5">
      <Card tone="muted" padding="sm">
        <MicroLabel>Periode</MicroLabel>
        <p className="mt-1.5 flex items-center gap-2 text-md font-semibold text-slate-800">
          <Calendar size={14} className="text-oker-500" />
          {omleidingsPeriode(div)}{!div.endDate && ', geen einddatum'}
        </p>
        {hint && <p className="mt-0.5 text-xs font-medium text-slate-500">{hint}</p>}
      </Card>

      <div>
        <MicroLabel>Omschrijving</MicroLabel>
        <p className="mt-2 whitespace-pre-line text-body font-normal text-slate-700">{div.description}</p>
      </div>

      {div.pdfUrl && (
        <Button
          variant="secondary"
          size="lg"
          full
          icon={<FileText size={16} className="text-red-500" />}
          onClick={() => openPdfInNewTab(div.pdfUrl)}
        >
          Open PDF
        </Button>
      )}
    </div>
  );
}
