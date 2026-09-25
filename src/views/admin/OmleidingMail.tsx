import { useEffect, useMemo, useState } from 'react';
import { FileText, Send } from 'lucide-react';
import type { Diversion, Verzendlijst } from '../../types';
import { SlideOver } from '../../components/SlideOver';
import { Modal, SluitKnop } from '../../components/Modal';
import { Field, Textarea } from '../../components/Field';
import { Badge, Button } from '../../components/primitives';
import { Checkbox } from '../../components/Table';
import { apiJson } from '../../lib/api';
import { notify } from '../../lib/ui';
import { meldSchrijffout } from '../../lib/fouten';
import { aantal as tel, prettySize } from '../../lib/format';
import { leesAdressen, OMLEIDING_MAIL_BERICHT_MAX, type OmleidingMailInvoer } from '../../../shared/schemas/mail';

/**
 * Een omleiding mailen (mailtranche PR 4, planner en admin): naar
 * verzendlijsten en vrije adressen, met de PDF's als bijlage. Eerst een
 * voorbeeld met het aantal ontvangers en de bijlagen, dan pas versturen.
 * Zelfde opzet als EigenMail, bewust zonder groepen: dit is extern gericht
 * (De Lijn, de garage), niet naar het eigen personeel.
 */
type Droog = { droog: true; aantal: number; ontvangers: Array<{ adres: string; naam: string }>; onderwerp: string; html: string; bijlagen: Array<{ filename: string; sizeBytes: number | null }> };

export function OmleidingMailPaneel({ diversion, onClose }: { diversion: Diversion | null; onClose: () => void }) {
  const open = diversion !== null;
  const [lijsten, setLijsten] = useState<Verzendlijst[] | null>(null);
  const [lijstIds, setLijstIds] = useState<string[]>([]);
  const [adressenTekst, setAdressenTekst] = useState('');
  const [bericht, setBericht] = useState('');
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [bezig, setBezig] = useState(false);
  const [voorbeeld, setVoorbeeld] = useState<Droog | null>(null);

  useEffect(() => {
    if (!open) return;
    let actief = true;
    setLijstIds([]); setAdressenTekst(''); setBericht(''); setFouten({}); setVoorbeeld(null);
    apiJson<Verzendlijst[]>('/api/mails/verzendlijsten')
      .then((l) => { if (actief) setLijsten(l); })
      .catch(() => { if (actief) setLijsten([]); });
    return () => { actief = false; };
  }, [open, diversion?.id]);

  const adressen = useMemo(() => leesAdressen(adressenTekst), [adressenTekst]);
  const ietsGekozen = lijstIds.length + adressen.adressen.length > 0;
  const vuil = Boolean(bericht || ietsGekozen);
  const invoer = (droog: boolean): OmleidingMailInvoer => ({ droog, bericht, ontvangers: { lijsten: lijstIds, adressen: adressen.adressen } });

  const toonVoorbeeld = async () => {
    if (!diversion) return;
    const f: Record<string, string> = {};
    if (adressen.fouten.length > 0) f.adressen = `Geen geldig adres: ${adressen.fouten.slice(0, 3).join(', ')}${adressen.fouten.length > 3 ? ', …' : ''}`;
    if (!ietsGekozen) f.ontvangers = 'Kies minstens één verzendlijst of adres';
    setFouten(f);
    if (Object.keys(f).length > 0) return;
    setBezig(true);
    try {
      setVoorbeeld(await apiJson<Droog>(`/api/diversions/${encodeURIComponent(diversion.id)}/mail`, { method: 'POST', body: JSON.stringify(invoer(true)) }));
    } catch (err) {
      meldSchrijffout('Voorbeeld maken', err);
    } finally {
      setBezig(false);
    }
  };

  const verstuur = async () => {
    if (!diversion || !voorbeeld) return;
    setBezig(true);
    try {
      const r = await apiJson<{ aantal: number; gelukt: number; mislukt: number; mocked: boolean; bijlagen: number }>(`/api/diversions/${encodeURIComponent(diversion.id)}/mail`, { method: 'POST', body: JSON.stringify(invoer(false)) });
      notify(r.mocked ? `Mail gelogd voor ${tel(r.aantal, 'ontvanger', 'ontvangers')} (geen SMTP ingesteld).` : r.mislukt > 0 ? `Omleiding gemaild naar ${r.gelukt} van ${r.aantal}; ${r.mislukt} mislukt.` : `Omleiding gemaild naar ${tel(r.aantal, 'ontvanger', 'ontvangers')}.`, r.mislukt > 0 ? 'error' : 'success');
      setVoorbeeld(null);
      onClose();
    } catch (err) {
      meldSchrijffout('Mail versturen', err, () => void verstuur());
    } finally {
      setBezig(false);
    }
  };

  const wissel = (id: string, aan: boolean) => setLijstIds((x) => (aan ? [...new Set([...x, id])] : x.filter((y) => y !== id)));
  const bijlagen = diversion?.bijlagen ?? [];

  return (
    <>
      <SlideOver
        open={open}
        onClose={onClose}
        title="Omleiding mailen"
        subtitle={diversion?.title ?? ''}
        icon={<Send size={16} />}
        vuil={vuil}
        footer={(
          <div className="flex items-center gap-2">
            <SluitKnop onClose={onClose} variant="secondary" size="lg" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
            <Button variant="primary" size="lg" className="flex-1" bezig={bezig} onClick={() => void toonVoorbeeld()}>Voorbeeld en versturen</Button>
          </div>
        )}
      >
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void toonVoorbeeld(); }}>
          <div>
            <p className="text-sm font-semibold text-slate-800">Bijlagen</p>
            {bijlagen.length === 0 ? (
              <p className="mt-1 text-body-sm text-slate-500">Deze omleiding heeft geen PDF; de mail bevat de omschrijving en de periode.</p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Bijlagen">
                {bijlagen.map((b) => <li key={b.slot}><Badge tone="slate" icon={<FileText size={12} />}>{b.filename}{b.sizeBytes != null ? ` · ${prettySize(b.sizeBytes)}` : ''}</Badge></li>)}
              </ul>
            )}
          </div>
          <Field label="Begeleidend bericht (optioneel)" htmlFor="omleiding-mail-bericht" error={fouten.bericht} hint="Komt bovenaan de mail, vóór de omschrijving van de omleiding.">
            <Textarea id="omleiding-mail-bericht" rows={4} value={bericht} maxLength={OMLEIDING_MAIL_BERICHT_MAX} onChange={(e) => setBericht(e.target.value)} placeholder="bv. Beste, hierbij de omleiding voor volgende week. Graag jullie bevestiging." />
          </Field>
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-slate-800">Ontvangers</legend>
            {fouten.ontvangers && <p className="text-body-sm text-red-700" role="alert">{fouten.ontvangers}</p>}
            {lijsten === null ? (
              <p className="text-body-sm text-slate-500" role="status">Verzendlijsten laden…</p>
            ) : lijsten.length === 0 ? (
              <p className="text-body-sm text-slate-500">Nog geen verzendlijsten; een admin maakt ze aan onder Beheer › Mails.</p>
            ) : (
              <ul className="space-y-1.5" aria-label="Verzendlijsten">
                {lijsten.map((l) => (
                  <li key={l.id} className="flex items-center gap-2">
                    <Checkbox checked={lijstIds.includes(l.id)} onChange={(aan) => wissel(l.id, aan)} label={`Verzendlijst ${l.naam}`} />
                    <span className="text-sm text-slate-700">{l.naam}</span>
                    <Badge tone="slate" kaal>{tel(l.adressen.length, 'adres', 'adressen')}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <Field label="Vrije adressen" htmlFor="omleiding-mail-adressen" error={fouten.adressen} hint="Eén per regel of met komma's.">
              <Textarea id="omleiding-mail-adressen" rows={3} value={adressenTekst} onChange={(e) => { setAdressenTekst(e.target.value); setFouten((f) => ({ ...f, adressen: '' })); }} placeholder="dispatching@delijn.be" />
            </Field>
          </fieldset>
        </form>
      </SlideOver>

      <Modal open={voorbeeld !== null} onClose={() => setVoorbeeld(null)} maxWidth="2xl" ariaLabel="Voorbeeld van de omleidingsmail" boven>
        {voorbeeld && (
          <div className="space-y-3">
            <div>
              <p className="text-card-title">Naar {tel(voorbeeld.aantal, 'ontvanger', 'ontvangers')}</p>
              <p className="mt-0.5 break-words text-body-sm text-slate-500">{voorbeeld.ontvangers.map((o) => o.adres).slice(0, 8).join(', ')}{voorbeeld.ontvangers.length > 8 ? ` en nog ${voorbeeld.ontvangers.length - 8}` : ''}.</p>
              <p className="mt-0.5 text-body-sm text-slate-500">Onderwerp: {voorbeeld.onderwerp}. {voorbeeld.bijlagen.length > 0 ? `${tel(voorbeeld.bijlagen.length, 'PDF', "PDF's")} in bijlage.` : 'Geen bijlage.'}</p>
            </div>
            <iframe title="Voorbeeld van de omleidingsmail" srcDoc={voorbeeld.html} sandbox="" className="h-[55vh] min-h-[360px] w-full rounded-xl bg-surface-white ring-1 ring-hairline" />
            <div className="flex items-center justify-end gap-2">
              <SluitKnop onClose={() => setVoorbeeld(null)} variant="secondary" disabled={bezig}>Terug</SluitKnop>
              <Button variant="primary" icon={<Send size={16} />} bezig={bezig} onClick={() => void verstuur()}>Versturen naar {voorbeeld.aantal}</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
