import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { Field, Input } from '../../components/Field';
import { Badge, Button, Switch } from '../../components/primitives';
import { apiJson } from '../../lib/api';
import { notify } from '../../lib/ui';
import { valideer } from '../../lib/valideer';
import { GEEN_ONDERHOUD, ONDERHOUD_STANDAARD_TEKST, ONDERHOUD_TEKST_MAX, onderhoudBodySchema, parseOnderhoud, type Onderhoud } from '../../../shared/schemas/onderhoud';
import { meldSchrijffout } from '../../lib/fouten';

/**
 * Instellingen › Beheer › Onderhoudsmodus (admin). Eén rij in de stijl van
 * de andere beheer-rijen (icoon, titel, uitleg, schakelaar rechts); staat de
 * modus aan, dan klapt eronder het tekstveld en de schakelaar "schrijfacties
 * pauzeren" uit. De schakelaars slaan meteen op (GET/PUT /api/onderhoud),
 * de tekst via de knop, met de veldfout bij het veld.
 */
export function OnderhoudBeheer() {
  const [onderhoud, setOnderhoud] = useState<Onderhoud | null>(null);
  const [tekst, setTekst] = useState('');
  const [tekstFout, setTekstFout] = useState<string | undefined>();
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    let actief = true;
    apiJson<unknown>('/api/onderhoud')
      .then((json) => { if (actief) { const o = parseOnderhoud(json); setOnderhoud(o); setTekst(o.tekst); } })
      .catch(() => { if (actief) setOnderhoud(GEEN_ONDERHOUD); });
    return () => { actief = false; };
  }, []);

  const bewaar = async (volgende: Onderhoud, melding?: string) => {
    const check = valideer(onderhoudBodySchema, volgende);
    if (check.ok === false) { setTekstFout(check.fouten.tekst ?? Object.values(check.fouten)[0]); return; }
    setBezig(true);
    setTekstFout(undefined);
    try {
      const opgeslagen = parseOnderhoud(await apiJson<unknown>('/api/onderhoud', { method: 'PUT', body: JSON.stringify(check.data) }));
      setOnderhoud(opgeslagen);
      setTekst(opgeslagen.tekst);
      if (melding) notify(melding, 'success');
    } catch (err) {
      // Zelfde schema als de server, dus een 400 met veldfouten komt hier
      // in de praktijk niet; wat overblijft (tabel ontbreekt, netwerk) is een toast.
      meldSchrijffout('Instelling opslaan', err, () => void bewaar(volgende, melding));
    } finally {
      setBezig(false);
    }
  };

  const o = onderhoud ?? GEEN_ONDERHOUD;
  const tekstGewijzigd = onderhoud !== null && tekst.trim() !== o.tekst;
  const uitleg = onderhoud === null
    ? 'Laden…'
    : o.actief
      ? (o.schrijfblok ? 'Aan, iedereen ziet de banner en alleen beheerders kunnen nog iets wijzigen.' : 'Aan, iedereen ziet de banner; alles blijft gewoon werken.')
      : 'Uit. Zet aan om iedereen een banner te tonen, bijvoorbeeld tijdens een migratie.';

  return (
    <div className="border-b border-hairline-subtle py-3.5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600"><Wrench size={16} /></span>
        <div className="min-w-[11rem] flex-1 basis-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            Onderhoudsmodus
            {o.actief && <Badge tone="amber" dot>Aan</Badge>}
          </p>
          <p className="mt-0.5 break-words text-body-sm text-slate-500">{uitleg}</p>
        </div>
        <div className="ml-auto shrink-0 pt-0.5">
          <Switch
            checked={o.actief}
            disabled={onderhoud === null || bezig}
            label="Onderhoudsmodus"
            onChange={(actief) => { void bewaar({ ...o, actief, tekst: tekst.trim() }, actief ? 'Onderhoudsmodus staat aan.' : 'Onderhoudsmodus staat uit.'); }}
          />
        </div>
      </div>
      {o.actief && (
        <div className="mt-4 space-y-4 sm:ml-11">
          <Field label="Tekst in de banner" htmlFor="onderhoud-tekst" error={tekstFout} hint={`Leeg = “${ONDERHOUD_STANDAARD_TEKST}”`}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} invalid={invalid} value={tekst} maxLength={ONDERHOUD_TEKST_MAX} onChange={(e) => setTekst(e.target.value)} placeholder="Bv. Vanavond tussen 22:00 en 23:00 is het portaal even niet beschikbaar." />
            )}
          </Field>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-[11rem] flex-1 basis-0">
              <p className="text-sm font-semibold text-slate-900">Schrijfacties pauzeren</p>
              <p className="mt-0.5 text-body-sm text-slate-500">Bekijken blijft werken; verlof aanvragen, ruilen, opslaan en importeren geven even een melding. Beheerders kunnen altijd door.</p>
            </div>
            <Switch
              checked={o.schrijfblok}
              disabled={bezig}
              label="Schrijfacties pauzeren"
              onChange={(schrijfblok) => { void bewaar({ ...o, schrijfblok, tekst: tekst.trim() }, schrijfblok ? 'Schrijfacties zijn gepauzeerd.' : 'Schrijfacties werken weer.'); }}
            />
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" disabled={!tekstGewijzigd || bezig} onClick={() => { void bewaar({ ...o, tekst: tekst.trim() }, 'Bannertekst opgeslagen.'); }}>Tekst opslaan</Button>
          </div>
        </div>
      )}
    </div>
  );
}
