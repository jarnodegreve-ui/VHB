import { useEffect, useState } from 'react';
import { AlertTriangle, Bus, Calendar, FileText, History, Info, Plus, Settings, Trash2 } from 'lucide-react';
import type { PlanningCode } from '../../types';
import { cn, notify } from '../../lib/ui';
import { AdminSubsectionHeader, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, MicroLabel, TableShell, Td, Th } from '../../components/primitives';
import { StatCard } from '../../components/StatCard';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';

// Draft-rijen krijgen een stabiele key, los van de (bewerkbare) code-tekst.
// De oude key bevatte code.code: elke toetsaanslag = nieuwe key = remount =
// focusverlies na élke letter.
type DraftCode = PlanningCode & { _key: string };
const makeDraftKey = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `k-${Math.random().toString(36).slice(2)}`;
const withDraftKeys = (codes: PlanningCode[]): DraftCode[] =>
  codes.map((code) => ({ ...code, _key: makeDraftKey() }));

export function PlanningCodesView({ codes, onSave, canAdminDelete }: { codes: PlanningCode[]; onSave: (codes: PlanningCode[]) => Promise<boolean>; canAdminDelete: boolean }) {
  const [draftCodes, setDraftCodes] = useState<DraftCode[]>(() => withDraftKeys(codes));
  const [isSaving, setIsSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | PlanningCode['category']>('all');
  const [historyCode, setHistoryCode] = useState<PlanningCode | null>(null);

  useEffect(() => {
    setDraftCodes(withDraftKeys(codes));
  }, [codes]);

  const updateCode = (index: number, patch: Partial<PlanningCode>) => {
    setDraftCodes((current) => current.map((code, currentIndex) => (
      currentIndex === index ? { ...code, ...patch } : code
    )));
  };

  const addCode = () => {
    setDraftCodes((current) => [
      ...current,
      {
        _key: makeDraftKey(),
        code: '',
        category: 'unknown',
        description: '',
        countsAsShift: false,
        isPaidAbsence: false,
        isDayOff: false,
      },
    ]);
  };

  const removeCode = (index: number) => {
    if (!canAdminDelete) {
      notify('Codes verwijderen is alleen beschikbaar voor admins.', 'error');
      return;
    }
    setDraftCodes((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleSave = async () => {
    const normalizedCodes = draftCodes
      .map(({ _key, ...code }) => ({
        ...code,
        code: code.code.trim().toLowerCase(),
        description: code.description.trim(),
      }))
      .filter((code) => code.code.length > 0);

    const duplicateCodes = normalizedCodes.filter((code, index) => normalizedCodes.findIndex((item) => item.code === code.code) !== index);
    if (duplicateCodes.length > 0) {
      notify(`Code ${duplicateCodes[0].code} komt meerdere keren voor.`, 'error');
      return;
    }

    setIsSaving(true);
    await onSave(normalizedCodes);
    setIsSaving(false);
  };

  const filteredCodes = draftCodes
    .filter((code) => filter === 'all' || code.category === filter)
    .sort((a, b) => a.code.localeCompare(b.code));

  const summary = {
    service: draftCodes.filter((code) => code.category === 'service').length,
    absence: draftCodes.filter((code) => code.category === 'absence').length,
    leave: draftCodes.filter((code) => code.category === 'leave').length,
    training: draftCodes.filter((code) => code.category === 'training').length,
    unknown: draftCodes.filter((code) => code.category === 'unknown').length,
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Planningsmatrix"
        title="Planningscodes"
        description="Beheer de betekenis van matrixcodes en bepaal welke codes als dienst, verlof of afwezigheid verwerkt mogen worden."
        actions={(
          <>
            <Button variant="secondary" size="lg" icon={<Plus size={16} />} onClick={addCode}>
              Code Toevoegen
            </Button>
            <Button variant="primary" size="lg" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={<FileText className="text-oker-600" />} label="Totaal" value={draftCodes.length.toString()} subValue="Actieve mappings" />
        <StatCard icon={<Bus className="text-slate-600" />} label="Diensten" value={summary.service.toString()} subValue="Codes met shiftstatus" />
        <StatCard icon={<Calendar className="text-emerald-600" />} label="Verlof" value={summary.leave.toString()} subValue="Afwezigheidsperiodes" />
        <StatCard icon={<AlertTriangle className="text-amber-600" />} label="Afwezigheid" value={summary.absence.toString()} subValue="Geen inzetbare dienst" />
        <StatCard icon={<Info className="text-amber-500" />} label="Onbekend" value={summary.unknown.toString()} subValue="Nog te verfijnen" />
      </div>

      <section className="surface-card rounded-3xl p-6">
        <AdminSubsectionHeader
          eyebrow="Werkset"
          title="Codebeheer"
          description="Voeg matrixcodes toe, wijzig hun betekenis en bepaal of ze als dienst, verlof of afwezigheid tellen."
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="slate">{filteredCodes.length} zichtbaar</Badge>
              {!canAdminDelete ? (
                <Badge tone="slate">Delete admin-only</Badge>
              ) : null}
            </div>
          }
        />

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-2xl border border-slate-100 bg-white/50 p-4">
            <MicroLabel>Filter</MicroLabel>
            <div className="mt-3 glass-segmented rounded-2xl inline-flex p-1">
              {[
                { key: 'all', label: 'Alles' },
                { key: 'service', label: 'Dienst' },
                { key: 'leave', label: 'Verlof' },
                { key: 'absence', label: 'Afwezig' },
                { key: 'training', label: 'Opleiding' },
                { key: 'unknown', label: 'Onbekend' },
              ].map((option) => (
                <button
                  key={option.key}
                  onClick={() => setFilter(option.key as 'all' | PlanningCode['category'])}
                  className={cn(
                    'rounded-xl px-4 py-2 text-xs font-semibold transition-all',
                    filter === option.key ? 'bg-white text-oker-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white/50 p-4">
            <MicroLabel>Interpretatie</MicroLabel>
            <p className="mt-3 text-sm font-medium text-slate-500">
              Dienstcodes worden doorgegeven aan de roosteropbouw. Verlof-, afwezigheids- en opleidingscodes blijven buiten de dienstgeneratie.
            </p>
          </div>
        </div>

        <TableShell className="mt-6">
          {filteredCodes.length > 0 ? (
            <>
              <div className="hidden xl:block">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="bg-slate-50/60">
                    <tr>
                      <Th>Code</Th>
                      <Th>Categorie</Th>
                      <Th>Beschrijving</Th>
                      <Th>Dienst</Th>
                      <Th>Betaald</Th>
                      <Th>Vrij</Th>
                      <Th>Acties</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCodes.map((code) => {
                      const index = draftCodes.findIndex((draft) => draft === code);
                      return (
                        <tr key={code._key} className="hover:bg-slate-50/60 transition-colors">
                          <Td>
                            <input
                              value={code.code}
                              onChange={(event) => updateCode(index, { code: event.target.value })}
                              className="control-input w-full rounded-xl px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.08em]"
                              placeholder="bv"
                            />
                          </Td>
                          <Td>
                            <select
                              value={code.category}
                              onChange={(event) => updateCode(index, { category: event.target.value as PlanningCode['category'] })}
                              className="control-input w-full rounded-xl px-3 py-2.5 text-sm font-medium"
                            >
                              <option value="service">Dienst</option>
                              <option value="absence">Afwezigheid</option>
                              <option value="leave">Verlof</option>
                              <option value="training">Opleiding</option>
                              <option value="unknown">Onbekend</option>
                            </select>
                          </Td>
                          <Td>
                            <input
                              value={code.description}
                              onChange={(event) => updateCode(index, { description: event.target.value })}
                              className="control-input w-full rounded-xl px-3 py-2.5 text-sm font-medium"
                              placeholder="Beschrijving"
                            />
                          </Td>
                          <Td>
                            <label className="flex items-center justify-center">
                              <input type="checkbox" checked={code.countsAsShift} onChange={(event) => updateCode(index, { countsAsShift: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                            </label>
                          </Td>
                          <Td>
                            <label className="flex items-center justify-center">
                              <input type="checkbox" checked={code.isPaidAbsence} onChange={(event) => updateCode(index, { isPaidAbsence: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                            </label>
                          </Td>
                          <Td>
                            <label className="flex items-center justify-center">
                              <input type="checkbox" checked={code.isDayOff} onChange={(event) => updateCode(index, { isDayOff: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                            </label>
                          </Td>
                          <Td>
                            <div className="flex items-center justify-end gap-1">
                              {code.code && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setHistoryCode(code)}
                                  title="Wijzigingsgeschiedenis"
                                  aria-label="Wijzigingsgeschiedenis"
                                  icon={<History size={15} />}
                                />
                              )}
                              {canAdminDelete ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeCode(index)}
                                  aria-label="Verwijder code"
                                  className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                  icon={<Trash2 size={15} />}
                                />
                              ) : (
                                <Badge tone="slate">Admin</Badge>
                              )}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 xl:hidden">
                {filteredCodes.map((code) => {
                  const index = draftCodes.findIndex((draft) => draft === code);
                  return (
                    <div key={code._key} className="space-y-4 p-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <input
                          value={code.code}
                          onChange={(event) => updateCode(index, { code: event.target.value })}
                          className="control-input rounded-xl px-3 py-2.5 text-sm font-semibold uppercase tracking-[0.08em]"
                          placeholder="Code"
                        />
                        <select
                          value={code.category}
                          onChange={(event) => updateCode(index, { category: event.target.value as PlanningCode['category'] })}
                          className="control-input rounded-xl px-3 py-2.5 text-sm font-medium"
                        >
                          <option value="service">Dienst</option>
                          <option value="absence">Afwezigheid</option>
                          <option value="leave">Verlof</option>
                          <option value="training">Opleiding</option>
                          <option value="unknown">Onbekend</option>
                        </select>
                      </div>
                      <input
                        value={code.description}
                        onChange={(event) => updateCode(index, { description: event.target.value })}
                        className="control-input w-full rounded-xl px-3 py-2.5 text-sm font-medium"
                        placeholder="Beschrijving"
                      />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-xs font-semibold text-slate-600">
                          Dienst
                          <input type="checkbox" checked={code.countsAsShift} onChange={(event) => updateCode(index, { countsAsShift: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-xs font-semibold text-slate-600">
                          Betaald
                          <input type="checkbox" checked={code.isPaidAbsence} onChange={(event) => updateCode(index, { isPaidAbsence: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-xs font-semibold text-slate-600">
                          Vrij
                          <input type="checkbox" checked={code.isDayOff} onChange={(event) => updateCode(index, { isDayOff: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                        </label>
                      </div>
                      {canAdminDelete ? (
                        <Button variant="danger" size="md" icon={<Trash2 size={15} />} onClick={() => removeCode(index)}>
                          Verwijder Code
                        </Button>
                      ) : (
                        <Badge tone="slate">Verwijderen admin-only</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="p-6">
              <EmptyState
                icon={<Settings size={28} />}
                title="Nog geen planningscodes"
                message="Voeg hier de eerste matrixcodes toe zodat planners en admins hun betekenis centraal kunnen beheren."
              />
            </div>
          )}
        </TableShell>
      </section>

      <EntityHistoryModal
        open={!!historyCode}
        onClose={() => setHistoryCode(null)}
        entityType="planning_code"
        entityId={historyCode?.code ?? ''}
        title={historyCode ? `Code ${historyCode.code}` : undefined}
      />
    </PageShell>
  );
}


