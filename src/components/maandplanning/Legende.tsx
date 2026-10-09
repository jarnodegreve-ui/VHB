import { TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/ui';
import { Card } from '../Card';
import { Chip, MicroLabel } from '../primitives';
import { KIND_CLS, celChipClass } from '../../lib/planningKind';
import type { CodeLegend } from '../../lib/maandplanning';

/**
 * Legende onder de Maandplanning (herwerkt 08-09, Jarno): twee groepen,
 * codes en markeringen, elk chip + betekenis in een vaste rij. Alleen codes
 * die deze maand voorkomen; ruil en ziekte volgen dezelfde kleuren als de
 * cellen. De inhoud komt uit `berekenCodeLegend` (src/lib/maandplanning.ts).
 * Verplaatst uit CapacityView.tsx op 09-10 (stap 1 van de splitsing).
 */
export function Legende({ legend }: { legend: CodeLegend }) {
  return (
    <Card padding="md" className="text-xs">
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:gap-x-10">
        <div className="min-w-0">
          <MicroLabel className="mb-2 block">Codes</MicroLabel>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {legend.serviceExample && (
              <span className="inline-flex items-center gap-2">
                <Chip mono={false} className={cn('min-w-11 justify-center', KIND_CLS.service)}>{legend.serviceExample}</Chip>
                <span className="font-medium text-slate-700">Dienst</span>
              </span>
            )}
            {legend.entries.map((e) => (
              <span key={e.code} className="inline-flex items-center gap-2">
                <Chip mono={false} className={cn('min-w-11 justify-center', celChipClass({ kind: e.kind, code: e.code }))}>{e.code}</Chip>
                <span className="font-medium text-slate-700">{e.meaning}</span>
              </span>
            ))}
            {/* Alleen tonen als er die maand écht een wissel in staat:
                anders legt de legende twee kleuren uit die nergens
                voorkomen (heeftRuil werd berekend maar nooit gelezen). */}
            {legend.heeftRuil && (
              <>
                <span className="inline-flex items-center gap-2">
                  <Chip mono={false} className={cn('min-w-11 justify-center', celChipClass({ kind: 'service', code: '', swapId: 'x' }))}>{legend.serviceExample ?? 'dienst'}</Chip>
                  <span className="font-medium text-slate-700">Geruild of overgezet, gekregen</span>
                </span>
                <span className="inline-flex items-center gap-2">
                  <Chip mono={false} className={cn('min-w-11 justify-center', celChipClass({ kind: 'absence', code: 'vrij', swapId: 'x' }))}>vrij</Chip>
                  <span className="font-medium text-slate-700">Geruild of overgezet, weggegeven</span>
                </span>
              </>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <MicroLabel className="mb-2 block">Markeringen</MicroLabel>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex h-6 w-11 items-center justify-center rounded-lg bg-surface-muted"><TriangleAlert size={14} className="text-amber-700" /></span>
              <span className="font-medium text-slate-700">Dienst nog niet herverdeeld</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex h-6 w-11 items-center justify-center rounded-lg bg-surface-muted"><span className="h-1.5 w-1.5 rounded-full bg-slate-600" /></span>
              <span className="font-medium text-slate-700">Notitie bij de dag</span>
            </span>
            <span className="inline-flex items-center gap-2">
              {/* 2xs: datumbadge van vaste maat */}
              <span className="inline-flex h-6 w-11 items-center justify-center rounded-lg bg-oker-100 text-2xs font-semibold text-oker-800">{new Date().getDate()}</span>
              <span className="font-medium text-slate-700">Vandaag</span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
