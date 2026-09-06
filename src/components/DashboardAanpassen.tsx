import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import type { DashboardVoorkeuren } from '../types';
import { isStandaard, isVerborgen, verplaats, volledigeVolgorde, zetZichtbaar, type TegelDef } from '../lib/dashboardVoorkeuren';
import { LEGE_DASHBOARD_VOORKEUREN } from '../../shared/schemas/dashboardVoorkeuren';
import { cn } from '../lib/ui';
import { Modal } from './Modal';
import { Button, IconButton, MicroLabel, Switch } from './primitives';
import { ModalHeader } from './ui';

/**
 * "Dashboard aanpassen": per tegel een schakelaar (tonen) en pijltjes
 * (volgorde) — geen sleep-bibliotheek, werkt met duim én toetsenbord.
 * Wijzigingen gaan meteen door naar het dashboard erachter (live) en worden
 * gebundeld opgeslagen (useDashboardVoorkeuren). Essentiële tegels
 * (Vandaag, Open taken) hebben geen schakelaar: "Altijd zichtbaar".
 */
export function DashboardAanpassen({
  open,
  onClose,
  tegels,
  voorkeuren,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  tegels: readonly TegelDef[];
  voorkeuren: DashboardVoorkeuren;
  onChange: (volgende: DashboardVoorkeuren) => void;
}) {
  const rijen = volledigeVolgorde(tegels, voorkeuren);
  const groepen: Array<{ groep: TegelDef['groep']; label: string }> = [
    { groep: 'tegels', label: 'Tegels' },
    { groep: 'panelen', label: 'Panelen' },
  ];

  return (
    <Modal open={open} onClose={onClose} maxWidth="md" ariaLabel="Dashboard aanpassen" className="flex max-h-[85vh] flex-col overflow-hidden !p-0">
      <ModalHeader
        title="Dashboard aanpassen"
        description="Kies welke tegels je ziet en in welke volgorde. Je dashboard past zich meteen aan."
        onClose={onClose}
        leading={
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-oker-500/15 text-oker-700">
            <SlidersHorizontal size={16} />
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
        {groepen.map(({ groep, label }) => {
          const items = rijen.filter((t) => t.groep === groep);
          if (items.length === 0) return null;
          return (
            <section key={groep} aria-label={label} className="mb-5 last:mb-0">
              <MicroLabel className="px-1">{label}</MicroLabel>
              <ul className="mt-2 divide-y divide-slate-100 rounded-2xl ring-1 ring-hairline">
                {items.map((t) => {
                  const positie = rijen.findIndex((r) => r.id === t.id);
                  const verborgen = isVerborgen(tegels, voorkeuren, t.id);
                  return (
                    <li key={t.id} className={cn('flex items-center gap-2 px-3 py-2', verborgen && 'opacity-60')}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{t.label}</p>
                        <p className="truncate text-xs font-normal text-slate-500">
                          {t.essentieel ? 'Altijd zichtbaar' : t.omschrijving}
                        </p>
                      </div>
                      <IconButton
                        label={`${t.label} omhoog`}
                        variant="ghost"
                        size="sm"
                        disabled={positie <= 0}
                        onClick={() => onChange(verplaats(tegels, voorkeuren, t.id, 'omhoog'))}
                      >
                        <ChevronUp size={16} />
                      </IconButton>
                      <IconButton
                        label={`${t.label} omlaag`}
                        variant="ghost"
                        size="sm"
                        disabled={positie >= rijen.length - 1}
                        onClick={() => onChange(verplaats(tegels, voorkeuren, t.id, 'omlaag'))}
                      >
                        <ChevronDown size={16} />
                      </IconButton>
                      <Switch
                        label={`${t.label} tonen`}
                        checked={!verborgen}
                        disabled={t.essentieel}
                        onChange={(aan) => onChange(zetZichtbaar(tegels, voorkeuren, t.id, aan))}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200/70 px-4 py-3 md:px-5">
        <Button variant="ghost" size="sm" disabled={isStandaard(voorkeuren)} onClick={() => onChange(LEGE_DASHBOARD_VOORKEUREN)}>
          Standaard herstellen
        </Button>
        <Button variant="primary" size="sm" onClick={onClose}>Klaar</Button>
      </footer>
    </Modal>
  );
}
