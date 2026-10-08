import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Card, CardHeader } from './Card';
import { Callout } from './Callout';
import { Button, Switch } from './primitives';
import { DateInput, Field, Textarea } from './Field';
import { Formulier } from './Formulier';
import { useVeldfouten } from '../lib/formulier';
import { valideer } from '../lib/valideer';
import { apiFetch, foutUitAntwoord } from '../lib/api';
import { meldSchrijffout } from '../lib/fouten';
import { notify } from '../lib/ui';
import { vandaagBrussel } from '../lib/brussel';
import { formatDatumDMJ } from '../lib/format';
import { haalMededeling, zetMededelingLokaal } from '../lib/mededeling';
import { useZelfLadend } from '../lib/zelfLadend';
import { mededelingSchema } from '../../shared/schemas/mededeling';
import { GEEN_MEDEDELING, MEDEDELING_TEKST_MAX, mededelingZichtbaar, type Mededeling } from '../../shared/mededeling';

type Data = { tekst: string; tonen: boolean; tot: string };

/**
 * Beheer van de mededeling voor de chauffeurs (08-10, admin, op Ritbladen):
 * tekst, schakelaar Tonen en een optionele laatste dag. Lui geladen door
 * het scherm, zodat de chauffeurs het schema (zod) niet mee binnenhalen.
 */
export default function MededelingBeheer() {
  const [data, setData] = useState<Data>({ tekst: '', tonen: false, tot: '' });
  const [geladen, setGeladen] = useState<Mededeling>(GEEN_MEDEDELING);
  const fouten = useVeldfouten();
  const [bezig, setBezig] = useState(false);
  const vandaag = vandaagBrussel();

  const laad = useZelfLadend(async () => {
    const m = await haalMededeling({ vers: true });
    setGeladen(m);
    setData({ tekst: m.tekst, tonen: m.tonen, tot: m.tot ?? '' });
  }, { boodschap: 'De mededeling kon niet geladen worden.', focusRefresh: false });

  const vuil = data.tekst !== geladen.tekst || data.tonen !== geladen.tonen || (data.tot || null) !== geladen.tot;
  const voorbeeld: Mededeling = { tekst: data.tekst.trim(), tonen: data.tonen, tot: data.tot || null };
  const zichtbaar = mededelingZichtbaar(voorbeeld, vandaag);

  const bewaar = async () => {
    if (bezig) return;
    const uit = valideer(mededelingSchema, { tekst: data.tekst, tonen: data.tonen, tot: data.tot });
    if (!uit.ok) { fouten.zet(uit.fouten); return; }
    fouten.wis();
    setBezig(true);
    try {
      const res = await apiFetch('/api/mededeling', { method: 'PUT', body: JSON.stringify(uit.data) });
      if (!res.ok) throw await foutUitAntwoord(res);
      const m: Mededeling = { tekst: uit.data.tekst, tonen: uit.data.tonen, tot: uit.data.tot ?? null };
      setGeladen(m);
      zetMededelingLokaal(m);
      notify(mededelingZichtbaar(m, vandaag) ? 'De mededeling staat nu op Ritbladen, Mijn dag en het dashboard.' : m.tonen ? 'Bewaard. De mededeling wordt pas getoond met een tekst en vóór de einddag.' : 'Bewaard. De mededeling staat uit.', 'success');
    } catch (err) {
      meldSchrijffout('Mededeling opslaan', err, bewaar);
    } finally {
      setBezig(false);
    }
  };

  return (
    <Card padding="tile" className="space-y-4">
      <CardHeader
        title="Mededeling voor de chauffeurs"
        description="Een geheugensteuntje bovenaan Ritbladen, Mijn dag en het dashboard, bv. een nieuwe dienstregeling die eraan komt."
      />
      <Formulier id="mededeling-formulier" onVerstuur={bewaar} className="space-y-4" noValidate>
        <Field label="Tekst" htmlFor="mededeling-tekst" error={fouten.fouten.tekst} hint={`Hoogstens ${MEDEDELING_TEKST_MAX} tekens, één zin volstaat.`}>
          <Textarea
            id="mededeling-tekst" rows={2} maxLength={MEDEDELING_TEKST_MAX} value={data.tekst} disabled={laad.laden}
            placeholder="Opgelet, vanaf 11/12 nieuwe dienstregeling!"
            onChange={(e) => { setData({ ...data, tekst: e.target.value }); fouten.wisVeld('tekst'); }}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tonen tot en met" htmlFor="mededeling-tot" error={fouten.fouten.tot} hint="Optioneel: daarna verdwijnt ze vanzelf.">
            <DateInput id="mededeling-tot" value={data.tot} min={vandaag} disabled={laad.laden} onChange={(v) => { setData({ ...data, tot: v }); fouten.wisVeld('tot'); }} />
          </Field>
          <div className="flex items-center gap-3 sm:pt-7">
            <Switch checked={data.tonen} disabled={laad.laden} label="Mededeling tonen" onChange={(v) => { setData({ ...data, tonen: v }); fouten.wisVeld('tekst'); }} />
            <span className="text-sm font-medium text-slate-700">Tonen</span>
          </div>
        </div>
        {voorbeeld.tekst && (
          <div>
            <p className="text-micro mb-1.5">Zo ziet ze eruit{zichtbaar ? '' : data.tonen ? ', zodra de einddag klopt' : ', zodra ze aanstaat'}</p>
            <Callout tone="info" compact icon={<Megaphone size={16} />}>{voorbeeld.tekst}</Callout>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" bezig={bezig} disabled={laad.laden || !vuil}>Bewaren</Button>
          <span className="text-body-sm text-slate-500">
            {geladen.tonen && mededelingZichtbaar(geladen, vandaag)
              ? `Nu zichtbaar${geladen.tot ? ` tot en met ${formatDatumDMJ(geladen.tot)}` : ''}.`
              : 'Nu niet zichtbaar.'}
          </span>
        </div>
      </Formulier>
    </Card>
  );
}
