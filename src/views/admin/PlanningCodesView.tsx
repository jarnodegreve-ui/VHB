import { useEffect, useState } from 'react';
import { AlertTriangle, Bus, Calendar, FileText, Filter, Info, Plus, Settings, Trash2 } from 'lucide-react';
import type { PlanningCode, User } from '../../types';
import { cn, notify } from '../../lib/ui';
import { AdminPageHeader, AdminSubsectionHeader, EmptyState } from '../../components/ui';
import { StatCard } from '../../components/StatCard';

export function PlanningCodesView({ codes, onSave, canAdminDelete }: { codes: PlanningCode[]; onSave: (codes: PlanningCode[]) => Promise<boolean>; canAdminDelete: boolean }) {
  const [draftCodes, setDraftCodes] = useState<PlanningCode[]>(codes);
  const [isSaving, setIsSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | PlanningCode['category']>('all');

  useEffect(() => {
    setDraftCodes(codes);
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
      .map((code) => ({
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
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Planningsmatrix"
        title="Planningscodes"
        description="Beheer de betekenis van matrixcodes en bepaal welke codes als dienst, verlof of afwezigheid verwerkt mogen worden."
        actions={(
          <>
            <button onClick={addCode} className="glass-button rounded-[20px] px-5 py-3 text-sm font-black text-slate-800">
              <span className="inline-flex items-center gap-2"><Plus size={16} /> Code Toevoegen</span>
            </button>
            <button onClick={handleSave} disabled={isSaving} className="rounded-[20px] bg-oker-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-oker-500/20 transition hover:bg-oker-600 disabled:cursor-not-allowed disabled:opacity-60">
              {isSaving ? 'Opslaan...' : 'Opslaan'}
            </button>
          </>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={<FileText className="text-oker-600" />} label="Totaal" value={draftCodes.length.toString()} subValue="Actieve mappings" />
        <StatCard icon={<Bus className="text-slate-600" />} label="Diensten" value={summary.service.toString()} subValue="Codes met shiftstatus" />
        <StatCard icon={<Calendar className="text-emerald-600" />} label="Verlof" value={summary.leave.toString()} subValue="Afwezigheidsperiodes" />
        <StatCard icon={<AlertTriangle className="text-amber-600" />} label="Afwezigheid" value={summary.absence.toString()} subValue="Geen inzetbare dienst" />
        <StatCard icon={<Info className="text-sky-600" />} label="Onbekend" value={summary.unknown.toString()} subValue="Nog te verfijnen" />
      </div>

      <section className="surface-card rounded-[32px] p-6">
        <AdminSubsectionHeader
          eyebrow="Werkset"
          title="Codebeheer"
          description="Voeg matrixcodes toe, wijzig hun betekenis en bepaal of ze als dienst, verlof of afwezigheid tellen."
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{filteredCodes.length} zichtbaar</div>
              {!canAdminDelete ? (
                <div className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Delete admin-only</div>
              ) : null}
            </div>
          }
        />

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-[24px] border border-white/70 bg-white/45 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Filter</p>
            <div className="mt-3 glass segmented-control inline-flex p-1">
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
                    'rounded-[18px] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-all',
                    filter === option.key ? 'bg-white text-oker-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-[24px] border border-white/70 bg-white/45 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Interpretatie</p>
            <p className="mt-3 text-sm font-medium text-slate-500">
              Dienstcodes worden doorgegeven aan de roosteropbouw. Verlof-, afwezigheids- en opleidingscodes blijven buiten de dienstgeneratie.
            </p>
          </div>
        </div>

        <div className="mt-6 surface-table overflow-hidden rounded-[28px]">
          {filteredCodes.length > 0 ? (
            <>
              <div className="hidden xl:block overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="bg-slate-50/60">
                    <tr>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Code</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Categorie</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Beschrijving</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Dienst</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Betaald</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Vrij</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Acties</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCodes.map((code) => {
                      const index = draftCodes.findIndex((draft) => draft === code);
                      return (
                        <tr key={`${code.code || 'new'}-${index}`} className="hover:bg-white/55">
                          <td className="px-5 py-4">
                            <input
                              value={code.code}
                              onChange={(event) => updateCode(index, { code: event.target.value })}
                              className="control-input w-full rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-[0.16em]"
                              placeholder="bv"
                            />
                          </td>
                          <td className="px-5 py-4">
                            <select
                              value={code.category}
                              onChange={(event) => updateCode(index, { category: event.target.value as PlanningCode['category'] })}
                              className="control-input w-full rounded-2xl px-4 py-3 text-sm font-bold"
                            >
                              <option value="service">Dienst</option>
                              <option value="absence">Afwezigheid</option>
                              <option value="leave">Verlof</option>
                              <option value="training">Opleiding</option>
                              <option value="unknown">Onbekend</option>
                            </select>
                          </td>
                          <td className="px-5 py-4">
                            <input
                              value={code.description}
                              onChange={(event) => updateCode(index, { description: event.target.value })}
                              className="control-input w-full rounded-2xl px-4 py-3 text-sm font-medium"
                              placeholder="Beschrijving"
                            />
                          </td>
                          <td className="px-5 py-4">
                            <label className="flex items-center justify-center">
                              <input type="checkbox" checked={code.countsAsShift} onChange={(event) => updateCode(index, { countsAsShift: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                            </label>
                          </td>
                          <td className="px-5 py-4">
                            <label className="flex items-center justify-center">
                              <input type="checkbox" checked={code.isPaidAbsence} onChange={(event) => updateCode(index, { isPaidAbsence: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                            </label>
                          </td>
                          <td className="px-5 py-4">
                            <label className="flex items-center justify-center">
                              <input type="checkbox" checked={code.isDayOff} onChange={(event) => updateCode(index, { isDayOff: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                            </label>
                          </td>
                          <td className="px-5 py-4">
                            {canAdminDelete ? (
                              <button onClick={() => removeCode(index)} className="glass-button rounded-2xl p-3 text-red-500 hover:text-red-600" aria-label="Verwijder code">
                                <Trash2 size={16} />
                              </button>
                            ) : (
                              <span className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-300">
                                Admin
                              </span>
                            )}
                          </td>
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
                    <div key={`${code.code || 'new-mobile'}-${index}`} className="space-y-4 p-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <input
                          value={code.code}
                          onChange={(event) => updateCode(index, { code: event.target.value })}
                          className="control-input rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-[0.16em]"
                          placeholder="Code"
                        />
                        <select
                          value={code.category}
                          onChange={(event) => updateCode(index, { category: event.target.value as PlanningCode['category'] })}
                          className="control-input rounded-2xl px-4 py-3 text-sm font-bold"
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
                        className="control-input w-full rounded-2xl px-4 py-3 text-sm font-medium"
                        placeholder="Beschrijving"
                      />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="glass-chip flex items-center justify-between rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                          Dienst
                          <input type="checkbox" checked={code.countsAsShift} onChange={(event) => updateCode(index, { countsAsShift: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                        </label>
                        <label className="glass-chip flex items-center justify-between rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                          Betaald
                          <input type="checkbox" checked={code.isPaidAbsence} onChange={(event) => updateCode(index, { isPaidAbsence: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                        </label>
                        <label className="glass-chip flex items-center justify-between rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                          Vrij
                          <input type="checkbox" checked={code.isDayOff} onChange={(event) => updateCode(index, { isDayOff: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                        </label>
                      </div>
                      {canAdminDelete ? (
                        <button onClick={() => removeCode(index)} className="glass-button rounded-2xl px-4 py-3 text-sm font-black text-red-500 hover:text-red-600">
                          Verwijder Code
                        </button>
                      ) : (
                        <div className="rounded-2xl border border-white/70 bg-white/55 px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-300">
                          Verwijderen admin-only
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="p-8">
              <EmptyState
                icon={<Settings size={28} />}
                title="Nog geen planningscodes"
                message="Voeg hier de eerste matrixcodes toe zodat planners en admins hun betekenis centraal kunnen beheren."
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

type UserDraft = User & { password?: string };


