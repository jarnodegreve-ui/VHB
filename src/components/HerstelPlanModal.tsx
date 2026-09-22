import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { HerstelPlan } from '../../shared/herstelPlan';
import { formatDateTimeHuman } from '../lib/format';
import { Modal } from './Modal';
import { Button, MicroLabel, Td, Th } from './primitives';

/**
 * Bevestiging van een herstel, met de droge run erbij (verbeterronde 4, punt
 * 13): per collectie wat de back-up bevat, wat er terugkomt en wat er
 * verdwijnt. Vroeger stond hier één zin met aantallen uit het bestand; wat een
 * herstel OVERSCHRIJFT zag je pas achteraf. Een blokkade (dubbele id's, geen
 * admin) zet de knop uit: een herstel is niet transactioneel en zou anders
 * halverwege stranden.
 */
export function HerstelPlanModal({ open, plan, labels, bezig, onClose, onBevestig }: {
  open: boolean;
  plan: HerstelPlan | null;
  labels: Record<string, string>;
  bezig: boolean;
  onClose: () => void;
  onBevestig: () => void;
}) {
  if (!plan) return null;
  const geblokkeerd = plan.blokkades.length > 0;
  const regels = plan.regels.filter((r) => r.inBackup);
  const ongemoeid = plan.regels.filter((r) => !r.inBackup).map((r) => labels[r.collectie] ?? r.collectie);
  // De server noemt een collectie bij haar sleutel ('users'); hier bij haar naam.
  const leesbaar = (tekst: string) => tekst.replace(/'(\w+)'/g, (heel, sleutel: string) => labels[sleutel] ?? heel);

  return (
    <Modal open={open} onClose={onClose} maxWidth="lg" ariaLabel="Back-up terugzetten" boven>
      <div className="flex max-h-overlay flex-col overflow-hidden">
        <div className="shrink-0 border-b border-hairline p-6 md:p-7">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/12 text-red-700">
            <AlertTriangle size={20} />
          </div>
          <h2 className="text-section-title">Back-up terugzetten?</h2>
          <p className="mt-1.5 text-body font-normal text-slate-500">
            {plan.exportedAt ? `Back-up van ${formatDateTimeHuman(plan.exportedAt)}. ` : ''}
            Dit is een droge run: er is nog niets gewijzigd. Hieronder staat wat het herstel zou doen.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 md:p-7">
          {geblokkeerd && (
            <div className="rounded-2xl bg-red-500/8 px-4 py-3 ring-1 ring-red-500/25" role="alert">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-700"><ShieldAlert size={16} /> Dit herstel kan niet doorgaan</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-body-sm text-red-700">
                {plan.blokkades.map((b) => <li key={b}>{leesbaar(b)}</li>)}
              </ul>
            </div>
          )}
          {plan.waarschuwingen.length > 0 && (
            <div className="rounded-2xl bg-amber-500/10 px-4 py-3 ring-1 ring-amber-500/25">
              <p className="text-sm font-semibold text-amber-800">Lees dit eerst</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-body-sm text-amber-800">
                {plan.waarschuwingen.map((w) => <li key={w}>{leesbaar(w)}</li>)}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl ring-1 ring-hairline">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <Th>Collectie</Th>
                  {/* Wat verdwijnt staat vooraan en de koppen zijn kort: op een
                      telefoon moet juist die kolom zonder scrollen in beeld. */}
                  <Th num>Weg</Th>
                  <Th num>Erbij</Th>
                  <Th num>Back-up</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-subtle">
                {regels.map((r) => (
                  <tr key={r.collectie}>
                    <Td>
                      {labels[r.collectie] ?? r.collectie}
                      {r.overgeslagen && <span className="block text-xs text-slate-500">leeg in de back-up, wordt overgeslagen</span>}
                    </Td>
                    <Td num className={r.weg > 0 ? 'font-semibold text-red-700' : undefined}>{r.weg}</Td>
                    <Td num>{r.erbij}</Td>
                    <Td num>{r.backup}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ongemoeid.length > 0 && (
            <div>
              <MicroLabel>Blijft ongemoeid</MicroLabel>
              <p className="mt-1 text-body-sm text-slate-500">Niet in deze back-up: {ongemoeid.join(', ')}.</p>
            </div>
          )}
          <p className="text-body-sm text-slate-500">
            Weg = staat nu in het portaal maar niet in de back-up, en verdwijnt dus. Erbij = komt terug uit de back-up.
            Een herstel kan niet ongedaan gemaakt worden. Maak desgewenst eerst een verse back-up.
          </p>
        </div>

        <div className="flex shrink-0 gap-2.5 border-t border-hairline p-5 md:p-6">
          <Button variant="secondary" size="lg" full onClick={onClose}>Annuleren</Button>
          <Button variant="dangerSolid" size="lg" full bezig={bezig} disabled={geblokkeerd || bezig} onClick={onBevestig}>
            Terugzetten
          </Button>
        </div>
      </div>
    </Modal>
  );
}
