import { useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import type { User, Verzendlijst } from '../../types';
import { SlideOver } from '../../components/SlideOver';
import { Modal, SluitKnop } from '../../components/Modal';
import { Field, Input, SearchField, Textarea } from '../../components/Field';
import { Badge, Button } from '../../components/primitives';
import { Checkbox } from '../../components/Table';
import { apiJson } from '../../lib/api';
import { notify } from '../../lib/ui';
import { meldSchrijffout } from '../../lib/fouten';
import { valideer } from '../../lib/valideer';
import { aantal as tel } from '../../lib/format';
import { ROL_LABEL } from '../../types';
import { eigenMailSchema, EIGEN_MAIL_ONDERWERP_MAX, EIGEN_MAIL_TEKST_MAX, GROEP_LABEL, leesAdressen, ONTVANGER_GROEPEN, type EigenMailInvoer, type OntvangerGroep } from '../../../shared/schemas/mail';

/**
 * Zelf een mail sturen (mailtranche PR 5, alleen admin): onderwerp, tekst en
 * ontvangers uit groepen, verzendlijsten, losse gebruikers en vrije
 * adressen. Eerst een voorbeeld met het aantal en de lijst ontvangers (de
 * server bepaalt die), dan pas versturen: één mail per persoon, één regel
 * in het verzendlog.
 */
type Droog = { droog: true; aantal: number; ontvangers: Array<{ adres: string; naam: string }>; onderwerp: string; html: string };

export function EigenMailPaneel({ open, onClose, users, lijsten, onVerstuurd }: {
  open: boolean;
  onClose: () => void;
  users: User[];
  lijsten: Verzendlijst[];
  onVerstuurd: () => void;
}) {
  const [onderwerp, setOnderwerp] = useState('');
  const [tekst, setTekst] = useState('');
  const [groepen, setGroepen] = useState<OntvangerGroep[]>([]);
  const [lijstIds, setLijstIds] = useState<string[]>([]);
  const [gebruikerIds, setGebruikerIds] = useState<string[]>([]);
  const [adressenTekst, setAdressenTekst] = useState('');
  const [zoek, setZoek] = useState('');
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [bezig, setBezig] = useState(false);
  const [voorbeeld, setVoorbeeld] = useState<Droog | null>(null);

  const kandidaten = useMemo(() => users.filter((u) => u.isActive !== false && u.email).sort((a, b) => a.name.localeCompare(b.name, 'nl')), [users]);
  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    return q ? kandidaten.filter((u) => u.name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)) : kandidaten;
  }, [kandidaten, zoek]);
  const adressen = useMemo(() => leesAdressen(adressenTekst), [adressenTekst]);
  const ietsGekozen = groepen.length + lijstIds.length + gebruikerIds.length + adressen.adressen.length > 0;
  const vuil = Boolean(onderwerp || tekst || ietsGekozen);

  const wissel = <T,>(lijst: T[], item: T, aan: boolean) => (aan ? [...new Set([...lijst, item])] : lijst.filter((x) => x !== item));

  const reset = () => {
    setOnderwerp(''); setTekst(''); setGroepen([]); setLijstIds([]); setGebruikerIds([]); setAdressenTekst(''); setZoek(''); setFouten({}); setVoorbeeld(null);
  };

  const invoer = (droog: boolean): EigenMailInvoer => ({
    onderwerp, tekst, droog,
    ontvangers: { groepen, lijsten: lijstIds, gebruikers: gebruikerIds, adressen: adressen.adressen },
  });

  const toonVoorbeeld = async () => {
    const f: Record<string, string> = {};
    if (adressen.fouten.length > 0) f.adressen = `Geen geldig adres: ${adressen.fouten.slice(0, 3).join(', ')}${adressen.fouten.length > 3 ? ', …' : ''}`;
    if (!ietsGekozen) f.ontvangers = 'Kies minstens één ontvanger';
    const check = valideer(eigenMailSchema, invoer(true));
    if (check.ok === false) Object.assign(f, check.fouten);
    setFouten(f);
    if (Object.keys(f).length > 0) return;
    setBezig(true);
    try {
      setVoorbeeld(await apiJson<Droog>('/api/mails/eigen', { method: 'POST', body: JSON.stringify(invoer(true)) }));
    } catch (err) {
      meldSchrijffout('Voorbeeld maken', err);
    } finally {
      setBezig(false);
    }
  };

  const verstuur = async () => {
    if (!voorbeeld) return;
    setBezig(true);
    try {
      const r = await apiJson<{ aantal: number; gelukt: number; mislukt: number; mocked: boolean }>('/api/mails/eigen', { method: 'POST', body: JSON.stringify(invoer(false)) });
      notify(r.mocked ? `Mail gelogd voor ${tel(r.aantal, 'ontvanger', 'ontvangers')} (geen SMTP ingesteld).` : r.mislukt > 0 ? `Mail verstuurd naar ${r.gelukt} van ${r.aantal}; ${r.mislukt} mislukt.` : `Mail verstuurd naar ${tel(r.aantal, 'ontvanger', 'ontvangers')}.`, r.mislukt > 0 ? 'error' : 'success');
      setVoorbeeld(null);
      reset();
      onVerstuurd();
      onClose();
    } catch (err) {
      meldSchrijffout('Mail versturen', err, () => void verstuur());
    } finally {
      setBezig(false);
    }
  };

  return (
    <>
      <SlideOver
        open={open}
        onClose={onClose}
        title="Mail versturen"
        subtitle="Eén mail per persoon, met jouw naam als afzender."
        icon={<Send size={16} />}
        width="lg"
        vuil={vuil}
        footer={(
          <div className="flex items-center gap-2">
            <SluitKnop onClose={onClose} variant="secondary" size="lg" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
            <Button variant="primary" size="lg" className="flex-1" bezig={bezig} onClick={() => void toonVoorbeeld()}>Voorbeeld en versturen</Button>
          </div>
        )}
      >
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void toonVoorbeeld(); }}>
          <Field label="Onderwerp" htmlFor="eigen-onderwerp" error={fouten.onderwerp}>
            <Input id="eigen-onderwerp" value={onderwerp} maxLength={EIGEN_MAIL_ONDERWERP_MAX} onChange={(e) => { setOnderwerp(e.target.value); setFouten((f) => ({ ...f, onderwerp: '' })); }} placeholder="bv. Nieuwe zomeruniformen vanaf 1 juli" />
          </Field>
          <Field label="Bericht" htmlFor="eigen-tekst" error={fouten.tekst} hint="Een witregel begint een nieuwe alinea.">
            <Textarea id="eigen-tekst" rows={8} value={tekst} maxLength={EIGEN_MAIL_TEKST_MAX} onChange={(e) => { setTekst(e.target.value); setFouten((f) => ({ ...f, tekst: '' })); }} placeholder="Schrijf je bericht…" />
          </Field>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-slate-800">Ontvangers</legend>
            {fouten.ontvangers && <p className="text-body-sm text-red-700" role="alert">{fouten.ontvangers}</p>}
            <ul className="space-y-1.5" aria-label="Groepen">
              {ONTVANGER_GROEPEN.map((g) => (
                <li key={g} className="flex items-center gap-2">
                  <Checkbox checked={groepen.includes(g)} onChange={(aan) => setGroepen((x) => wissel(x, g, aan))} label={GROEP_LABEL[g]} />
                  <span className="text-sm text-slate-700">{GROEP_LABEL[g]}</span>
                </li>
              ))}
            </ul>
            {lijsten.length > 0 && (
              <ul className="space-y-1.5" aria-label="Verzendlijsten">
                {lijsten.map((l) => (
                  <li key={l.id} className="flex items-center gap-2">
                    <Checkbox checked={lijstIds.includes(l.id)} onChange={(aan) => setLijstIds((x) => wissel(x, l.id, aan))} label={`Verzendlijst ${l.naam}`} />
                    <span className="text-sm text-slate-700">{l.naam}</span>
                    <Badge tone="slate" kaal>{tel(l.adressen.length, 'adres', 'adressen')}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <SearchField value={zoek} onChange={setZoek} label="Zoek een gebruiker" placeholder="Losse gebruikers zoeken…" size="sm" />
              <ul className="max-h-48 divide-y divide-hairline-subtle overflow-y-auto rounded-xl ring-1 ring-hairline" aria-label="Gebruikers">
                {zichtbaar.length === 0 && <li className="px-3 py-2 text-body-sm text-slate-500">Geen gebruiker gevonden.</li>}
                {zichtbaar.map((u) => (
                  <li key={u.id} className="flex items-center gap-2 px-3 py-1.5">
                    <Checkbox checked={gebruikerIds.includes(u.id)} onChange={(aan) => setGebruikerIds((x) => wissel(x, u.id, aan))} label={u.name} />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{u.name}</span>
                    <span className="text-xs text-slate-500">{ROL_LABEL[u.role]}</span>
                  </li>
                ))}
              </ul>
              {gebruikerIds.length > 0 && <p className="text-xs text-slate-500">{tel(gebruikerIds.length, 'gebruiker', 'gebruikers')} gekozen.</p>}
            </div>
            <Field label="Vrije adressen" htmlFor="eigen-adressen" error={fouten.adressen} hint="Eén per regel of met komma's; ook buiten het portaal.">
              <Textarea id="eigen-adressen" rows={3} value={adressenTekst} onChange={(e) => { setAdressenTekst(e.target.value); setFouten((f) => ({ ...f, adressen: '' })); }} placeholder="dispatching@delijn.be" />
            </Field>
          </fieldset>
        </form>
      </SlideOver>

      <Modal open={voorbeeld !== null} onClose={() => setVoorbeeld(null)} maxWidth="2xl" ariaLabel="Voorbeeld van je mail" boven>
        {voorbeeld && (
          <div className="space-y-3">
            <div>
              <p className="text-card-title">Naar {tel(voorbeeld.aantal, 'ontvanger', 'ontvangers')}</p>
              <p className="mt-0.5 break-words text-body-sm text-slate-500">
                {voorbeeld.ontvangers.slice(0, 12).map((o) => o.naam).join(', ')}{voorbeeld.ontvangers.length > 12 ? ` en nog ${voorbeeld.ontvangers.length - 12}` : ''}.
              </p>
            </div>
            <iframe title="Voorbeeld van je mail" srcDoc={voorbeeld.html} sandbox="" className="h-[55vh] min-h-[360px] w-full rounded-xl bg-surface-white ring-1 ring-hairline" />
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
