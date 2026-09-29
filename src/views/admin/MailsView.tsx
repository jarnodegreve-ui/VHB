import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Eye, ListChecks, Mail, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { Card, CardHeader } from '../../components/Card';
import { Badge, Button, IconButton, Switch, TOON_NAAR_BADGE } from '../../components/primitives';
import { ConfirmationModal, EmptyState, Foutkaart, ModalHeader, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { Skeleton } from '../../components/Skeleton';
import { Verwissel } from '../../components/Verwissel';
import { useZelfLadend } from '../../lib/zelfLadend';
import { Modal, SluitKnop } from '../../components/Modal';
import { Field, Input, Textarea } from '../../components/Field';
import { Tabel, TableShell, Td, Th } from '../../components/TabelBasis';
import { InfoTip } from '../../components/InfoTip';
import { apiJson } from '../../lib/api';
import { cn, notify } from '../../lib/ui';
import { meldSchrijffout } from '../../lib/fouten';
import { Formulier } from '../../components/Formulier';
import { useVeldfouten, useVuil, type Veldfouten } from '../../lib/formulier';
import { formatDateTimeHuman, aantal as tel } from '../../lib/format';
import { EXTRA_SOORT_NAMEN, leesAdressen, MAIL_SOORTEN, type MailInstellingen, type MailSoortInfo, type Verzendlijst } from '../../../shared/schemas/mail';
import { MAIL_LOG_STATUS, mailLogStatus, mailLogToelichting, mailLogVraagtAandacht } from '../../../shared/mailLog';
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
  const [eigenOpen, setEigenOpen] = useState(false);

  // Laden, opnieuw proberen en verversen via het gedeelde model (nr. 22):
  // stil verversen bij terugkeer naar het tabblad en als de verbinding
  // terugkomt. Een verversing vervangt alleen wat de server stuurt; de
  // formulieren en vensters houden hun eigen invoer en raken die niet kwijt.
  // `schrijf` telt de eigen wijzigingen (schakelaar, verzendlijsten): een
  // antwoord dat vóór zo'n wijziging vertrok is ouder dan het scherm en wordt
  // genegeerd. Anders zette een verversing de oude verzendlijsten terug, en
  // schreef de volgende opslag (die de hele lijst stuurt) die oude stand weg.
  const schrijf = useRef(0);
  const zl = useZelfLadend(async () => {
    const bij = schrijf.current;
    const antwoord = await apiJson<Antwoord>('/api/mails');
    if (bij === schrijf.current) setData(antwoord);
  }, { boodschap: 'De mails konden niet laden.' });
  const gewijzigd = (pas: (d: Antwoord) => Antwoord) => {
    schrijf.current += 1;
    setData((d) => (d ? pas(d) : d));
  };
  // Een laadfout is geen lege staat (nr. 14): zonder gegevens geen scherm met
  // lege lijsten en geen maak-acties. "Mail versturen" zou anders opengaan
  // zonder verzendlijsten, alsof er geen bestaan.
  const foutZonderData = !!zl.fout && data === null;

  return (
    <PageShell>
      <PageHeader
        view="beheer-mails"
        title="Mails"
        description="Welke mails het portaal verstuurt, de verzendlijsten en het verzendlog."
        actions={(
          <>
            {/* Ook tijdens een zichtbare laad "Bijwerken…": de regel staat er dan
                al en de kop groeit niet op het moment dat de gegevens komen
                (onder 1280 px staat hij op een eigen regel). */}
            <VersheidRegel {...zl.versheid} verversen={zl.verversen || zl.laden} />
            {!foutZonderData && <Button variant="primary" icon={<Send size={16} />} disabled={data === null} onClick={() => setEigenOpen(true)}>Mail versturen</Button>}
          </>
        )}
      />
      <EigenMailPaneel open={eigenOpen && data !== null} onClose={() => setEigenOpen(false)} users={users} lijsten={data?.verzendlijsten ?? []} onVerstuurd={() => void zl.ververs()} />
      {zl.fout && <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} compact={data !== null} className={data !== null ? 'mb-6' : undefined} />}
      {!foutZonderData && (
        <div className="space-y-6">
          <AutomatischeMails soorten={data?.soorten ?? null} instellingen={data?.instellingen ?? { uit: [] }} onGewijzigd={(inst) => gewijzigd((d) => ({ ...d, instellingen: inst, soorten: d.soorten.map((s) => ({ ...s, aan: s.altijdAan ? true : !inst.uit.includes(s.soort) })) }))} />
          <Verzendlijsten lijsten={data?.verzendlijsten ?? null} onGewijzigd={(lijsten) => gewijzigd((d) => ({ ...d, verzendlijsten: lijsten }))} />
          <Verzendlog log={data?.log ?? null} soorten={data?.soorten ?? []} />
        </div>
      )}
    </PageShell>
  );
}

// --- Laden ---
// Zolang de gegevens er niet zijn staan de drie kaarten er al, met hun echte
// kop (nr. 22). Vroeger stond in elke kaart de tekst "Laden…" en sprong alles
// onder de eerste kaart een scherm omlaag zodra de mailsoorten verschenen.

/** Een regel tekst als skeletbalk, in een vak met de hoogte van die regel. */
const Regel = ({ hoogte, balk }: { hoogte: string; balk: string }) => <div className={cn('flex items-center', hoogte)}><Skeleton className={balk} /></div>;

/** Skelet van de verzendlijsten: de maten van een rij (naam, adressen, twee knoppen). */
function SkeletLijsten() {
  return (
    <div className="mt-4" role="status" aria-busy="true" aria-label="Verzendlijsten worden geladen">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-wrap items-start gap-3 border-b border-hairline-subtle py-3.5 first:pt-0 last:border-b-0 last:pb-0">
          <div className="min-w-[12rem] flex-1 basis-0">
            <Regel hoogte="h-[1.45rem]" balk="h-3.5 w-40" />
            <div className="mt-0.5"><Regel hoogte="h-[1.26rem]" balk="h-3 w-4/5" /></div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Skeleton rounded="xl" className="h-9 w-9 sm:pointer-fine:h-8 sm:pointer-fine:w-8" />
            <Skeleton rounded="xl" className="h-9 w-9 sm:pointer-fine:h-8 sm:pointer-fine:w-8" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Een mailsoort zolang de server nog niet geantwoord heeft: wat vastligt
 *  (naam, wanneer, naar wie) is bekend, of ze aan staat en wanneer ze het
 *  laatst vertrok nog niet. */
type SoortRij = MailSoortInfo & Partial<Pick<Soort, 'aan' | 'laatst'>>;
const NOG_NIET_VERSTUURD = 'Nog niet verstuurd sinds het verzendlog bestaat';
/** Houdt tijdens het laden de plaats vrij van de regel "laatst verstuurd":
 *  onzichtbare opvulling die precies zo breed is als de regel meestal is
 *  ("Laatst verstuurd wo 23 september om 12:00 naar 2 ontvangers", elk woord
 *  achterstevoren: zelfde letters, zelfde woordgrenzen), zodat ze op een
 *  smalle telefoon net als de echte regel over twee regels loopt. Bewust geen
 *  leesbare tekst: er staat niets dat nog niet bekend is. */
const PLAATS_LAATST = 'tstaaL druutsrev ow 32 rebmetpes mo 00:21 raan 2 sregnavtno';

// --- Automatische mails ---

function AutomatischeMails({ soorten, instellingen, onGewijzigd }: { soorten: Soort[] | null; instellingen: MailInstellingen; onGewijzigd: (i: MailInstellingen) => void }) {
  // Tijdens het laden staan de mailsoorten er al, uit dezelfde lijst die de
  // server gebruikt (MAIL_SOORTEN): elke rij heeft dan meteen haar echte
  // hoogte, op elke schermbreedte, en de kaarten eronder verspringen niet.
  // Alleen wat van de server komt is nog een skelet: de schakelaar en de
  // regel "laatst verstuurd".
  const laden = soorten === null;
  const rijen: readonly SoortRij[] = soorten ?? MAIL_SOORTEN;
  const [bezig, setBezig] = useState<string | null>(null);
  const [voorbeeld, setVoorbeeld] = useState<{ soort: MailSoortInfo; onderwerp: string; html: string } | null>(null);
  const [voorbeeldBezig, setVoorbeeldBezig] = useState<string | null>(null);

  const zet = async (soort: MailSoortInfo, aan: boolean) => {
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

  const toonVoorbeeld = async (soort: MailSoortInfo) => {
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
        <ul className="mt-4" aria-label="Automatische mails" aria-busy={laden || undefined}>
          {rijen.map((s) => (
            <li key={s.soort} className="flex flex-wrap items-start gap-3 border-b border-hairline-subtle py-3.5 first:pt-0 last:border-b-0 last:pb-0">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600"><Mail size={16} /></span>
              <div className="min-w-[12rem] flex-1 basis-0">
                <p className="flex flex-wrap items-center gap-2 text-md font-semibold text-slate-900">
                  {s.naam}
                  {s.push && <Badge tone="slate" icon={<Bell size={12} />}>ook push</Badge>}
                  {s.viaSupabase && <Badge tone="slate" stil>via Supabase</Badge>}
                  {s.aan === false && <Badge tone="amber" dot>Uit</Badge>}
                </p>
                <p className="mt-0.5 break-words text-body-sm text-slate-500">{s.wanneer}. Naar: {s.ontvangers}.</p>
                <Verwissel
                  laden={laden}
                  skelet={(
                    // De onzichtbare tekst houdt de plaats van de regel vrij
                    // (op een smal scherm twee regels), de balk ligt erover.
                    // Geen eigen status per rij: de lijst zelf is aria-busy en de
                    // kop zegt "Bijwerken…"; elf statusvelden zou een
                    // schermlezer elf keer voorlezen.
                    <div className="relative" aria-hidden="true">
                      <p className="invisible mt-1 text-xs tabular-nums">{PLAATS_LAATST}</p>
                      <div className="absolute inset-x-0 top-1"><Regel hoogte="h-4" balk="h-2.5 w-44 max-w-full" /></div>
                    </div>
                  )}
                >
                  <p className="mt-1 text-xs text-slate-500 tabular-nums">
                    {s.laatst ? `Laatst verstuurd ${formatDateTimeHuman(s.laatst.op)} naar ${tel(s.laatst.aantal, 'ontvanger', 'ontvangers')}` : NOG_NIET_VERSTUURD}
                  </p>
                </Verwissel>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 pt-0.5">
                <Button variant="ghost" size="sm" icon={<Eye size={14} />} disabled={laden} bezig={voorbeeldBezig === s.soort} onClick={() => void toonVoorbeeld(s)}>Voorbeeld</Button>
                {s.altijdAan ? (
                  <Badge tone="slate" stil title="Zonder deze mail werkt het portaal niet of verlies je je vangnet">Altijd aan</Badge>
                ) : (
                  <Verwissel
                    laden={laden}
                    // Zelfde raakvlak en rail als de Switch.
                    skelet={<div className="inline-flex min-h-11 min-w-11 items-center justify-center sm:pointer-fine:min-h-6" aria-hidden="true"><Skeleton rounded="full" className="h-6 w-11" /></div>}
                  >
                    <Switch checked={s.aan !== false} disabled={bezig === s.soort} label={`${s.naam} versturen`} onChange={(aan) => { void zet(s, aan); }} />
                  </Verwissel>
                )}
              </div>
            </li>
          ))}
        </ul>

      <Modal open={voorbeeld !== null} onClose={() => setVoorbeeld(null)} maxWidth="2xl" ariaLabel={voorbeeld ? `Voorbeeld: ${voorbeeld.soort.naam}` : 'Voorbeeld'}>
        {voorbeeld && (
          <>
            {/* Zonder kruisje: de knop Sluiten onderaan is de enige sluitknop. */}
            <ModalHeader title={voorbeeld.soort.naam} description={`Onderwerp: ${voorbeeld.onderwerp}`} />
            <div className="space-y-4 p-6">
              <iframe title={`Voorbeeld ${voorbeeld.soort.naam}`} srcDoc={voorbeeld.html} sandbox="" className="h-[60vh] min-h-[360px] w-full rounded-xl bg-surface-white ring-1 ring-hairline" />
              <div className="flex justify-end">
                <SluitKnop onClose={() => setVoorbeeld(null)} variant="secondary">Sluiten</SluitKnop>
              </div>
            </div>
          </>
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
        // Pas na het laden: opslaan schrijft de hele lijst, en een nieuwe lijst
        // op een nog niet geladen stand zou de bestaande overschrijven.
        aside={<Button variant="secondary" size="sm" icon={<Plus size={16} />} disabled={lijsten === null} onClick={() => setBewerk({ id: nieuwId(), naam: '', adressen: [] })}>Nieuwe lijst</Button>}
      />
      <Verwissel laden={lijsten === null} skelet={<SkeletLijsten />}>
      {lijsten === null ? null : lijsten.length === 0 ? (
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
      </Verwissel>

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
  // Veldfouten en onbewaarde invoer via de gedeelde formulierlaag (nr. 21).
  const veld = useVeldfouten();
  const fouten = veld.fouten;
  // Telt elke keer dat het formulier gevuld wordt, zodat useVuil een nieuwe
  // momentopname neemt (zelfde patroon als Beheer omleidingen).
  const [vulling, setVulling] = useState(0);
  useEffect(() => {
    if (lijst) { setNaam(lijst.naam); setTekst(lijst.adressen.join('\n')); veld.wis(); setVulling((v) => v + 1); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lijst]);
  const gelezen = useMemo(() => leesAdressen(tekst), [tekst]);
  const nieuw = lijst !== null && lijst.naam === '' && lijst.adressen.length === 0;
  const { vuil } = useVuil({ naam: naam.trim(), adressen: gelezen.adressen }, lijst !== null, vulling);

  const verstuur = async () => {
    const f: Veldfouten = {};
    if (!naam.trim()) f.naam = 'Geef de lijst een naam';
    if (gelezen.fouten.length > 0) f.adressen = `Geen geldig adres: ${gelezen.fouten.slice(0, 3).join(', ')}${gelezen.fouten.length > 3 ? ', …' : ''}`;
    else if (gelezen.adressen.length === 0) f.adressen = 'Vul minstens één adres in';
    veld.zet(f);
    if (Object.keys(f).length > 0 || !lijst) return;
    await onBewaar({ id: lijst.id, naam: naam.trim(), adressen: gelezen.adressen });
  };

  return (
    <Modal open={lijst !== null} onClose={onClose} vuil={vuil} maxWidth="md" ariaLabel={nieuw ? 'Nieuwe verzendlijst' : 'Verzendlijst bewerken'}>
      <ModalHeader title={nieuw ? 'Nieuwe verzendlijst' : 'Verzendlijst bewerken'} onClose={onClose} />
      <Formulier noValidate className="space-y-4 p-6" onVerstuur={verstuur}>
        <Field label="Naam" htmlFor="verzendlijst-naam" error={fouten.naam}>
          <Input id="verzendlijst-naam" value={naam} maxLength={60} onChange={(e) => { setNaam(e.target.value); veld.wisVeld('naam'); }} placeholder="bv. De Lijn, dispatching Gent" />
        </Field>
        <Field label="Adressen" htmlFor="verzendlijst-adressen" error={fouten.adressen} hint={`Eén adres per regel (of gescheiden door een komma). ${tel(gelezen.adressen.length, 'geldig adres', 'geldige adressen')}.`}>
          <Textarea id="verzendlijst-adressen" rows={6} value={tekst} onChange={(e) => { setTekst(e.target.value); veld.wisVeld('adressen'); }} placeholder={'planning@voorbeeld.be\ndispatching@voorbeeld.be'} />
        </Field>
        <div className="flex items-center justify-end gap-2">
          <SluitKnop onClose={onClose} variant="secondary" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" bezig={bezig}>{nieuw ? 'Toevoegen' : 'Opslaan'}</Button>
        </div>
      </Formulier>
    </Modal>
  );
}

// --- Verzendlog ---

function Verzendlog({ log, soorten }: { log: LogRij[] | null; soorten: Soort[] }) {
  // De namen komen van de server (dezelfde lijst als hierboven op het scherm),
  // zodat de lijst met mailsoorten niet ook in de bundel van het scherm zit.
  const naamVan = (soort: string) => soorten.find((s) => s.soort === soort)?.naam ?? EXTRA_SOORT_NAMEN[soort] ?? soort;
  // Eén woordenschat (shared/mailLog.ts). Een fout is rood en een onderbroken
  // verzending een volle amber pil (nr. 25); vroeger waren Mislukt,
  // Uitgeschakeld en Alleen gelogd dezelfde stille amber pil.
  const rijen = (log ?? []).map((r) => {
    const status = mailLogStatus(r);
    return {
      id: r.id,
      moment: formatDateTimeHuman(r.verzondenOp),
      mail: naamVan(r.soort),
      aantal: r.aantal,
      door: r.door ?? 'Systeem',
      toelichting: mailLogToelichting(status, r.fout),
      pil: <Badge tone={TOON_NAAR_BADGE[MAIL_LOG_STATUS[status].toon]} className="shrink-0 whitespace-nowrap" {...(mailLogVraagtAandacht(status) ? { dot: true } : { stil: true })}>{MAIL_LOG_STATUS[status].label}</Badge>,
    };
  });
  return (
    // Het tabelkader is zelf de kaart (kop = CardHeader): vroeger stond het
    // kader in een kaart met dezelfde radius, doos in doos.
    // Tabel of lijst volgt de breedte van dit kader (container query, bewust
    // geen md, nr. 6): het kader is op 1024 px, naast de zijbalk, smaller
    // (43 rem) dan op 768 px (44,5 rem). Gemeten vragen de vijf kolommen met
    // een lange naam en een reden hoogstens ±40 rem; de tabel verschijnt vanaf
    // 42 rem, daaronder een lijst met dezelfde gegevens per verzending. Op de
    // telefoon viel vroeger alles na de tweede kolom weg en was het niet te
    // bereiken. Bewust zonder `past`: die knipt stil af wat niet past; mocht
    // een uitzonderlijk lange naam de tabel toch breder maken, dan schuift ze
    // in haar kader.
    <TableShell
      label="Verzendlog"
      className="@container"
      kop={(
        <CardHeader
          icon={<ListChecks size={18} />}
          title="Verzendlog"
          description="De laatste honderd verzendingen: wat, wanneer, naar hoeveel ontvangers en door wie. Bewust zonder inhoud of adressen."
          aside={<InfoTip label="Uitleg bij het verzendlog"><p>“Uitgeschakeld” betekent dat de mail zou zijn uitgegaan maar hier uit staat. Zonder SMTP-instellingen wordt elke mail alleen gelogd. “Onderbroken” betekent dat de verzending niet is afgerond: een deel van de mails kan vertrokken zijn.</p></InfoTip>}
        />
      )}
    >
      <Verwissel
        laden={log === null}
        skelet={(
          // De maten van een rij in de lijst (px-5 py-3.5: mail en status,
          // daaronder de metaregel); ook in de tabel is een rij zo hoog.
          <div className="divide-y divide-hairline-subtle" role="status" aria-busy="true" aria-label="Verzendlog wordt geladen">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-3"><Skeleton className="h-3.5 w-36" /><Skeleton rounded="full" className="h-6 w-24" /></div>
                <div className="mt-1"><Regel hoogte="h-4" balk="h-2.5 w-3/5" /></div>
              </div>
            ))}
          </div>
        )}
      >
      {log === null ? null : log.length === 0 ? (
        <div className="p-6"><EmptyState compact kaal title="Nog niets verstuurd" message="Zodra het portaal een mail verstuurt, staat ze hier." /></div>
      ) : (
        <>
          <div className="hidden @[42rem]:block">
            <Tabel>
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
                {rijen.map((r) => (
                  <tr key={r.id}>
                    <Td nowrap>{r.moment}</Td>
                    <Td>{r.mail}</Td>
                    <Td num>{r.aantal}</Td>
                    <Td>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {r.pil}
                        {r.toelichting && <span className="text-xs text-slate-500">{r.toelichting}</span>}
                      </span>
                    </Td>
                    {/* Mag afbreken: een lange naam duwde de tabel anders uit haar kader. */}
                    <Td>{r.door}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          </div>
          {/* Zelfde maten als de kaartlijsten van Vervaldata en Gebruikers;
              de rij opent niets, dus geen knop en geen chevron. Niets kapt
              af: titel en meta breken af op een smalle telefoon (320 px). */}
          <ul className="divide-y divide-hairline-subtle @[42rem]:hidden" aria-label="Verzendlog">
            {rijen.map((r) => (
              <li key={r.id} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-sm font-semibold text-slate-800">{r.mail}</p>
                  {r.pil}
                </div>
                {/* Komma's, geen puntjes: een scheidingsteken blijft dan nooit
                    alleen achter aan het eind of begin van een regel. */}
                <p className="mt-1 break-words text-xs font-medium text-slate-500">
                  <span className="whitespace-nowrap tabular-nums">{r.moment}</span>, <span className="whitespace-nowrap">{tel(r.aantal, 'ontvanger', 'ontvangers')}</span>, <span className="inline-block max-w-full">door {r.door}</span>
                </p>
                {r.toelichting && <p className="mt-1 break-words text-xs text-slate-500">{r.toelichting}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      </Verwissel>
    </TableShell>
  );
}
