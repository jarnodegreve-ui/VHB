import { CalendarClock, GitCompareArrows, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Dienstregeling } from '../../types';
import { Badge, Button, Segmented, type BadgeTone } from '../primitives';
import { ActieMenu } from '../ActieMenu';
import { formatDatumDMJ } from '../../lib/format';
import { versieLabel } from '../../../shared/dienstregeling';
import { cn } from '../../lib/ui';

const STATUS: Record<Dienstregeling['status'], { label: string; tone: BadgeTone }> = {
  huidig: { label: 'Huidig', tone: 'emerald' },
  toekomstig: { label: 'Toekomstig', tone: 'blue' },
  verlopen: { label: 'Verlopen', tone: 'slate' },
};

/**
 * De versiebalk van het Dienstoverzicht (fase 1, 08-10): kies een versie van
 * de dienstregeling, zie haar status en periode, en zet een nieuwe klaar.
 * Een toekomstige of verlopen versie krijgt eronder één regel uitleg over
 * wat een wijziging daar met de planning doet.
 */
export function VersieBalk({ versies, gekozen, onKies, onNieuw, onBewerk, onVergelijk, onVerwijder, magVerwijderen, magVergelijken }: {
  versies: Dienstregeling[];
  gekozen: Dienstregeling;
  onKies: (id: string) => void;
  onNieuw: () => void;
  onBewerk: () => void;
  onVergelijk: () => void;
  onVerwijder: () => void;
  magVerwijderen: boolean;
  magVergelijken: boolean;
}) {
  const status = STATUS[gekozen.status];
  const periode = gekozen.geldigTot
    ? `${formatDatumDMJ(gekozen.geldigVanaf)} tot ${formatDatumDMJ(gekozen.geldigTot)}`
    : `vanaf ${formatDatumDMJ(gekozen.geldigVanaf)}`;
  return (
    <section aria-label="Versie van de dienstregeling" className="mb-4 rounded-xl bg-paper ring-1 ring-hairline">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <CalendarClock size={16} className="shrink-0 text-slate-400" aria-hidden />
        <Segmented
          label="Versie van de dienstregeling"
          waarde={gekozen.id}
          telefoon="schuif"
          opties={versies.map((v) => ({ waarde: v.id, label: versieLabel(v) }))}
          onChange={onKies}
        />
        <Badge tone={status.tone} title={`Geldig ${periode}`}>{status.label}</Badge>
        <span className="text-xs text-slate-500">
          {gekozen.aantalDiensten} {gekozen.aantalDiensten === 1 ? 'dienst' : 'diensten'}, geldig {periode}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ActieMenu
            size="sm"
            label={`Acties voor versie ${versieLabel(gekozen)}`}
            items={[
              { label: 'Vergelijken met de vorige versie', icon: <GitCompareArrows size={16} />, disabled: !magVergelijken, onClick: onVergelijk },
              { label: 'Naam of datum wijzigen', icon: <Pencil size={16} />, onClick: onBewerk },
              ...(magVerwijderen ? [{ label: 'Versie verwijderen', icon: <Trash2 size={16} />, gevaarlijk: true, scheiding: true, disabled: gekozen.status !== 'toekomstig', onClick: onVerwijder }] : []),
            ]}
          />
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={onNieuw}>Nieuwe versie</Button>
        </div>
      </div>
      {gekozen.status !== 'huidig' && (
        <p className={cn('border-t border-hairline px-3 py-2 text-xs', gekozen.status === 'toekomstig' ? 'text-blue-700' : 'text-slate-500')}>
          {gekozen.status === 'toekomstig'
            ? `Deze versie geldt vanaf ${formatDatumDMJ(gekozen.geldigVanaf)}. Wat je hier wijzigt, raakt de planning van de chauffeurs vanaf die dag; tot dan blijft de huidige versie gelden.`
            : `Deze versie gold tot ${formatDatumDMJ(gekozen.geldigTot ?? gekozen.geldigVanaf)} en is alleen te lezen: de planning van die dagen blijft erop gebouwd.`}
        </p>
      )}
    </section>
  );
}
