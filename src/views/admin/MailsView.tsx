import { useEffect, useMemo, useState } from 'react';
import { Bell, Eye, ListChecks, Mail, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '../../components/Card';
import { Badge, Button, IconButton, Switch } from '../../components/primitives';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Modal, SluitKnop } from '../../components/Modal';
import { Field, Input, Textarea } from '../../components/Field';
import { Tabel, TableShell, Td, Th } from '../../components/TabelBasis';
import { InfoTip } from '../../components/InfoTip';
import { apiJson } from '../../lib/api';
import { notify } from '../../lib/ui';
import { meldSchrijffout } from '../../lib/fouten';
import { formatDateTimeHuman, aantal as tel } from '../../lib/format';
import { leesAdressen, naamVanSoort, type MailInstellingen, type MailSoortInfo, type Verzendlijst } from '../../../shared/schemas/mail';
import type { User } from '../../types';
import { EigenMailPaneel } from './EigenMail';

/**
 * Beheer › Mails (mailtranche PR 3, admin): elke automatische mail met
 * wanneer, naar wie, of er ook een push uitgaat, een voorbeeld en wanneer
 * ze het laatst verstuurd is; een schakelaar per mail die uit mag; de
 * verzendlijsten voor de mailknop op een omleiding en het zelf mailen; en
 * het verzendlog (soort, moment, aantal, gelukt, door wie; nooit inhoud).
 */

type Soort = MailSoortInfo & { aan: boolean; laatst: { op: string; aantal: number; gelukt: boolean } | null };
type LogRij = { id: string; verzondenOp: string; soort: string; aantal: number; gelukt: boolean; fout?: string | null; door?: string | null };
type Antwoord = { soorten: Soort[]; instellingen: MailInstellingen; verzendlijsten: Verzendlijst[]; log: LogRij[] };

const nieuwId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `l-${Date.now()}`);

export function MailsView({ users }: { users: User[] }) {
  const [data, setData] = useState<Antwoord | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [eigenOpen, setEigenOpen] = useState(false);

  const laad = async () => {
    try {
      setData(await apiJson<Antwoord>('/api/mails'));
      setFout(null);
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Laden is mislukt.');
    }
  };
  useEffect(() => { void laad(); }, []);

  return (
    <PageShell>
      <PageHeader
        view="beheer-mails"
        title="Mails"
        description="Welke mails het portaal verstuurt, de verzendlijsten en het verzendlog."
        actions={<Button variant="primary" icon={<Send size={16} />} onClick={() => setEigenOpen(true)}>Mail versturen</Button>}
      />
      <EigenMailPaneel open={eigenOpen} onClose={() => setEigenOpen(false)} users={users} lijsten={data?.verzendlijsten ?? []} onVerstuurd={() => void laad()} />
      {fout ? (
        <EmptyState variant="fout" title="Mails laden is mislukt" message={fout} action={<Button variant="secondary" onClick={() => void laad()}>Opnieuw proberen</Button>} />
      ) : (
        <div className="space-y-6">
          <AutomatischeMails soorten={data?.soorten ?? null} instellingen={data?.instellingen ?? { uit: [] }} onGewijzigd={(inst) => setData((d) => (d ? { ...d, instellingen: inst, soorten: d.soorten.map((s) => ({ ...s, aan: s.altijdAan ? true : !inst.uit.includes(s.soort) })) } : d))} />
          <Verzendlijsten lijsten={data?.verzendlijsten ?? null} onGewijzigd={(lijsten) => setData((d) => (d ? { ...d, verzendlijsten: lijsten } : d))} />
          <Verzendlog log={data?.log ?? null} />
        </div>
      )}
    </PageShell>
  );
}

// --- Automatische mails ---

function AutomatischeMails({ soorten, instellingen, onGewijzigd }: { soorten: Soort[] | null; instellingen: MailInstellingen; onGewijzigd: (i: MailInstellingen) => void }) {
  const [bezig, setBezig] = useState<string | null>(null);
  const [voorbeeld, setVoorbeeld] = useState<{ soort: Soort; onderwerp: string; html: string } | null>(null);
  const [voorbeeldBezig, setVoorbeeldBezig] = useState<string | null>(null);

  const zet = async (soort: Soort, aan: boolean) => {
    const uit = aan ? instellingen.uit.filter((s) => s !== soort.soort) : [...new Set([...instellingen.uit, soort.soort])];
    setBezig(soort.soort);
    try {
      const opgeslagen = await apiJson<MailInstellingen>('/api/mails/instellingen', { method: 'PUT', body: JSON.stringify({ uit }) });
      onGewijzigd(opgeslagen);
      notify(aan ? `${soort.naam} staat weer aan.` : `${soort.naam} staat uit; er gaat geen mail meer uit.`, 'success');
    } catch (err) {
      meldSchrijffout('Mailinstelling opslaan', err, () => void zet(soort, aan));
    } finally {
      setBezig(null);
    }
  };

  const toonVoorbeeld = async (soort: Soort) => {
    setVoorbeeldBezig(soort.soort);
    try {
      const v = await apiJson<{ onderwerp: string; html: string }>(`/api/mails/voorbeeld/${encodeURIComponent(soort.soort)}`);
      setVoorbeeld({ soort, ...v });
    } catch (err) {
      meldSchrijffout('Voorbeeld laden', err);
    } finally {
      setVoorbeeldBezig(null);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<Mail size={18} />}
        title="Automatische mails"
        description="Wat het portaal uit zichzelf verstuurt. Zet een mail uit en ze gaat niet meer de deur uit; de melding in het portaal en de push blijven."
      />
      {soorten === null ? (
        <p className="mt-4 text-body-sm text-slate-500" role="status">Laden…</p>
      ) : (
        <ul className="mt-4" aria-label="Automatische mails">
          {soorten.map((s) => (
            <li key={s.soort} className="flex flex-wrap items-start gap-3 border-b border-hairline-subtle py-3.5 first:pt-0 last:border-b-0 last:pb-0">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600"><Mail size={16} /></span>
              <div className="min-w-[12rem] flex-1 basis-0">
                <p className="flex flex-wrap items-center gap-2 text-md font-semibold text-slate-900">
                  {s.naam}
                  {s.push && <Badge tone="slate" icon={<Bell size={12} />}>ook push</Badge>}
                  {s.viaSupabase && <Badge tone="slate" stil>via Supabase</Badge>}
                  {!s.aan && <Badge tone="amber" dot>Uit</Badge>}
                </p>
                <p className="mt-0.5 break-words text-body-sm text-slate-500">{s.wanneer}. Naar: {s.ontvangers}.</p>
                <p className="mt-1 text-xs text-slate-500 tabular-nums">
                  {s.laatst ? `Laatst verstuurd ${formatDateTimeHuman(s.laatst.op)} naar ${tel(s.laatst.aantal, 'ontvanger', 'ontvangers')}` : 'Nog niet verstuurd sinds het verzendlog bestaat'}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 pt-0.5">
                <Button variant="ghost" size="sm" icon={<Eye size={14} />} bezig={voorbeeldBezig === s.soort} onClick={() => void toonVoorbeeld(s)}>Voorbeeld</Button>
                {s.altijdAan ? (
                  <Badge tone="slate" stil title="Zonder deze mail werkt het portaal niet of verlies je je vangnet">Altijd aan</Badge>
                ) : (
                  <Switch checked={s.aan} disabled={bezig === s.soort} label={`${s.naam} versturen`} onChange={(aan) => { void zet(s, aan); }} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={voorbeeld !== null} onClose={() => setVoorbeeld(null)} maxWidth="2xl" ariaLabel={voorbeeld ? `Voorbeeld: ${voorbeeld.soort.naam}` : 'Voorbeeld'}>
        {voorbeeld && (
          <div className="space-y-3">
            <div>
              <p className="text-card-title">{voorbeeld.soort.naam}</p>
              <p className="mt-0.5 text-body-sm text-slate-500">Onderwerp: {voorbeeld.onderwerp}</p>
            </div>
            <iframe title={`Voorbeeld ${voorbeeld.soort.naam}`} srcDoc={voorbeeld.html} sandbox="" className="h-[70vh] min-h-[420px] w-full rounded-xl bg-surface-white ring-1 ring-hairline" />
            <div className="flex justify-end">
              <SluitKnop onClose={() => setVoorbeeld(null)} variant="secondary">Sluiten</SluitKnop>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

// --- Verzendlijsten ---

function Verzendlijsten({ lijsten, onGewijzigd }: { lijsten: Verzendlijst[] | null; onGewijzigd: (l: Verzendlijst[]) => void }) {
  const [bewerk, setBewerk] = useState<Verzendlijst | null>(null);
  const [verwijder, setVerwijder] = useState<Verzendlijst | null>(null);
  const [bezig, setBezig] = useState(false);

  const bewaar = async (volgende: Verzendlijst[], melding: string) => {
    setBezig(true);
    try {
      onGewijzigd(await apiJson<Verzendlijst[]>('/api/mails/verzendlijsten', { method: 'PUT', body: JSON.stringify(volgende) }));
      notify(melding, 'success');
      return true;
    } catch (err) {
      meldSchrijffout('Verzendlijsten opslaan', err);
      return false;
    } finally {
      setBezig(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<ListChecks size={18} />}
        title="Verzendlijsten"
        description="Vaste groepen adressen, ook buiten het portaal (bv. De Lijn of de garage). Te kiezen bij de mailknop op een omleiding en bij het zelf versturen van een mail."
        aside={<Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => setBewerk({ id: nieuwId(), naam: '', adressen: [] })}>Nieuwe lijst</Button>}
      />
      {lijsten === null ? (
        <p className="mt-4 text-body-sm text-slate-500" role="status">Laden…</p>
      ) : lijsten.length === 0 ? (
        <div className="mt-4"><EmptyState compact kaal title="Nog geen verzendlijsten" message="Maak een lijst met de adressen die je vaker samen mailt." /></div>
      ) : (
        <ul className="mt-4" aria-label="Verzendlijsten">
          {lijsten.map((l) => (
            <li key={l.id} className="flex flex-wrap items-start gap-3 border-b border-hairline-subtle py-3.5 first:pt-0 last:border-b-0 last:pb-0">
              <div className="min-w-[12rem] flex-1 basis-0">
                <p className="text-md font-semibold text-slate-900">{l.naam}</p>
                <p className="mt-0.5 break-words text-body-sm text-slate-500">{tel(l.adressen.length, 'adres', 'adressen')}{l.adressen.length > 0 ? `: ${l.adressen.slice(0, 3).join(', ')}${l.adressen.length > 3 ? ', …' : ''}` : ''}</p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <IconButton label={`Lijst ${l.naam} bewerken`} variant="ghost" size="sm" onClick={() => setBewerk(l)}><Pencil size={14} /></IconButton>
                <IconButton label={`Lijst ${l.naam} verwijderen`} variant="ghost" size="sm" onClick={() => setVerwijder(l)}><Trash2 size={14} /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <VerzendlijstModal
        lijst={bewerk}
        bezig={bezig}
        onClose={() => setBewerk(null)}
        onBewaar={async (l) => {
          const huidig = lijsten ?? [];
          const bestaat = huidig.some((x) => x.id === l.id);
          const volgende = bestaat ? huidig.map((x) => (x.id === l.id ? l : x)) : [...huidig, l];
          if (await bewaar(volgende, bestaat ? 'Verzendlijst bijgewerkt.' : 'Verzendlijst toegevoegd.')) setBewerk(null);
        }}
      />
      <ConfirmationModal
        open={verwijder !== null}
        onClose={() => setVerwijder(null)}
        title={verwijder ? `Lijst “${verwijder.naam}” verwijderen?` : 'Lijst verwijderen?'}
        message="De adressen zelf blijven bestaan in de mailbox van de ontvangers; alleen de lijst verdwijnt."
        confirmText="Verwijderen"
        onConfirm={async () => {
          if (!verwijder) return;
          if (await bewaar((lijsten ?? []).filter((x) => x.id !== verwijder.id), 'Verzendlijst verwijderd.')) setVerwijder(null);
        }}
      />
    </Card>
  );
}

function VerzendlijstModal({ lijst, bezig, onClose, onBewaar }: { lijst: Verzendlijst | null; bezig: boolean; onClose: () => void; onBewaar: (l: Verzendlijst) => Promise<void> }) {
  const [naam, setNaam] = useState('');
  const [tekst, setTekst] = useState('');
  const [fouten, setFouten] = useState<{ naam?: string; adressen?: string }>({});
  useEffect(() => {
    if (lijst) { setNaam(lijst.naam); setTekst(lijst.adressen.join('\n')); setFouten({}); }
  }, [lijst]);
  const gelezen = useMemo(() => leesAdressen(tekst), [tekst]);
  const nieuw = lijst !== null && lijst.naam === '' && lijst.adressen.length === 0;
  const vuil = lijst !== null && (naam.trim() !== lijst.naam || gelezen.adressen.join('\n') !== lijst.adressen.join('\n'));

  const verstuur = () => {
    const f: typeof fouten = {};
    if (!naam.trim()) f.naam = 'Geef de lijst een naam';
    if (gelezen.fouten.length > 0) f.adressen = `Geen geldig adres: ${gelezen.fouten.slice(0, 3).join(', ')}${gelezen.fouten.length > 3 ? ', …' : ''}`;
    else if (gelezen.adressen.length === 0) f.adressen = 'Vul minstens één adres in';
    setFouten(f);
    if (Object.keys(f).length > 0 || !lijst) return;
    void onBewaar({ id: lijst.id, naam: naam.trim(), adressen: gelezen.adressen });
  };

  return (
    <Modal open={lijst !== null} onClose={onClose} vuil={vuil} maxWidth="md" ariaLabel={nieuw ? 'Nieuwe verzendlijst' : 'Verzendlijst bewerken'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); verstuur(); }}>
        <p className="text-card-title">{nieuw ? 'Nieuwe verzendlijst' : 'Verzendlijst bewerken'}</p>
        <Field label="Naam" htmlFor="verzendlijst-naam" error={fouten.naam}>
          <Input id="verzendlijst-naam" value={naam} maxLength={60} onChange={(e) => { setNaam(e.target.value); setFouten((f) => ({ ...f, naam: undefined })); }} placeholder="bv. De Lijn, dispatching Gent" />
        </Field>
        <Field label="Adressen" htmlFor="verzendlijst-adressen" error={fouten.adressen} hint={`Eén adres per regel (of gescheiden door een komma). ${tel(gelezen.adressen.length, 'geldig adres', 'geldige adressen')}.`}>
          <Textarea id="verzendlijst-adressen" rows={6} value={tekst} onChange={(e) => { setTekst(e.target.value); setFouten((f) => ({ ...f, adressen: undefined })); }} placeholder={'planning@voorbeeld.be\ndispatching@voorbeeld.be'} />
        </Field>
        <div className="flex items-center justify-end gap-2">
          <SluitKnop onClose={onClose} variant="secondary" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" bezig={bezig}>{nieuw ? 'Toevoegen' : 'Opslaan'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// --- Verzendlog ---

function Verzendlog({ log }: { log: LogRij[] | null }) {
  return (
    <Card>
      <CardHeader
        icon={<ListChecks size={18} />}
        title="Verzendlog"
        description="De laatste honderd verzendingen: wat, wanneer, naar hoeveel ontvangers en door wie. Bewust zonder inhoud of adressen."
        aside={<InfoTip label="Uitleg bij het verzendlog"><p>Een regel met "uitgeschakeld" betekent dat de mail zou zijn uitgegaan maar hier uit staat. Zonder SMTP-instellingen wordt elke mail alleen gelogd.</p></InfoTip>}
      />
      {log === null ? (
        <p className="mt-4 text-body-sm text-slate-500" role="status">Laden…</p>
      ) : log.length === 0 ? (
        <div className="mt-4"><EmptyState compact kaal title="Nog niets verstuurd" message="Zodra het portaal een mail verstuurt, staat ze hier." /></div>
      ) : (
        <div className="mt-4">
          <TableShell label="Verzendlog" past>
            <Tabel label="Verzendlog">
              <thead>
                <tr>
                  <Th>Moment</Th>
                  <Th>Mail</Th>
                  <Th num>Ontvangers</Th>
                  <Th>Status</Th>
                  <Th>Door</Th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <Td nowrap>{formatDateTimeHuman(r.verzondenOp)}</Td>
                    <Td>{naamVanSoort(r.soort)}</Td>
                    <Td num>{r.aantal}</Td>
                    <Td>{r.gelukt ? <Badge tone="emerald" stil>Verstuurd</Badge> : <span className="inline-flex flex-wrap items-center gap-1.5"><Badge tone="amber" stil>{/uitgeschakeld/i.test(r.fout ?? '') ? 'Uitgeschakeld' : /SMTP niet/i.test(r.fout ?? '') ? 'Alleen gelogd' : 'Mislukt'}</Badge>{r.fout && !/uitgeschakeld|SMTP niet/i.test(r.fout) && <span className="text-xs text-slate-500">{r.fout}</span>}</span>}</Td>
                    <Td nowrap>{r.door ?? 'Systeem'}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          </TableShell>
        </div>
      )}
    </Card>
  );
}
