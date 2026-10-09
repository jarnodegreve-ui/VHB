import { RotateCcw } from 'lucide-react';
import type { HeropbouwPlan, HeropbouwPlanDag } from '../../shared/heropbouwPlan';
import { aantal, formatDatumDMJ, formatPeriodeDMJ } from '../lib/format';
import { Modal } from './Modal';
import { Button, MicroLabel } from './primitives';
import { Callout } from './Callout';

/**
 * Bevestiging van "Planning opnieuw opbouwen", met de droge run erbij
 * (verbeterronde 09-10, punt 10, keuze Jarno): per chauffeur de dagen die
 * veranderen en wat hij nu heeft. Vroeger stond hier één zin ("handmatige
 * wijzigingen gaan verloren") en zag de planner pas achteraf wát er verdween.
 * Zelfde recept als HerstelPlanModal: eerst tonen, dan bevestigen.
 */
export type HeropbouwPlanStand =
  | { status: 'laden' }
  | { status: 'fout'; melding: string }
  | { status: 'geblokkeerd'; melding: string; unknownCodes: string[]; unmatchedDrivers: string[] }
  | { status: 'klaar'; plan: HeropbouwPlan };

const SOORT_LABEL: Record<HeropbouwPlanDag['soort'], string> = { erbij: 'erbij', weg: 'weg', gewijzigd: 'gewijzigd' };
const SOORT_TINT: Record<HeropbouwPlanDag['soort'], string> = { erbij: 'text-emerald-700', weg: 'text-red-700', gewijzigd: 'text-amber-700' };
/** Hoogstens zoveel dagen per chauffeur voluit; daarboven één regel "+n dagen". */
const DAGEN_VOLUIT = 6;

function DagRegel({ dag }: { dag: HeropbouwPlanDag }) {
  const was = dag.was.length > 0 ? dag.was.join(' en ') : 'niets';
  const wordt = dag.wordt.length > 0 ? dag.wordt.join(' en ') : 'niets';
  return (
    <li className="flex flex-col gap-0.5 py-2 text-body-sm sm:flex-row sm:gap-3">
      <span className="shrink-0 tabular-nums text-slate-500 sm:w-24">{formatDatumDMJ(dag.dag)}</span>
      <span className={`shrink-0 font-semibold sm:w-20 ${SOORT_TINT[dag.soort]}`}>{SOORT_LABEL[dag.soort]}</span>
      <span className="min-w-0 text-slate-700">
        {dag.soort === 'erbij' ? wordt : dag.soort === 'weg' ? was : `${was}, wordt ${wordt}`}
      </span>
    </li>
  );
}

export function HeropbouwPlanModal({ open, stand, bezig, onClose, onBevestig, onOpnieuw }: {
  open: boolean;
  stand: HeropbouwPlanStand | null;
  bezig: boolean;
  onClose: () => void;
  onBevestig: () => void | Promise<void>;
  onOpnieuw: () => void;
}) {
  if (!stand) return null;
  const plan = stand.status === 'klaar' ? stand.plan : null;
  const nietsTeDoen = plan !== null && plan.totaal.chauffeurs === 0;
  const kanBevestigen = plan !== null && !nietsTeDoen && !bezig;

  return (
    <Modal open={open} onClose={onClose} vast={bezig} maxWidth="lg" ariaLabel="Planning opnieuw opbouwen" boven>
      <div className="flex max-h-overlay flex-col overflow-hidden">
        <div className="shrink-0 border-b border-hairline p-6 md:p-7">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700">
            <RotateCcw size={20} />
          </div>
          <h2 className="text-section-title">Planning opnieuw opbouwen?</h2>
          <p className="mt-1.5 text-body font-normal text-slate-500">
            Dit is een droge run: er is nog niets gewijzigd. Hieronder staat wat de heropbouw uit de matrix en het dienstoverzicht zou veranderen.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 md:p-7">
          {stand.status === 'laden' && (
            <p className="text-body-sm text-slate-500" role="status">Berekenen wat er zou veranderen…</p>
          )}
          {stand.status === 'fout' && (
            <Callout tone="danger" title="De droge run is mislukt" role="alert" action={<Button variant="secondary" size="sm" onClick={onOpnieuw}>Opnieuw proberen</Button>}>
              {stand.melding}
            </Callout>
          )}
          {stand.status === 'geblokkeerd' && (
            <Callout tone="danger" title="Opnieuw opbouwen kan nu niet" role="alert">
              <p>{stand.melding}</p>
              {stand.unknownCodes.length > 0 && <p className="mt-1">Onbekende codes: {stand.unknownCodes.join(', ')}.</p>}
              {stand.unmatchedDrivers.length > 0 && <p className="mt-1">Niet-gematchte chauffeurs: {stand.unmatchedDrivers.join(', ')}.</p>}
            </Callout>
          )}
          {plan && (
            <>
              <p className="text-body-sm text-slate-500">
                {aantal(plan.diensten, 'dienst', 'diensten')} uit de matrix over {aantal(plan.dagenInMatrix, 'dag', 'dagen')}
                {plan.periode.van && plan.periode.tot ? ` (${formatPeriodeDMJ(plan.periode.van, plan.periode.tot)})` : ''},
                {' '}{aantal(plan.ruilen.toegepast, 'goedgekeurde ruil', 'goedgekeurde ruilen')} opnieuw doorgevoerd
                {plan.ruilen.nietToepasbaar > 0 ? `, ${plan.ruilen.nietToepasbaar} niet toepasbaar` : ''}.
              </p>
              {nietsTeDoen ? (
                <Callout tone="success" title="Niets te doen" role="status">
                  De planning is al gelijk aan de matrix en het dienstoverzicht. Opnieuw opbouwen verandert niets.
                </Callout>
              ) : (
                <>
                  <Callout tone="warning" title={`${aantal(plan.totaal.chauffeurs, 'chauffeur', 'chauffeurs')}, ${aantal(plan.totaal.dagen, 'dag', 'dagen')} veranderen`} role="status">
                    Wat hieronder staat komt uit de matrix en het dienstoverzicht. Wijzigingen die met de hand in de planning gezet zijn (een toewijzing, een wissel buiten een ruil) en hier als “weg” of “gewijzigd” staan, komen niet terug.
                  </Callout>
                  <ul className="divide-y divide-hairline-subtle rounded-2xl ring-1 ring-hairline">
                    {plan.chauffeurs.map((c) => (
                      <li key={c.id} className="px-4 py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-row-title">{c.naam}</span>
                          <MicroLabel>{aantal(c.dagen.length, 'dag', 'dagen')}</MicroLabel>
                        </div>
                        <ul className="mt-1 divide-y divide-hairline-subtle">
                          {c.dagen.slice(0, DAGEN_VOLUIT).map((d) => <DagRegel key={d.dag} dag={d} />)}
                          {c.dagen.length > DAGEN_VOLUIT && (
                            <li className="py-2 text-body-sm text-slate-500">+ {aantal(c.dagen.length - DAGEN_VOLUIT, 'dag', 'dagen')} meer</li>
                          )}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 gap-2.5 border-t border-hairline p-5 md:p-6">
          <Button variant="secondary" size="lg" full onClick={onClose} disabled={bezig}>{nietsTeDoen ? 'Sluiten' : 'Annuleren'}</Button>
          {!nietsTeDoen && (
            <Button variant="warning" size="lg" full bezig={bezig} disabled={!kanBevestigen} onClick={() => void onBevestig()}>
              Opnieuw opbouwen
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
