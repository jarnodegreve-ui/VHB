import { useState } from 'react';
import type { Dienstregeling } from '../../types';
import { Button } from '../primitives';
import { SluitKnop } from '../Modal';
import { SlideOver } from '../SlideOver';
import { Formulier } from '../Formulier';
import { DateInput, Field, Input, Select, Textarea } from '../Field';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { notify } from '../../lib/ui';
import { valideer } from '../../lib/valideer';
import { VeldfoutenError, maakDienstregeling, wijzigDienstregeling } from '../../lib/dienstregelingen';
import { dienstregelingBodySchema, dienstregelingPatchSchema } from '../../../shared/schemas/dienstregeling';
import { dagVoor, versieLabel, versieVoorDatum } from '../../../shared/dienstregeling';
import { formatDatumDMJ } from '../../lib/format';

type Data = { geldigVanaf: string; naam: string; opmerking: string; kopieVan: string };

/**
 * Nieuwe versie van de dienstregeling klaarzetten, of naam, opmerking en
 * (zolang ze nog niet geldt) de datum van een bestaande wijzigen. Een nieuwe
 * versie begint als kopie van een bestaande, standaard de versie die op de
 * dag ervoor geldt: dezelfde lijst, nu aanpassen.
 */
export function VersieFormulier({ open, onClose, versies, vandaag, bewerk, onKlaar }: {
  open: boolean;
  onClose: () => void;
  versies: Dienstregeling[];
  vandaag: string;
  /** De versie die bewerkt wordt; leeg = een nieuwe versie. */
  bewerk: Dienstregeling | null;
  /** Na een geslaagde save: de versie (nieuw of bijgewerkt) en wat de planning deed. */
  onKlaar: (versie: Dienstregeling, planning?: { status: string; melding?: string }) => void | Promise<void>;
}) {
  const nieuw = !bewerk;
  const begin: Data = bewerk
    ? { geldigVanaf: bewerk.geldigVanaf, naam: bewerk.naam ?? '', opmerking: bewerk.opmerking ?? '', kopieVan: '' }
    : { geldigVanaf: '', naam: '', opmerking: '', kopieVan: '' };
  const [sleutel, setSleutel] = useState<string | null>(null);
  const [data, setData] = useState<Data>(begin);
  const gewenst = open ? (bewerk?.id ?? 'nieuw') : null;
  if (gewenst !== null && gewenst !== sleutel) { setSleutel(gewenst); setData(begin); }
  const fouten = useVeldfouten();
  const { vuil } = useVuil(data, open, sleutel);
  const [bezig, setBezig] = useState(false);

  const datumVast = !!bewerk && bewerk.status !== 'toekomstig';
  // Standaardbron: de versie die geldt op de dag vóór de gekozen datum.
  const standaardBron = data.geldigVanaf ? versieVoorDatum(versies, dagVoor(data.geldigVanaf)) : versieVoorDatum(versies, vandaag);

  const verstuur = async () => {
    if (bezig) return;
    const body = nieuw
      ? { geldigVanaf: data.geldigVanaf, naam: data.naam, opmerking: data.opmerking, kopieVan: data.kopieVan || undefined }
      : { ...(datumVast ? {} : { geldigVanaf: data.geldigVanaf }), naam: data.naam, opmerking: data.opmerking };
    const uit = valideer(nieuw ? dienstregelingBodySchema : dienstregelingPatchSchema, body);
    if (!uit.ok) { fouten.zet(uit.fouten); return; }
    if (nieuw && data.geldigVanaf < vandaag) { fouten.zet({ geldigVanaf: 'De datum mag niet in het verleden liggen.' }); return; }
    fouten.wis();
    setBezig(true);
    try {
      if (nieuw) {
        const versie = await maakDienstregeling(uit.data as { geldigVanaf: string; naam?: string; opmerking?: string; kopieVan?: string });
        await onKlaar(versie);
      } else {
        const { planning, ...versie } = await wijzigDienstregeling(bewerk!.id, uit.data as { geldigVanaf?: string; naam?: string; opmerking?: string });
        await onKlaar({ ...bewerk!, ...versie }, planning);
      }
      onClose();
    } catch (err) {
      if (err instanceof VeldfoutenError) { fouten.zet(err.veldfouten); return; }
      notify(err instanceof Error ? err.message : 'Opslaan is mislukt.', 'error');
    } finally {
      setBezig(false);
    }
  };

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      vuil={vuil}
      title={nieuw ? 'Nieuwe versie van de dienstregeling' : `Versie ${versieLabel(bewerk!)}`}
      subtitle={nieuw ? 'Zet de dienstregeling van een latere datum nu al klaar.' : 'Naam, opmerking en (zolang ze nog niet geldt) de datum.'}
      footer={(
        <div className="flex gap-3">
          <SluitKnop onClose={onClose} variant="secondary" size="lg" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" form="versie-formulier" variant="primary" size="lg" className="flex-1" bezig={bezig}>
            {nieuw ? 'Versie aanmaken' : 'Versie bijwerken'}
          </Button>
        </div>
      )}
    >
      <Formulier id="versie-formulier" onVerstuur={verstuur} className="space-y-5">
        <Field label="Geldig vanaf" htmlFor="versie-datum" required error={fouten.fouten.geldigVanaf} hint={datumVast ? 'De datum van een versie die al geldt kan niet meer wijzigen.' : 'De eerste dag waarop deze dienstregeling geldt.'}>
          <DateInput id="versie-datum" value={data.geldigVanaf} min={vandaag} required disabled={datumVast} onChange={(v) => { setData({ ...data, geldigVanaf: v }); fouten.wisVeld('geldigVanaf'); }} />
        </Field>
        <Field label="Naam" htmlFor="versie-naam" error={fouten.fouten.naam} hint="Optioneel, bv. Dienstregeling januari 2027. Zonder naam heet de versie naar haar datum.">
          <Input id="versie-naam" type="text" value={data.naam} maxLength={80} onChange={(e) => { setData({ ...data, naam: e.target.value }); fouten.wisVeld('naam'); }} />
        </Field>
        {nieuw && (
          <Field label="Begin met een kopie van" htmlFor="versie-kopie" hint={standaardBron ? `Zonder keuze: ${versieLabel(standaardBron)}, de versie die op ${data.geldigVanaf ? formatDatumDMJ(dagVoor(data.geldigVanaf)) : 'de dag ervoor'} geldt.` : undefined}>
            <Select id="versie-kopie" value={data.kopieVan} onChange={(e) => setData({ ...data, kopieVan: e.target.value })}>
              <option value="">{standaardBron ? `${versieLabel(standaardBron)} (standaard)` : 'Geen, een lege versie'}</option>
              {versies.map((v) => <option key={v.id} value={v.id}>{versieLabel(v)}, {v.aantalDiensten} diensten</option>)}
            </Select>
          </Field>
        )}
        <Field label="Opmerking" htmlFor="versie-opmerking" error={fouten.fouten.opmerking}>
          <Textarea id="versie-opmerking" rows={3} value={data.opmerking} maxLength={300} onChange={(e) => { setData({ ...data, opmerking: e.target.value }); fouten.wisVeld('opmerking'); }} />
        </Field>
      </Formulier>
    </SlideOver>
  );
}
