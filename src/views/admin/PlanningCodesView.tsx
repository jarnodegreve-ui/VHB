import { useEffect, useState } from 'react';
import { AlertTriangle, Bus, Calendar, History, Info, Plus, Settings, Trash2 } from 'lucide-react';
import type { PlanningCode } from '../../types';
import { notify } from '../../lib/ui';
import { metOngedaan } from '../../lib/ongedaan';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, IconButton, segItemClass, TableShell, Td, Th } from '../../components/primitives';
import { Card, CardHeader } from '../../components/Card';
import { Input, Select } from '../../components/Field';
import { Checkbox } from '../../components/Table';
import { InfoTip } from '../../components/InfoTip';
import { OpsStat } from '../../components/ops';
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

const CATEGORIE_OPTIES: Array<{ value: PlanningCode['category']; label: string }> = [
  { value: 'service', label: 'Dienst' },
  { value: 'absence', label: 'Afwezigheid' },
  { value: 'leave', label: 'Verlof' },
  { value: 'training', label: 'Opleiding' },
  { value: 'unknown', label: 'Onbekend' },
];

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

  // Verwijderen gaat meteen uit de conceptlijst (definitief pas bij opslaan);
  // de toast biedt 6 s "Ongedaan maken" = de rij op dezelfde plek terugzetten.
  // Op de sleutel i.p.v. de index, zodat een tussentijdse sortering of
  // toevoeging nooit de verkeerde rij raakt.
  const requestRemove = (code: DraftCode) => {
    if (!canAdminDelete) {
      notify('Codes verwijderen is alleen beschikbaar voor admins.', 'error');
      return;
    }
    const index = draftCodes.findIndex((c) => c._key === code._key);
    void metOngedaan({
      boodschap: `${code.code ? `Code ${code.code.toUpperCase()}` : 'Lege rij'} verwijderd — definitief zodra je opslaat.`,
      uitvoeren: () => { setDraftCodes((current) => current.filter((c) => c._key !== code._key)); },
      herstellen: () => {
        setDraftCodes((current) => (
          current.some((c) => c._key === code._key)
            ? current
            : [...current.slice(0, index), code, ...current.slice(index)]
        ));
      },
      toast: (message, tone, action, opties) => notify(message, tone, { action, opties }),
    });
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

  const uitleg = (
    <InfoTip label="Uitleg bij de kolommen" align="right">
      <p>Een matrixcode is wat in de Excel-cel staat (bv. <span className="font-mono">bv</span>, <span className="font-mono">z</span>). De categorie bepaalt hoe het portaal ermee omgaat.</p>
      <p className="mt-2"><span className="font-semibold text-slate-700">Dienst</span>: telt als gewerkte dag. <span className="font-semibold text-slate-700">Betaald</span>: betaalde afwezigheid (verlofsaldo). <span className="font-semibold text-slate-700">Vrij</span>: vrije dag, geen inzet verwacht.</p>
      <p className="mt-2">Wijzigingen gelden pas na Opslaan.</p>
    </InfoTip>
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Planning"
        title="Planningscodes"
        description="De betekenis van matrixcodes: welke tellen als dienst, verlof of afwezigheid."
        actions={(
          <>
            <Button variant="secondary" icon={<Plus size={16} />} onClick={addCode}>
              Code toevoegen
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Opslaan…' : 'Opslaan'}
            </Button>
          </>
        )}
      />

      {/* 4 tegels → gat-vrij op elke breedte (mobiel 2×2, breed 4 op een
          rij). "Totaal" staat al als teller bij de tabel. OpsStat i.p.v.
          StatCard (vaste regel voor KPI-strips). */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <OpsStat icon={<Bus size={16} />} tone="slate" label="Diensten" value={summary.service} sub="tellen als dienst" />
        <OpsStat icon={<Calendar size={16} />} tone="emerald" label="Verlof" value={summary.leave} sub="betaalde afwezigheid" />
        <OpsStat icon={<AlertTriangle size={16} />} tone="amber" label="Afwezigheid" value={summary.absence} sub="niet inzetbaar" />
        <OpsStat icon={<Info size={16} />} tone={summary.unknown > 0 ? 'amber' : 'slate'} label="Onbekend" value={summary.unknown} sub="nog te verfijnen" />
      </div>

      <Card as="section">
        <CardHeader
          title="Codes"
          aside={(
            <>
              <Badge tone="slate" className="tabular-nums">{filteredCodes.length} zichtbaar</Badge>
              {!canAdminDelete ? <Badge tone="slate">Verwijderen: alleen admin</Badge> : null}
              {uitleg}
            </>
          )}
        />

        {/* Eén rustige filterbalk — wat de categorieën betekenen staat in de
            uitleg-popover. */}
        <div className="mt-4 glass-segmented rounded-2xl inline-flex flex-wrap p-1">
          {[
            { key: 'all', label: 'Alles' },
            { key: 'service', label: 'Dienst' },
            { key: 'leave', label: 'Verlof' },
            { key: 'absence', label: 'Afwezig' },
            { key: 'training', label: 'Opleiding' },
            { key: 'unknown', label: 'Onbekend' },
          ].map((option) => (
            // rauw: segmented control op de glass-rail, klassen via segItemClass
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key as 'all' | PlanningCode['category'])}
              className={segItemClass(filter === option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <TableShell className="mt-5">
          {filteredCodes.length > 0 ? (
            <>
              <div className="hidden xl:block">
                <table className="w-full table-fixed text-left">
                  <thead className="bg-slate-50/60">
                    <tr>
                      {/* Checkbox-kolommen: header gecentreerd boven de
                          (gecentreerde) checkbox; Acties rechts uitgelijnd
                          zoals de knoppen eronder. */}
                      <Th className="w-24">Code</Th>
                      <Th className="w-36">Categorie</Th>
                      <Th>Beschrijving</Th>
                      <Th className="w-16 text-center">Dienst</Th>
                      <Th className="w-16 text-center">Betaald</Th>
                      <Th className="w-14 text-center">Vrij</Th>
                      <Th className="w-20 text-right">Acties</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCodes.map((code) => {
                      const index = draftCodes.findIndex((draft) => draft === code);
                      return (
                        <tr key={code._key} className="hover:bg-slate-50/60 transition-colors">
                          <Td>
                            <Input
                              aria-label="Code"
                              value={code.code}
                              onChange={(event) => updateCode(index, { code: event.target.value })}
                              className="min-w-0 px-2.5 font-semibold uppercase tracking-[0.08em]"
                              placeholder="bv"
                            />
                          </Td>
                          <Td>
                            <Select
                              aria-label="Categorie"
                              value={code.category}
                              onChange={(event) => updateCode(index, { category: event.target.value as PlanningCode['category'] })}
                              className="min-w-0 px-2.5"
                            >
                              {CATEGORIE_OPTIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                          </Td>
                          <Td>
                            <Input
                              aria-label="Beschrijving"
                              value={code.description}
                              onChange={(event) => updateCode(index, { description: event.target.value })}
                              className="min-w-0 px-2.5"
                              placeholder="Beschrijving"
                            />
                          </Td>
                          <Td className="text-center">
                            <Checkbox label="Telt als dienst" checked={code.countsAsShift} onChange={(v) => updateCode(index, { countsAsShift: v })} />
                          </Td>
                          <Td className="text-center">
                            <Checkbox label="Betaalde afwezigheid" checked={code.isPaidAbsence} onChange={(v) => updateCode(index, { isPaidAbsence: v })} />
                          </Td>
                          <Td className="text-center">
                            <Checkbox label="Vrije dag" checked={code.isDayOff} onChange={(v) => updateCode(index, { isDayOff: v })} />
                          </Td>
                          <Td>
                            <div className="flex items-center justify-end gap-1">
                              {code.code && (
                                <IconButton label="Wijzigingsgeschiedenis" variant="ghost" size="sm" onClick={() => setHistoryCode(code)}>
                                  <History size={16} />
                                </IconButton>
                              )}
                              {canAdminDelete ? (
                                <IconButton label="Verwijder code" variant="danger" size="sm" onClick={() => requestRemove(code)}>
                                  <Trash2 size={16} />
                                </IconButton>
                              ) : null}
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
                        <Input
                          aria-label="Code"
                          value={code.code}
                          onChange={(event) => updateCode(index, { code: event.target.value })}
                          className="font-semibold uppercase tracking-[0.08em]"
                          placeholder="Code"
                        />
                        <Select
                          aria-label="Categorie"
                          value={code.category}
                          onChange={(event) => updateCode(index, { category: event.target.value as PlanningCode['category'] })}
                        >
                          {CATEGORIE_OPTIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      </div>
                      <Input
                        aria-label="Beschrijving"
                        value={code.description}
                        onChange={(event) => updateCode(index, { description: event.target.value })}
                        className="min-w-0"
                        placeholder="Beschrijving"
                      />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-surface-row px-4 py-1.5 text-xs font-semibold text-slate-600">
                          Dienst
                          <Checkbox label="Telt als dienst" checked={code.countsAsShift} onChange={(v) => updateCode(index, { countsAsShift: v })} />
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-surface-row px-4 py-1.5 text-xs font-semibold text-slate-600">
                          Betaald
                          <Checkbox label="Betaalde afwezigheid" checked={code.isPaidAbsence} onChange={(v) => updateCode(index, { isPaidAbsence: v })} />
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-surface-row px-4 py-1.5 text-xs font-semibold text-slate-600">
                          Vrij
                          <Checkbox label="Vrije dag" checked={code.isDayOff} onChange={(v) => updateCode(index, { isDayOff: v })} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {code.code && (
                          <Button variant="ghost" size="sm" icon={<History size={14} />} onClick={() => setHistoryCode(code)}>
                            Geschiedenis
                          </Button>
                        )}
                        {canAdminDelete ? (
                          <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => requestRemove(code)}>
                            Verwijder code
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="p-6">
              <EmptyState
                icon={<Settings size={24} />}
                title="Nog geen planningscodes"
                message="Voeg de eerste matrixcodes toe zodat planners en admins hun betekenis centraal beheren."
                action={<Button variant="secondary" icon={<Plus size={16} />} onClick={addCode}>Code toevoegen</Button>}
              />
            </div>
          )}
        </TableShell>
      </Card>

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
