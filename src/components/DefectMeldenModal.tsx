import { useEffect, useMemo, useState } from 'react';
import { Wrench } from 'lucide-react';
import { isStaf, type User } from '../types';
import { WERKTYPES, WERKTYPE_LABEL, DEFECT_OMSCHRIJVING_MAX, VOERTUIG_CATEGORIEEN, VOERTUIG_CATEGORIE_MEERVOUD, voertuigNaam, type Werktype } from '../../shared/techniek';
import { DEFECT_STATUS } from '../../shared/status';
import { defectMeldingBodySchema } from '../../shared/schemas/techniek';
import { useVeldfouten, useVuil } from '../lib/formulier';
import { meldSchrijffout } from '../lib/fouten';
import { notify } from '../lib/ui';
import { formatDateHuman } from '../lib/format';
import { laadDefecten, laadVoertuigenKort, meldDefect, TechniekFout, type Defect, type VehicleKort } from '../lib/techniek';
import { Modal, SluitKnop } from './Modal';
import { ModalHeader } from './ui';
import { Field, Select, Textarea } from './Field';
import { Formulier } from './Formulier';
import { Button, FilterChip, StatusBadge } from './primitives';

/**
 * "Defect melden": de chauffeur (of technieker) meldt een probleem aan een
 * bus, dat meteen in de gele boek van de garage verschijnt (fase A Access-
 * migratie, 13-09). Lazy geladen vanuit Mijn dag en het dashboard: pas bij de
 * klik komt deze chunk (mét zod-schema) binnen, de chauffeursschermen zelf
 * blijven licht. Onderaan de laatste eigen meldingen met hun status, zodat
 * niemand tweemaal hetzelfde meldt.
 */
export function DefectMeldenModal({
  open,
  onClose,
  currentUser,
  onGemeld,
  vasteBusId,
}: {
  open: boolean;
  onClose: () => void;
  currentUser: User;
  /** Na een geslaagde melding (bv. lijst verversen in de gele boek). */
  onGemeld?: (defect: Defect) => void;
  /** Bus al gekozen (vanuit het voertuigdetail). */
  vasteBusId?: string;
}) {
  const [bussen, setBussen] = useState<VehicleKort[]>([]);
  const [eigen, setEigen] = useState<Defect[]>([]);
  const [laden, setLaden] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [vehicleId, setVehicleId] = useState(vasteBusId ?? '');
  const [werktype, setWerktype] = useState<Werktype>('T');
  const [omschrijving, setOmschrijving] = useState('');
  const fouten = useVeldfouten();
  const { vuil } = useVuil({ vehicleId, werktype, omschrijving }, open);

  useEffect(() => {
    if (!open) return;
    fouten.wis();
    setLaden(true);
    void Promise.all([laadVoertuigenKort(), laadDefecten({ mijn: true, status: 'alles', limit: 5 })])
      .then(([v, d]) => { setBussen(v); setEigen(d); })
      .catch((err) => meldSchrijffout('Bussen laden', err))
      .finally(() => setLaden(false));
  }, [open]);

  useEffect(() => { if (vasteBusId) setVehicleId(vasteBusId); }, [vasteBusId]);

  // Per categorie (bussen eerst, die meldt een chauffeur het vaakst), binnen een
  // categorie lijnbussen vóór schoolbussen en dan op kort nummer. De keuzelijst
  // toont alleen het busnummer zoals het op de bus staat (Jarno 13-09): geen
  // nummerplaat of andere gegevens voor chauffeurs.
  // Privéwagens zijn er alleen voor de garage (technieker/staf): een chauffeur
  // krijgt ze niet te zien (Jarno 14-09; de server filtert ze ook al uit
  // /api/vehicles en weigert de melding).
  const magPrivewagen = currentUser.role === 'technieker' || isStaf(currentUser.role);
  const groepen = useMemo(() => {
    const rang = (v: VehicleKort) => (v.type === 'lijnbus' ? 0 : v.type === 'schoolbus' ? 1 : 2);
    const gesorteerd = [...bussen]
      .filter((v) => magPrivewagen || v.categorie !== 'privewagen')
      .sort((a, b) => rang(a) - rang(b) || (a.kortNr ?? 99999) - (b.kortNr ?? 99999) || a.busnr.localeCompare(b.busnr, 'nl'));
    return VOERTUIG_CATEGORIEEN.map((c) => ({ categorie: c, label: VOERTUIG_CATEGORIE_MEERVOUD[c], items: gesorteerd.filter((v) => (v.categorie ?? 'bus') === c) })).filter((g) => g.items.length > 0);
  }, [bussen, magPrivewagen]);

  const verstuur = async () => {
    if (bezig) return;
    const data = fouten.controleer(defectMeldingBodySchema, { vehicleId, werktype, omschrijving });
    if (!data) return;
    setBezig(true);
    try {
      const d = await meldDefect(data);
      notify('Gemeld, de garage ziet het in de gele boek.', 'success');
      setOmschrijving('');
      fouten.wis();
      onGemeld?.(d);
      onClose();
    } catch (err) {
      // Veldfouten horen bij het veld; alles daarbuiten is één toast met een
      // vervolgstap. Geen "Opnieuw proberen"-knop: een melding aanmaken is
      // niet idempotent, de knop Melden staat er nog.
      if (err instanceof TechniekFout && err.veldfouten) fouten.zet(err.veldfouten);
      else meldSchrijffout('Melden', err);
    } finally {
      setBezig(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} vuil={vuil} maxWidth="md" ariaLabel="Defect melden" className="!p-0 flex flex-col">
      <ModalHeader
        title="Defect melden"
        description="Wat is er mis met de bus? De garage ziet je melding meteen."
        leading={<span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-surface-muted text-slate-700"><Wrench size={18} /></span>}
        onClose={onClose}
      />
      <Formulier onVerstuur={verstuur} noValidate className="space-y-4 p-6 md:p-7">
        <Field label="Bus" required error={fouten.fouten.vehicleId}>
          <Select value={vehicleId} disabled={laden || Boolean(vasteBusId)} onChange={(e) => { setVehicleId(e.target.value); fouten.wisVeld('vehicleId'); }}>
            <option value="">{laden ? 'Bussen laden…' : 'Kies een bus'}</option>
            {groepen.length === 1
              ? groepen[0].items.map((v) => <option key={v.id} value={v.id}>{v.busnr}</option>)
              : groepen.map((g) => (
                <optgroup key={g.categorie} label={g.label}>
                  {g.items.map((v) => <option key={v.id} value={v.id}>{v.busnr}</option>)}
                </optgroup>
              ))}
          </Select>
        </Field>
        <Field label="Soort" error={fouten.fouten.werktype}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Soort">
            {WERKTYPES.map((t) => (
              <FilterChip key={t} active={werktype === t} onClick={() => setWerktype(t)}>{WERKTYPE_LABEL[t]}</FilterChip>
            ))}
          </div>
        </Field>
        <Field label="Wat is er mis?" required error={fouten.fouten.omschrijving} hint={`${omschrijving.length} / ${DEFECT_OMSCHRIJVING_MAX}`}>
          <Textarea
            value={omschrijving}
            rows={4}
            maxLength={DEFECT_OMSCHRIJVING_MAX}
            placeholder="Bijvoorbeeld: bel doet het niet, deur 2 sluit traag, schade rechts achter…"
            onChange={(e) => { setOmschrijving(e.target.value); fouten.wisVeld('omschrijving'); }}
          />
        </Field>
        {eigen.length > 0 && (
          <div>
            <p className="text-micro mb-2">Jouw laatste meldingen</p>
            <ul className="divide-y divide-hairline-subtle rounded-2xl border border-hairline">
              {eigen.map((d) => (
                <li key={d.id} className="flex items-start gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{voertuigNaam(d)} <span className="font-medium text-slate-500">· {WERKTYPE_LABEL[d.werktype]}</span></p>
                    <p className="truncate text-xs text-slate-500">{d.omschrijving}</p>
                    <p className="text-xs text-slate-500">{formatDateHuman(d.gemeldOp.slice(0, 10))}</p>
                  </div>
                  <StatusBadge status={d.status} map={DEFECT_STATUS} stil={d.status !== 'open'} className="shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <SluitKnop onClose={onClose} variant="ghost" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" className="flex-1" bezig={bezig} disabled={laden}>Melden</Button>
        </div>
      </Formulier>
    </Modal>
  );
}
