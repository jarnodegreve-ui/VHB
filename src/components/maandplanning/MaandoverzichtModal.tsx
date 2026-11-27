import { Suspense } from 'react';
import { BrandSpinner } from '../BrandSpinner';
import { ModalHeader } from '../ui';
import { Modal } from '../Modal';
import { MONTH_NAMES } from '../../lib/format';
import { lazyWithRetry } from '../../lib/lazyRetry';
import type { MaandoverzichtTabelProps } from './MaandoverzichtTabel';

const MaandoverzichtTabel = lazyWithRetry(() => import('./MaandoverzichtTabel'));

const laadregel = (
  <div role="status" className="flex items-center gap-3 text-slate-500">
    <BrandSpinner size={16} />
    <span className="text-sm font-bold">Overzicht berekenen…</span>
  </div>
);

type Props = MaandoverzichtTabelProps & {
  open: boolean;
  onClose: () => void;
  laden: boolean;
};

export function MaandoverzichtModal({ open, onClose, monthIndex, year, laden, overzicht, sort, sorteer }: Props) {
  return (
    <Modal open={open} onClose={onClose} maxWidth="2xl" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
      <ModalHeader
        eyebrow="Maandoverzicht"
        title={`${MONTH_NAMES[monthIndex]} ${year}`}
        description={'Stand ná wissels, toewijzingen en afwezigheden, identiek aan het tabblad “maandoverzicht” in de Excel-export. Uren = som van de dienstsegmenten; diensten zonder tijden tellen alleen in de dagtelling.'}
        onClose={onClose}
      />
      <div className="p-6 overflow-y-auto flex-1">
        {/* De tabelcode en de berekening laden tegelijk. De kop, focus en
            terugknop horen al die tijd bij hetzelfde venster. */}
        {laden && laadregel}
        {open && (
          <Suspense fallback={laden ? null : laadregel}>
            <MaandoverzichtTabel
              overzicht={laden ? null : overzicht} monthIndex={monthIndex} year={year}
              sort={sort} sorteer={sorteer}
            />
          </Suspense>
        )}
      </div>
    </Modal>
  );
}
