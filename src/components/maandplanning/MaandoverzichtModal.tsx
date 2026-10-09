import { BrandSpinner } from '../BrandSpinner';
import { ModalHeader } from '../ui';
import { Modal } from '../Modal';
import { SortTh } from '../Table';
import { Td, Th, Tabel, TableShell } from '../TabelBasis';
import { MONTH_NAMES } from '../../lib/format';
import {
  OVERZICHT_KOLOMMEN, sorteerOverzichtRijen, urenLabel,
  type MaandOverzicht, type OverzichtRij, type OverzichtSortering,
} from '../../lib/maandplanning';

/**
 * Maandoverzicht per chauffeur, zelfde telling als de Excel-export. Op de
 * huisprimitieven (ModalHeader, Th/Td) zodat dit venster niet zijn eigen
 * dialect ontwikkelt (controle-ronde 22-08). De view houdt open/dicht, het
 * laden en de sorteerstand; verplaatst uit CapacityView.tsx op 09-10
 * (stap 1 van de splitsing).
 */
type Props = {
  open: boolean;
  onClose: () => void;
  monthIndex: number;
  year: number;
  laden: boolean;
  overzicht: MaandOverzicht | null;
  sort: OverzichtSortering;
  sorteer: (kolom: keyof OverzichtRij) => void;
};

export function MaandoverzichtModal({ open, onClose, monthIndex, year, laden, overzicht, sort, sorteer }: Props) {
  // Dezelfde sorteerstand in de vorm die SortTh leest (aria-sort, pijl).
  const sortTh = {
    key: sort.kolom,
    dir: (sort.richting === 1 ? 'asc' : 'desc') as 'asc' | 'desc',
    toggle: sorteer,
  };
  return (
    <Modal open={open} onClose={onClose} maxWidth="2xl" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
      <ModalHeader
        eyebrow="Maandoverzicht"
        title={`${MONTH_NAMES[monthIndex]} ${year}`}
        description={'Stand ná wissels, toewijzingen en afwezigheden, identiek aan het tabblad “maandoverzicht” in de Excel-export. Uren = som van de dienstsegmenten; diensten zonder tijden tellen alleen in de dagtelling.'}
        onClose={onClose}
      />
      <div className="p-6 overflow-y-auto flex-1">
        {laden ? (
          <div className="flex items-center gap-3 text-slate-500">
            <BrandSpinner size={16} />
            <span className="text-sm font-bold">Overzicht berekenen…</span>
          </div>
        ) : overzicht && (
          // TableShell: schuift in zijn kader als de modal smal is (telefoon);
          // de naamkolom is de rijkop, de totaalrij een rijkop "Totaal".
          <TableShell label={`Maandoverzicht ${MONTH_NAMES[monthIndex].toLowerCase()} ${year}`}>
            <Tabel className="text-xs">
              <thead>
                <tr className="border-b border-hairline">
                  {OVERZICHT_KOLOMMEN.map(([kolom, label]) => (
                    // Eigen sorteerregel, via SortTh getoond: dezelfde kolom
                    // keert om, een nieuwe cijferkolom begint aflopend, de
                    // naam oplopend (zoals voorheen).
                    <SortTh
                      key={kolom}
                      kolom={kolom}
                      sort={sortTh}
                      align={kolom === 'naam' ? 'left' : 'right'}
                      dicht
                    >
                      {label}
                    </SortTh>
                  ))}
                  <Th className="px-2 py-1">Overig</Th>
                </tr>
              </thead>
              <tbody>
                {sorteerOverzichtRijen(overzicht.rijen, sort)
                  .map((r) => (
                    <tr key={r.driverId} className="border-b border-hairline-subtle last:border-b-0">
                      <Th scope="row" className="px-2 py-1.5 text-xs font-semibold text-slate-800">{r.naam}</Th>
                      <Td num className="px-2 py-1.5 text-xs">{r.diensten}</Td>
                      <Td num className="px-2 py-1.5 text-xs">{urenLabel(r.minuten)}</Td>
                      <Td num className="px-2 py-1.5 text-xs">{r.anderWerk}</Td>
                      <Td num className="px-2 py-1.5 text-xs">{r.ziek}</Td>
                      <Td num className="px-2 py-1.5 text-xs">{r.betaald}</Td>
                      <Td num className="px-2 py-1.5 text-xs">{r.vrij}</Td>
                      <Td num className="px-2 py-1.5 text-xs font-semibold">{r.dagen}</Td>
                      <Td nowrap className="px-2 py-1.5 text-xs text-slate-500">{r.overig.map(({ code, keren }) => `${code}×${keren}`).join(', ') || '—'}</Td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-hairline-strong">
                  <Th scope="row" className="px-2 py-2 text-xs font-bold text-slate-900">Totaal</Th>
                  <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.diensten}</Td>
                  <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{urenLabel(overzicht.totaal.minuten)}</Td>
                  <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.anderWerk}</Td>
                  <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.ziek}</Td>
                  <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.betaald}</Td>
                  <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.vrij}</Td>
                  <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.dagen}</Td>
                  <Td className="px-2 py-2" />
                </tr>
              </tfoot>
            </Tabel>
          </TableShell>
        )}
      </div>
    </Modal>
  );
}
