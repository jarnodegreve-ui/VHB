import { Clock, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/ui';
import { ConfirmationModal, ModalHeader } from '../ui';
import { Modal } from '../Modal';
import { Card } from '../Card';
import { Button, MicroLabel } from '../primitives';
import { Field, Input, Select, Textarea } from '../Field';
import { KIND_LABEL, celChipClass } from '../../lib/planningKind';
import { formatDayLong } from '../../lib/format';
import { kandidaatLabel, rangschikKandidaten } from '../../lib/vervangers';
import { WISSEL_REDENEN, noteKey, type Cellen, type Chauffeur } from '../../lib/maandplanning';
import type { CelDetail } from './useCelDetail';
import type { Dienstwissel } from './useDienstwissel';

/**
 * Detailvenster van één cel van de Maandplanning: de code, de herkomst
 * (ruil of wissel, met terugdraaien voor staf), de dienstnotitie, de uren
 * en de handmatige dienstwissel voor een admin, plus de twee bevestigingen
 * (wissel doorvoeren, wissel terugdraaien). Verplaatst uit CapacityView.tsx
 * op 09-10 (stap 1 van de splitsing); sinds stap 3 komt de toestand als
 * twee objecten binnen: `cel` is wat useCelDetail teruggeeft (de cel, de
 * notities) en `wissel` wat useDienstwissel teruggeeft (dienstwissel en
 * terugdraaien), elk aangevuld met wat de view erbij weet. Dit venster
 * tekent ze alleen.
 */
type Props = {
  cel: CelDetail & {
    /** Onbewaarde notitie of begonnen wissel: sluiten vraagt eerst bevestiging. */
    vuil: boolean;
    canEditNotes: boolean;
    /** Het dagtype van de gekozen dag als woord ("schooldag", "schoolvakantie"), van de server; leeg = onbekend. */
    dagtype?: string;
  };
  wissel: Dienstwissel & {
    isAdmin: boolean;
    drivers: Chauffeur[];
    cells: Cellen;
    werkdagenPerChauffeur: Map<string, Set<string>>;
  };
};

export function CelDetailModal({ cel, wissel }: Props) {
  const { selected, sluit: onClose, vuil, canEditNotes, dagtype, notes, noteDraft, setNoteDraft, isSavingNote, saveNote } = cel;
  const {
    isAdmin, terugdraaien, setTerugdraaien, isTerugdraaien, uitvoerenTerugdraai,
    wisselDienst, wisselNaAfwezigheid, wisselNaar, setWisselNaar, wisselReden, setWisselReden,
    wisselToelichting, setWisselToelichting, wisselTerug, wisselNaarNaam, wisselKlaar, wisselRedenTekst,
    isWisselen, wisselBevestigen, setWisselBevestigen, uitvoerenWissel,
    drivers, cells, werkdagenPerChauffeur,
  } = wissel;
  return (
    <>
      <Modal open={!!selected} onClose={onClose} vuil={vuil} maxWidth="sm" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
        {selected && (
          <>
          <ModalHeader
            // Het dagtype erbij (10-10): een dienst met een afwijking per dagtype
            // toont hieronder de uren van déze dag, en dit zegt waarom.
            eyebrow={dagtype ? `${formatDayLong(selected.iso)} · ${dagtype}` : formatDayLong(selected.iso)}
            title={selected.driverName}
            onClose={onClose}
          />
          <div className="flex-1 overflow-y-auto overscroll-contain p-6">
            <div className="flex items-center gap-2.5">
              <span className={cn(
                'inline-block rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums ring-1 ring-hairline',
                celChipClass(selected.cell),
              )}>{selected.cell.code}</span>
              <span className="text-sm font-semibold text-slate-700">{selected.cell.label}</span>
            </div>

            {/* Herkomst van deze cel: hij wijkt af van de geïmporteerde Excel.
                Planners/admins kunnen de wissel hier meteen terugdraaien — dat
                annuleert de ruil én zet de planning terug. */}
            {selected.cell.swapId && (
              <Card tone="muted" padding="none" className="mt-4 px-3.5 py-3 space-y-2.5">
                <p className="text-body-sm font-medium text-slate-600">
                  {selected.cell.swapAway ? (
                    <>
                      Dienst {selected.cell.swapManual ? 'overgezet' : 'weggeruild'}
                      {selected.cell.swapTo ? <> naar <span className="font-semibold text-slate-700">{selected.cell.swapTo}</span></> : null}, daardoor vrij.
                    </>
                  ) : (
                    <>
                      {selected.cell.swapManual ? 'Handmatig overgezet' : 'Geruild'}
                      {selected.cell.swapFrom ? <> van <span className="font-semibold text-slate-700">{selected.cell.swapFrom}</span></> : null}.
                    </>
                  )}
                </p>
                {canEditNotes && (selected.cell.swapDone ? (
                  // Afgehandelde ruil: de state-machine laat geen overgang
                  // meer toe, dus geen knop die gegarandeerd een fout geeft.
                  <p className="text-body-sm font-medium text-slate-500">Afgehandeld, terugdraaien kan niet meer. Zet de dienst desnoods handmatig terug via Dienstwissel.</p>
                ) : (
                  <Button variant="secondary" size="sm" full icon={<RotateCcw size={14} />} disabled={isTerugdraaien} onClick={() => setTerugdraaien(true)}>
                    {isTerugdraaien ? 'Terugdraaien…' : 'Wissel terugdraaien'}
                  </Button>
                ))}
              </Card>
            )}

            {(notes.has(noteKey(selected.driverId, selected.iso)) || canEditNotes) && (
              <div className="mt-5 space-y-2">
                {canEditNotes ? (
                  <Field label="Notitie voor de chauffeur">
                    {({ id }) => (
                      <>
                        <Textarea
                          id={id}
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          maxLength={280}
                          placeholder="bv. Neem bus 412, eerst tanken."
                          className="h-20"
                        />
                        {/* Secundair: de ene gouden knop van dit venster is
                            "Dienst overzetten…" (afwerking 04-09, nr. 5). */}
                        <Button variant="secondary" size="sm" full className="mt-2" disabled={isSavingNote} onClick={() => void saveNote()}>

                          {isSavingNote ? 'Opslaan…' : noteDraft.trim() ? 'Notitie opslaan' : notes.has(noteKey(selected.driverId, selected.iso)) ? 'Notitie verwijderen' : 'Notitie opslaan'}
                        </Button>
                      </>
                    )}
                  </Field>
                ) : (
                  <>
                    <MicroLabel>Notitie voor de chauffeur</MicroLabel>
                    {/* Een notitie is informatie: neutraal vlak, geen goud (tranche 3B, 23-09). */}
                    <Card tone="muted" padding="none" className="px-3.5 py-2.5 text-sm font-medium text-slate-700">
                      {notes.get(noteKey(selected.driverId, selected.iso))}
                    </Card>
                  </>
                )}
              </div>
            )}

            {selected.cell.kind === 'service' ? (
              selected.cell.segments.length > 0 ? (
                <div className="mt-5 space-y-2">
                  <MicroLabel>Uren</MicroLabel>
                  {selected.cell.segments.map((seg, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-base font-semibold text-slate-800 tabular-nums">
                      <Clock size={16} className="text-slate-500 shrink-0" /> {seg}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm text-slate-500">Geen uren bekend voor deze dienst in het dienstoverzicht.</p>
              )
            ) : (
              <p className="mt-5 text-sm font-medium text-slate-500">
                {KIND_LABEL[selected.cell.kind]}
                {selected.cell.kind === 'unknown' && ', staat (nog) niet in het dienstoverzicht of de planningscodes.'}
              </p>
            )}

            {/* Handmatige dienstwissel — alleen admins, op een dienst-cel én op
                een afwezigheidscel waar nog een dienst onder ligt (ziekte is
                juist hét scenario). Voor ziekte, een mondeling afgesproken ruil
                of een andere correctie; de gewone ruil-flow blijft de normale weg. */}
            {isAdmin && wisselDienst && (
              <div className="mt-6 border-t border-hairline pt-5 space-y-3">
                <MicroLabel>Dienstwissel (admin)</MicroLabel>
                {/* Een dienst die nog open staat onder een afwezigheid: dezelfde amber
                    betekenis als het driehoekje in de cel, geen goud. */}
                {wisselNaAfwezigheid && (
                  <Card tone="warning" padding="none" className="px-3.5 py-2.5 text-body-sm font-medium text-slate-700">
                    {selected.driverName} staat op {selected.cell.label.toLowerCase()}, maar dienst{' '}
                    <span className="font-semibold tabular-nums">{wisselDienst}</span> staat nog op naam, zet hem hieronder over.
                  </Card>
                )}
                <p className="text-body-sm font-medium text-slate-500">
                  Zet dienst <span className="font-semibold text-slate-700 tabular-nums">{wisselDienst}</span> op {formatDayLong(selected.iso)} over van{' '}
                  <span className="font-semibold text-slate-700">{selected.driverName}</span> naar een andere chauffeur.
                  {!wisselNaAfwezigheid && ' Kies je iemand die die dag zelf rijdt, dan wisselen ze hun diensten 1-op-1.'}
                </p>
                <Field label="Nieuwe chauffeur" htmlFor="wissel-naar">
                  <Select
                    id="wissel-naar"
                    value={wisselNaar}
                    onChange={(e) => setWisselNaar(e.target.value)}
                  >
                    <option value="">Kies een chauffeur…</option>
                    {/* Vrij die dag bovenaan, daarbinnen minst gewerkt die
                        week — zelfde criteria als de advisor (keuze Jarno
                        19-08). "Vrij" = geen dienst(cel) op deze dag in de
                        maandplanning; een TA of andere code staat erbij.
                        Wie die dag zelf rijdt, staat er met zijn dienst bij
                        (1-op-1-wissel), behalve als de huidige chauffeur
                        afwezig is: die kan geen dienst terugnemen. */}
                    {rangschikKandidaten(
                      drivers.filter((d) => {
                        if (String(d.id) === selected.driverId) return false;
                        const c = cells[String(d.id)]?.[selected.iso];
                        return !wisselNaAfwezigheid || !c || (c.kind !== 'service' && !c.hiddenService);
                      }),
                      (d) => {
                        const c = cells[String(d.id)]?.[selected.iso];
                        return !c || (c.kind !== 'service' && !c.hiddenService);
                      },
                      werkdagenPerChauffeur,
                      selected.iso,
                    ).map((k) => {
                      const c = cells[String(k.user.id)]?.[selected.iso];
                      const code = c?.kind === 'service' ? `rijdt ${c.code}` : c && c.code.toLowerCase() !== 'vrij' ? c.code.toUpperCase() : '';
                      return (
                        <option key={k.user.id} value={String(k.user.id)}>{kandidaatLabel(k, !code)}{code ? ` · ${code}` : ''}</option>
                      );
                    })}
                  </Select>
                </Field>
                {wisselTerug && (
                  <Card tone="info" padding="none" className="px-3.5 py-2.5 text-body-sm font-medium text-slate-700">
                    {wisselNaarNaam} rijdt die dag dienst <span className="font-semibold tabular-nums">{wisselTerug}</span>. Die gaat in ruil naar {selected.driverName}: een 1-op-1-wissel.
                  </Card>
                )}
                <Field label="Reden" htmlFor="wissel-reden">
                  <div className="space-y-2">
                    <Select
                      id="wissel-reden"
                      value={wisselReden}
                      onChange={(e) => setWisselReden(e.target.value)}
                    >
                      {WISSEL_REDENEN.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                    <Input
                      type="text"
                      aria-label="Toelichting bij de reden"
                      value={wisselToelichting}
                      onChange={(e) => setWisselToelichting(e.target.value)}
                      maxLength={200}
                      placeholder={wisselReden === 'Andere correctie' ? 'Omschrijf de correctie (verplicht)' : 'Toelichting (optioneel)'}
                    />
                  </div>
                </Field>
                <Button variant="primary" size="sm" full disabled={!wisselKlaar || isWisselen} onClick={() => setWisselBevestigen(true)}>
                  {isWisselen ? 'Doorvoeren…' : wisselTerug ? 'Diensten wisselen…' : 'Dienst overzetten…'}
                </Button>
              </div>
            )}
          </div>
          </>
        )}
      </Modal>

      <ConfirmationModal
        open={wisselBevestigen}
        onClose={() => setWisselBevestigen(false)}
        onConfirm={() => void uitvoerenWissel()}
        title="Dienstwissel doorvoeren?"
        message={selected && wisselDienst
          ? wisselTerug
            ? `Op ${formatDayLong(selected.iso)} gaat dienst ${wisselDienst} van ${selected.driverName} naar ${wisselNaarNaam}, en dienst ${wisselTerug} van ${wisselNaarNaam} naar ${selected.driverName}. Reden: ${wisselRedenTekst}. De planning wordt meteen bijgewerkt en beide chauffeurs krijgen een melding.`
            : `Dienst ${wisselDienst} op ${formatDayLong(selected.iso)} gaat van ${selected.driverName} naar ${wisselNaarNaam}. Reden: ${wisselRedenTekst}. De planning wordt meteen bijgewerkt en beide chauffeurs krijgen een melding.`
          : ''}
        confirmText="Doorvoeren"
        cancelText="Annuleren"
        variant="warning"
      />

      <ConfirmationModal
        open={terugdraaien}
        onClose={() => setTerugdraaien(false)}
        onConfirm={() => void uitvoerenTerugdraai()}
        title="Wissel terugdraaien?"
        message={selected
          ? selected.cell.swapAway
            // Vanaf de kant die de dienst afstond: de dienst komt hier terug.
            ? `De dienst die ${selected.driverName} op ${formatDayLong(selected.iso)} wegruilde, komt terug op naam van ${selected.driverName}. Beide chauffeurs krijgen een melding.`
            : `Dienst ${selected.cell.code} op ${formatDayLong(selected.iso)} gaat terug naar ${selected.cell.swapFrom || 'de oorspronkelijke chauffeur'}. Beide chauffeurs krijgen een melding.`
          : ''}
        confirmText="Terugdraaien"
        cancelText="Annuleren"
        variant="warning"
      />
    </>
  );
}
