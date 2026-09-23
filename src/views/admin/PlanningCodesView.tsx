import { useEffect, useMemo, useRef, useState } from 'react';
import { AanwezigOpScherm } from '../../components/AanwezigOpScherm';
import { History, Plus, Trash2 } from 'lucide-react';
import type { PlanningCode } from '../../types';
import { notify } from '../../lib/ui';
import { metOngedaan } from '../../lib/ongedaan';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, IconButton, Segmented } from '../../components/primitives';
import { Card, CardHeader } from '../../components/Card';
import { Input, Select } from '../../components/Field';
import { Checkbox, StickyThead } from '../../components/Table';
import { Tabel, TableShell, Td, Th } from '../../components/TabelBasis';
import { InfoTip } from '../../components/InfoTip';
import { Zijvak, ZijvakLayout, ZijvakRij } from '../../components/Zijvak';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';
import { focusEersteFout } from '../../components/Formulier';
import { useVeldfouten, useVerlaatWaarschuwing } from '../../lib/formulier';

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

const zonderSleutels = (draft: DraftCode[]): PlanningCode[] => draft.map(({ _key, ...code }) => code);

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

  // Onbewaarde wijzigingen (tranche 3A): het concept wijkt af van de codes
  // waaruit het is opgebouwd (`basis`). Niet rechtstreeks tegen `codes`: een
  // refetch mag die veranderen zonder dat de gebruiker iets deed.
  const [basis, setBasis] = useState<PlanningCode[]>(codes);
  const vuil = useMemo(() => JSON.stringify(zonderSleutels(draftCodes)) !== JSON.stringify(basis), [draftCodes, basis]);
  useVerlaatWaarschuwing(vuil);
  // Per-rij-fouten, sleutel `${index}.code` (index in draftCodes).
  const fouten = useVeldfouten();
  const lijstRef = useRef<HTMLDivElement>(null);
  const kaartRef = useRef<HTMLDivElement>(null);

  // Nieuwe codes van de server (refetch, realtime, eigen save) overschrijven
  // het concept alleen als er niets onbewaards in staat; anders zou een
  // refetch halverwege het bewerken alles wissen.
  useEffect(() => {
    if (vuil) return;
    setDraftCodes(withDraftKeys(codes));
    setBasis(codes);
    // Bewust alleen op `codes`: vuil en basis zijn die van deze render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes]);

  const updateCode = (index: number, patch: Partial<PlanningCode>) => {
    setDraftCodes((current) => current.map((code, currentIndex) => (
      currentIndex === index ? { ...code, ...patch } : code
    )));
    if ('code' in patch) fouten.wisVeld(`${index}.code`);
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
      boodschap: `${code.code ? `Code ${code.code.toUpperCase()}` : 'Lege rij'} verwijderd, definitief zodra je opslaat.`,
      // Indexen schuiven op: rij-fouten gelden dan niet meer.
      uitvoeren: () => { setDraftCodes((current) => current.filter((c) => c._key !== code._key)); fouten.wis(); },
      herstellen: () => {
        setDraftCodes((current) => (
          current.some((c) => c._key === code._key)
            ? current
            : [...current.slice(0, index), code, ...current.slice(index)]
        ));
        fouten.wis();
      },
      toast: (message, tone, action, opties) => notify(message, tone, { action, opties }),
    });
  };

  const handleSave = async () => {
    if (isSaving) return;
    const normalized = draftCodes.map(({ _key, ...code }) => ({
      ...code,
      code: code.code.trim().toLowerCase(),
      description: code.description.trim(),
    }));
    const normalizedCodes = normalized.filter((code) => code.code.length > 0);

    // Dubbele code: fout bij de code-invoer van elke latere rij met dezelfde
    // code (index in draftCodes), en de focus naar de eerste daarvan.
    const dubbel: Record<string, string> = {};
    normalized.forEach((code, index) => {
      if (code.code && normalized.findIndex((item) => item.code === code.code) !== index) {
        dubbel[`${index}.code`] = `Code ${code.code} komt meerdere keren voor.`;
      }
    });
    if (Object.keys(dubbel).length > 0) {
      fouten.zet(dubbel);
      // Een weggefilterde rij kan zijn fout niet tonen: dan terug naar Alles.
      const verborgen = Object.keys(dubbel).some((k) => {
        const rij = draftCodes[Number(k.split('.')[0])];
        return filter !== 'all' && rij?.category !== filter;
      });
      if (verborgen) setFilter('all');
      // Na de render (fouten en filter staan dan in de DOM); de tabel en de
      // kaartenlijst staan er allebei, alleen één is zichtbaar.
      window.setTimeout(() => {
        const zichtbaar = [lijstRef.current, kaartRef.current].find((el) => el && el.offsetParent !== null);
        focusEersteFout(zichtbaar ?? lijstRef.current);
      }, 0);
      return;
    }
    fouten.wis();

    setIsSaving(true);
    try {
      const ok = await onSave(normalizedCodes);
      if (ok) {
        // Het bewaarde concept is de nieuwe basis; een latere refetch van
        // de server overschrijft het dan weer gewoon.
        setDraftCodes(withDraftKeys(normalizedCodes));
        setBasis(normalizedCodes);
      }
    } finally {
      setIsSaving(false);
    }
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
        view="planning-codes"
        title="Planningscodes"
        actions={(
          <>
            <AanwezigOpScherm />
            <Button variant="secondary" icon={<Plus size={16} />} onClick={addCode}>
              Code toevoegen
            </Button>
            <Button variant="primary" onClick={handleSave} bezig={isSaving}>
              Opslaan
            </Button>
          </>
        )}
      />

      {/* Desktop: codelijst als hoofdkolom, de tellers per categorie in het
          zijvak (afwerkingsronde 04-09) — de vier KPI-tegels rekten de
          mobiele stapel uit tot één brede strook. */}
      <ZijvakLayout
        breekpunt="xl"
        zijvak={(
          <Zijvak
            titel="Overzicht"
            voet={summary.unknown > 0
              ? `${summary.unknown} ${summary.unknown === 1 ? 'code staat' : 'codes staan'} nog op Onbekend, kies een categorie zodat het portaal er iets mee kan.`
              : 'Wijzigingen gelden pas na Opslaan.'}
          >
            <ZijvakRij label="Diensten" waarde={summary.service} />
            <ZijvakRij label="Verlof" waarde={summary.leave} />
            <ZijvakRij label="Afwezigheid" waarde={summary.absence} />
            <ZijvakRij label="Onbekend" waarde={summary.unknown} />
            <ZijvakRij label="Totaal" waarde={draftCodes.length} />
          </Zijvak>
        )}
      >
      {/* Nog geen enkele code: de hoofdleegte van het scherm staat zelf,
          niet als doos in de tabel in de kaart (P3). */}
      {draftCodes.length === 0 ? (
        <EmptyState
          title="Nog geen planningscodes"
          message="Voeg de eerste matrixcodes toe zodat planners en admins hun betekenis centraal beheren."
          action={<Button variant="secondary" icon={<Plus size={16} />} onClick={addCode}>Code toevoegen</Button>}
        />
      ) : (
      <Card as="section">
        <CardHeader
          title="Codes"
          aside={(
            <>
              <Badge tone="slate">{filteredCodes.length} zichtbaar</Badge>
              {!canAdminDelete ? <Badge tone="slate">Verwijderen: alleen admin</Badge> : null}
              {uitleg}
            </>
          )}
        />

        {/* Eén rustige filterbalk — wat de categorieën betekenen staat in de
            uitleg-popover. */}
        <Segmented<'all' | PlanningCode['category']>
          label="Categorie"
          telefoon="schuif"
          className="mt-4"
          waarde={filter}
          opties={[
            { waarde: 'all', label: 'Alles' },
            { waarde: 'service', label: 'Dienst' },
            { waarde: 'leave', label: 'Verlof' },
            { waarde: 'absence', label: 'Afwezig' },
            { waarde: 'training', label: 'Opleiding' },
            { waarde: 'unknown', label: 'Onbekend' },
          ]}
          onChange={setFilter}
        />

        {/* Tabel of kaart per code volgt de breedte van dit kader (container
            query, bewust geen md of xl): elke rij is een bewerkbaar formulier
            met vaste kolommen van samen 30,5 rem, en de beschrijving heeft er
            minstens 5,5 rem naast nodig (rem schaalt mee met de wortelmaat). Welke schermbreedte dat is hangt af van de
            zijbalk en het zijvak ernaast: op 1280 px bleef er met xl nog geen
            pixel voor de beschrijving over (tranche 3B, gemeten). `past`: het
            raster verschijnt pas als het past, dus geen scrollcontainer en de
            kolomkop plakt onder de topbar. */}
        <TableShell className="mt-5 @container" label="Planningscodes" past>
          {filteredCodes.length > 0 ? (
            <>
              <div ref={lijstRef} className="hidden @[36rem]:block">
                <Tabel className="table-fixed">
                  <StickyThead>
                    <tr>
                      {/* Checkbox-kolommen: header gecentreerd boven de
                          (gecentreerde) checkbox; Acties rechts uitgelijnd
                          zoals de knoppen eronder. */}
                      <Th className="w-20">Code</Th>
                      <Th className="w-36">Categorie</Th>
                      <Th>Beschrijving</Th>
                      <Th className="w-16 text-center">Dienst</Th>
                      <Th className="w-16 text-center">Betaald</Th>
                      <Th className="w-14 text-center">Vrij</Th>
                      <Th className="w-20 text-right">Acties</Th>
                    </tr>
                  </StickyThead>
                  <tbody className="divide-y divide-hairline-subtle">
                    {filteredCodes.map((code) => {
                      const index = draftCodes.findIndex((draft) => draft === code);
                      return (
                        <tr key={code._key} className="hover:bg-surface-soft-hover transition-colors">
                          <Td>
                            <Input
                              aria-label="Code"
                              invalid={!!fouten.fouten[`${index}.code`]}
                              aria-describedby={fouten.fouten[`${index}.code`] ? `code-fout-${code._key}` : undefined}
                              value={code.code}
                              onChange={(event) => updateCode(index, { code: event.target.value })}
                              className="min-w-0 px-2.5 font-semibold uppercase tracking-[0.08em]"
                              placeholder="bv"
                            />
                            {fouten.fouten[`${index}.code`] ? <p id={`code-fout-${code._key}`} role="alert" className="mt-1 text-xs font-medium text-red-700">{fouten.fouten[`${index}.code`]}</p> : null}
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
                </Tabel>
              </div>

              <div ref={kaartRef} className="divide-y divide-hairline-subtle @[36rem]:hidden">
                {filteredCodes.map((code) => {
                  const index = draftCodes.findIndex((draft) => draft === code);
                  return (
                    <div key={code._key} className="space-y-4 p-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Input
                            aria-label="Code"
                            invalid={!!fouten.fouten[`${index}.code`]}
                            aria-describedby={fouten.fouten[`${index}.code`] ? `code-fout-kaart-${code._key}` : undefined}
                            value={code.code}
                            onChange={(event) => updateCode(index, { code: event.target.value })}
                            className="font-semibold uppercase tracking-[0.08em]"
                            placeholder="Code"
                          />
                          {fouten.fouten[`${index}.code`] ? <p id={`code-fout-kaart-${code._key}`} role="alert" className="text-xs font-medium text-red-700">{fouten.fouten[`${index}.code`]}</p> : null}
                        </div>
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
                        <div className="flex items-center justify-between rounded-xl border border-hairline bg-surface-row px-4 py-1.5 text-xs font-semibold text-slate-600">
                          Dienst
                          <Checkbox label="Telt als dienst" checked={code.countsAsShift} onChange={(v) => updateCode(index, { countsAsShift: v })} />
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-hairline bg-surface-row px-4 py-1.5 text-xs font-semibold text-slate-600">
                          Betaald
                          <Checkbox label="Betaalde afwezigheid" checked={code.isPaidAbsence} onChange={(v) => updateCode(index, { isPaidAbsence: v })} />
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-hairline bg-surface-row px-4 py-1.5 text-xs font-semibold text-slate-600">
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
            // Er zijn codes, alleen niet in deze categorie: dat is geen lege
            // lijst ("Nog geen planningscodes"), maar een leeg filter: één
            // stille regel in het kader, geen doos erin (P3).
            <div className="px-5 py-4">
              <EmptyState
                kaal
                title={`Geen codes in de categorie ${CATEGORIE_OPTIES.find((o) => o.value === filter)?.label ?? filter}`}
                action={<Button variant="secondary" size="sm" onClick={() => setFilter('all')}>Alle codes tonen</Button>}
              />
            </div>
          )}
        </TableShell>
      </Card>
      )}
      </ZijvakLayout>

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
