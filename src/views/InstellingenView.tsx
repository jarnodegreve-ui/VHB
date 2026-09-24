import { useEffect, useState } from 'react';
import { Bell, BellRing, CalendarPlus, Clock, HeartPulse, Home, Info, KeyRound, LifeBuoy, LogOut, Monitor, Moon, ShieldCheck, Smartphone, Tablet, Users } from 'lucide-react';
import { MELDING_SOORT_LABEL, type MeldingSoort } from '../../shared/meldingSoorten';
import { UITZETBARE_MELDING_SOORTEN } from '../../shared/dashboardVoorkeuren';
import { TOESTEL_STATUS } from '../../shared/status';
import { Card, CardHeader } from '../components/Card';
import { ConfirmationModal, ModalHeader, PageHeader, PageShell } from '../components/ui';
import { Modal } from '../components/Modal';
import { Badge, Button, Chip, StatusBadge, Switch } from '../components/primitives';
import { Select } from '../components/Field';
import { ActieMenu } from '../components/ActieMenu';
import { TweeStapsCode, TweeStapsInschrijving } from '../components/TweeStapsInschrijving';
import { ROUTES } from '../app/routes';
import { apiJson } from '../lib/api';
import { BUILD_INFO } from '../lib/appVersion';
import { bewaarVoorkeurDeel, spiegelStartscherm } from '../lib/dashboardVoorkeuren';
import { formatRelatief } from '../lib/format';
import { isGedeeldToestel, zetGedeeldToestel } from '../lib/inactiviteit';
import { STARTSCHERMEN, onthoudStartschermLokaal, type Startscherm } from '../lib/startscherm';
import { supabase } from '../lib/supabase';
import { leesTweeStapsStatus, type TweeStapsStatus } from '../lib/tweeStaps';
import { schakelUit } from '../lib/tweeStapsBeheer';
import { notify } from '../lib/ui';
import { ROL_LABEL, type User, type View } from '../types';
import { OnderhoudBeheer } from './instellingen/OnderhoudBeheer';
import { meldSchrijffout } from '../lib/fouten';

// --- Toestellen en sessies (GET /api/me/toestellen) ---
type EigenToestel = {
  id: string;
  naam: string;
  platform: string;
  kanaal: 'app' | 'browser' | null;
  status: 'approved' | 'pending' | 'revoked';
  aangemaakt: string;
  laatstGezien: string;
  ditToestel: boolean;
};
type ToestellenAntwoord = { beschikbaar: boolean; gateActief: boolean; toestellen: EigenToestel[] };

const toestelIcoon = (platform: string) =>
  /ipad|tablet/i.test(platform) ? <Tablet size={16} /> : /iphone|android|toestel/i.test(platform) ? <Smartphone size={16} /> : <Monitor size={16} />;

function ToestellenSectie() {
  const [data, setData] = useState<ToestellenAntwoord | null>(null);
  const [fout, setFout] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null);
  const [bevestigAnderen, setBevestigAnderen] = useState(false);

  const laad = async () => {
    try {
      setData(await apiJson<ToestellenAntwoord>('/api/me/toestellen'));
    } catch {
      setFout(true);
    }
  };
  useEffect(() => { void laad(); }, []);

  const uitloggen = async (t: EigenToestel) => {
    setBezig(t.id);
    try {
      await apiJson(`/api/me/toestellen/${t.id}/uitloggen`, { method: 'POST' });
      notify(`${t.naam} is uitgelogd.`, 'success');
      await laad();
    } catch (err) {
      meldSchrijffout(`${t.naam} uitloggen`, err);
    } finally {
      setBezig(null);
    }
  };

  const uitloggenAnderen = async () => {
    setBevestigAnderen(false);
    setBezig('anderen');
    try {
      // Toestel-kant (whitelist) én sessie-kant (Supabase): allebei, anders
      // blijft een ander tabblad met een geldig token gewoon doorwerken.
      const res = await apiJson<{ aantal: number }>('/api/me/toestellen/uitloggen-anderen', { method: 'POST' });
      const { error } = (await supabase?.auth.signOut({ scope: 'others' })) ?? { error: null };
      if (error) throw error;
      notify(res.aantal > 0 ? `Uitgelogd op ${res.aantal} ${res.aantal === 1 ? 'ander toestel' : 'andere toestellen'}.` : 'Alle andere sessies zijn beëindigd.', 'success');
      await laad();
    } catch (err) {
      meldSchrijffout('Uitloggen op andere toestellen', err);
    } finally {
      setBezig(null);
    }
  };

  const toestellen = data?.toestellen ?? [];
  const anderenActief = toestellen.filter((t) => !t.ditToestel && t.status !== 'revoked').length;
  const uitleg = !data
    ? ''
    : !data.beschikbaar
      ? 'Toestelregistratie staat uit op deze server; alleen de sessie op dit toestel is bekend.'
      : data.gateActief
        ? 'Toestellen waarop je bent aangemeld. Een toestel uitloggen verwijdert het hier; op dat toestel meld je je daarna gewoon opnieuw aan.'
        : 'Toestel-goedkeuring staat uit, dus elk toestel wordt bij aanmelden meteen toegelaten; dit is wat er bekend is.';

  return (
    <Card>
      <CardHeader title="Toestellen en sessies" description={uitleg || undefined} />
      <div className="mt-4">
        {/* Eigen wrapper voor de rijen: zo blijft `last:border-b-0` van Rij
            werken naast het voetje (anders een dubbele haarlijn). */}
        <div>
        {fout ? (
          <p className="text-body-sm text-slate-500">Toestellen konden niet geladen worden.</p>
        ) : data === null ? (
          <p className="text-body-sm text-slate-500">Laden…</p>
        ) : toestellen.length === 0 ? (
          <p className="text-body-sm text-slate-500">Alleen de sessie op dit toestel is bekend.</p>
        ) : (
          toestellen.map((t) => {
            const ingetrokken = t.status === 'revoked';
            return (
              <Rij
                key={t.id}
                icoon={toestelIcoon(t.platform)}
                titel={(
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={ingetrokken ? 'text-slate-500 line-through decoration-slate-300' : undefined}>{t.naam}</span>
                    {t.ditToestel && <Badge tone="oker" stil>Dit toestel</Badge>}
                    {t.status !== 'approved' && <StatusBadge status={t.status} map={TOESTEL_STATUS} stil />}
                  </span>
                )}
                uitleg={`${t.platform}${t.kanaal ? ` · ${t.kanaal === 'app' ? 'app op beginscherm' : 'browser'}` : ''} · laatst gezien ${formatRelatief(t.laatstGezien)}`}
                rechts={(
                  <ActieMenu
                    label={`Acties voor ${t.naam}`}
                    size="sm"
                    items={[{
                      label: t.ditToestel ? 'Dit toestel: gebruik Uitloggen hieronder' : ingetrokken ? 'Al uitgelogd' : 'Uitloggen',
                      icon: <LogOut size={16} />,
                      gevaarlijk: !t.ditToestel && !ingetrokken,
                      disabled: t.ditToestel || ingetrokken || bezig !== null,
                      onClick: () => { void uitloggen(t); },
                    }]}
                  />
                )}
              />
            );
          })
        )}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline-subtle pt-4">
          <p className="text-body-sm text-slate-500">Beëindigt ook sessies in andere browsers en tabbladen; dit toestel blijft aangemeld.</p>
          <Button variant="secondary" size="sm" icon={<LogOut size={14} />} disabled={bezig !== null || (data !== null && data.beschikbaar && anderenActief === 0 && toestellen.length > 0)} onClick={() => setBevestigAnderen(true)}>
            Uitloggen op alle andere toestellen
          </Button>
        </div>
      </div>
      <ConfirmationModal
        open={bevestigAnderen}
        onClose={() => setBevestigAnderen(false)}
        onConfirm={() => { void uitloggenAnderen(); }}
        title="Uitloggen op alle andere toestellen?"
        variant="warning"
        confirmText="Ja, uitloggen"
        message={anderenActief > 0
          ? `${anderenActief} ${anderenActief === 1 ? 'ander toestel wordt' : 'andere toestellen worden'} uitgelogd, plus alle andere open sessies. Dit toestel blijft aangemeld.`
          : 'Alle andere open sessies (andere browsers of tabbladen) worden beëindigd. Dit toestel blijft aangemeld.'}
      />
    </Card>
  );
}

// --- Beveiliging (GET /api/me/beveiliging + Supabase MFA) ---
type Beveiliging = { staf: boolean; mfaVerplicht: boolean; aal: 'aal1' | 'aal2'; aanmeldingen: Array<{ at: string; action: string }> };

/**
 * Twee-stapsverificatie, gedeeld toestel en laatste aanmeldingen op één
 * rustige plek (verbeterronde 07-09, nrs. 5, 8 en 12). Toestellen en
 * sessies staat er als eigen kaart direct onder.
 */
function BeveiligingSectie({ user, onChangePassword }: { user: User; onChangePassword: () => void }) {
  const staf = user.role === 'planner' || user.role === 'admin';
  const [info, setInfo] = useState<Beveiliging | null>(null);
  const [status, setStatus] = useState<TweeStapsStatus | null | undefined>(undefined);
  const [modal, setModal] = useState<'inschrijven' | 'uitschakelen' | null>(null);
  const [gedeeld, setGedeeld] = useState<boolean>(() => isGedeeldToestel());
  const [bezig, setBezig] = useState(false);

  const laad = async () => {
    // Vorm bewaken: een onverwacht antwoord (oude server, mock zonder route)
    // mag de hele pagina niet laten omvallen op `aanmeldingen.length`.
    try {
      const b = await apiJson<Beveiliging>('/api/me/beveiliging');
      setInfo(b && Array.isArray(b.aanmeldingen) ? b : null);
    } catch { setInfo(null); }
    if (staf) setStatus(await leesTweeStapsStatus());
  };
  useEffect(() => { void laad(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user.id]);

  const tweeStapsAan = !!status?.factorId;
  const uitschakelen = async () => {
    if (!status?.factorId) return;
    setBezig(true);
    try {
      await schakelUit(status.factorId);
      notify('Twee-stapsverificatie staat uit.', 'success');
      setModal(null);
      await laad();
    } catch (err) {
      meldSchrijffout('Twee-stapsverificatie uitschakelen', err, () => void uitschakelen());
    } finally {
      setBezig(false);
    }
  };

  const tweeStapsUitleg = status === undefined
    ? 'Status ophalen…'
    : status === null
      ? 'Status kon niet gelezen worden. Vernieuw de pagina en probeer opnieuw.'
      : tweeStapsAan
        ? `Aan. Bij elke aanmelding vraagt het portaal naast je wachtwoord een code uit je authenticator-app.${info?.mfaVerplicht ? ' Verplicht voor planners en beheerders.' : ''}`
        : info?.mfaVerplicht
          ? 'Verplicht voor planners en beheerders, maar nog niet ingesteld op dit account.'
          : 'Uit. Voeg een code uit een authenticator-app toe aan je wachtwoord; een gestolen wachtwoord alleen is dan niet genoeg.';

  return (
    <>
      <Card>
        <CardHeader title="Beveiliging" description="Wachtwoord, twee-stapsverificatie en wie zich wanneer aanmeldde." />
        <div className="mt-4">
          <Rij
            icoon={<KeyRound size={16} />}
            titel="Wachtwoord"
            uitleg={user.email || 'Geen e-mailadres bekend.'}
            rechts={<Button variant="secondary" size="sm" onClick={onChangePassword}>Wijzigen</Button>}
          />
          {staf && (
            <Rij
              icoon={<ShieldCheck size={16} />}
              titel={(
                <span className="flex flex-wrap items-center gap-2">
                  Twee-stapsverificatie
                  {status !== undefined && status !== null && (tweeStapsAan ? <Badge tone="emerald" stil>Aan</Badge> : <Badge tone={info?.mfaVerplicht ? 'amber' : 'slate'} stil>Uit</Badge>)}
                </span>
              )}
              uitleg={tweeStapsUitleg}
              rechts={tweeStapsAan
                ? (info?.mfaVerplicht
                  ? <Chip tone="slate" mono={false}>Verplicht</Chip>
                  : <Button variant="secondary" size="sm" disabled={bezig} onClick={() => setModal('uitschakelen')}>Uitschakelen</Button>)
                : <Button variant={info?.mfaVerplicht ? 'primary' : 'secondary'} size="sm" disabled={status === undefined || status === null} onClick={() => setModal('inschrijven')}>Instellen</Button>}
            />
          )}
          <Rij
            icoon={<Users size={16} />}
            titel="Gedeeld toestel"
            uitleg={gedeeld
              ? 'Aan. Na een half uur zonder activiteit meldt het portaal je op dit toestel automatisch af.'
              : 'Uit. Zet dit aan op een toestel dat meerdere collega’s gebruiken, zoals de tablet in het lokaal.'}
            rechts={<Switch checked={gedeeld} onChange={() => { const naar = !gedeeld; setGedeeld(naar); zetGedeeldToestel(naar); }} label="Gedeeld toestel" />}
          />
          <Rij
            icoon={<Clock size={16} />}
            titel="Laatste aanmeldingen"
            uitleg={info === null
              ? 'Aanmeldingen konden niet geladen worden.'
              : info.aanmeldingen.length === 0
                ? 'Nog geen aanmeldingen geregistreerd.'
                : 'De recentste momenten waarop dit account zich aanmeldde of actief werd. Herken je er een niet, log dan overal uit en wijzig je wachtwoord.'}
            rechts={<span />}
          />
          {info && info.aanmeldingen.length > 0 && (
            <ul className="mt-1 grid gap-1 pl-11 text-sm text-slate-600 sm:grid-cols-2">
              {info.aanmeldingen.map((a) => (
                <li key={a.at} className="flex items-center gap-2">
                  <span className="text-slate-900">{formatRelatief(a.at)}</span>
                  <span className="text-micro">{a.action === 'Actief' ? 'actief' : 'aangemeld'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Modal open={modal === 'inschrijven'} onClose={() => setModal(null)} maxWidth="sm" ariaLabel="Twee-stapsverificatie instellen">
        <ModalHeader title="Twee-stapsverificatie instellen" onClose={() => setModal(null)} />
        <div className="mt-4">
          <TweeStapsInschrijving
            onAnnuleer={() => setModal(null)}
            onKlaar={() => {
              setModal(null);
              notify('Twee-stapsverificatie staat aan. Bij je volgende aanmelding vraagt het portaal de code.', 'success');
              void laad();
            }}
          />
        </div>
      </Modal>

      <Modal open={modal === 'uitschakelen'} onClose={() => setModal(null)} maxWidth="sm" ariaLabel="Twee-stapsverificatie uitschakelen">
        <ModalHeader title="Twee-stapsverificatie uitschakelen" onClose={() => setModal(null)} />
        <p className="mt-2 text-body text-slate-600">Daarna is je wachtwoord weer de enige sleutel. Bevestig eerst met een code uit je app.</p>
        <div className="mt-4">
          {status?.factorId && status.huidig !== 'aal2'
            ? <TweeStapsCode factorId={status.factorId} annuleerLabel="Annuleren" onAnnuleer={() => setModal(null)} onKlaar={() => { void laad().then(() => void uitschakelen()); }} />
            : (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setModal(null)} disabled={bezig}>Annuleren</Button>
                <Button variant="danger" onClick={() => { void uitschakelen(); }} disabled={bezig}>Uitschakelen</Button>
              </div>
            )}
        </div>
      </Modal>
    </>
  );
}

// --- Startscherm (users.dashboardvoorkeuren.startscherm) ---

/**
 * Waar de app opent (punt 15). Leeg = het oude gedrag: de laatst geopende
 * pagina, wat voor een chauffeur onvoorspelbaar aanvoelde. De keuze gaat naar
 * de server (deel-PATCH, raakt de tegelindeling niet) én naar de lokale kopie
 * die de router bij het opstarten leest (src/lib/startscherm.ts). Alleen de
 * schermen die de rol mag zien staan in de lijst (routetabel).
 */
function StartschermRij({ user }: { user: User }) {
  const [keuze, setKeuze] = useState<Startscherm | ''>(user.dashboardVoorkeuren?.startscherm ?? '');
  const [bezig, setBezig] = useState(false);
  useEffect(() => { spiegelStartscherm(user); }, [user]);

  const opties = STARTSCHERMEN
    .map((view) => ROUTES.find((r) => r.view === view))
    .filter((r): r is NonNullable<typeof r> => !!r && r.rollen.includes(user.role));

  const kies = async (naar: Startscherm | '') => {
    const vorige = keuze;
    setKeuze(naar);
    onthoudStartschermLokaal(naar || null);
    setBezig(true);
    try {
      await bewaarVoorkeurDeel({ startscherm: naar || null });
    } catch (err) {
      setKeuze(vorige);
      onthoudStartschermLokaal(vorige || null);
      meldSchrijffout('Startscherm opslaan', err, () => void kies(naar));
    } finally {
      setBezig(false);
    }
  };

  return (
    <Rij
      icoon={<Home size={16} />}
      titel="Startscherm"
      uitleg={keuze
        ? `De app opent op ${opties.find((o) => o.view === keuze)?.label ?? keuze}, op elk toestel waar je aangemeld bent.`
        : 'De app opent op de pagina die je het laatst open had. Kies een vast scherm als je liever altijd op dezelfde plek begint.'}
      rechts={(
        <Select
          aria-label="Startscherm"
          value={keuze}
          disabled={bezig}
          className="min-w-[11rem]"
          onChange={(e) => { void kies(e.target.value as Startscherm | ''); }}
        >
          <option value="">Laatst geopend</option>
          {opties.map((o) => <option key={o.view} value={o.view}>{o.label}</option>)}
        </Select>
      )}
    />
  );
}

// --- Meldingssoorten (users.dashboardvoorkeuren.meldingssoortenUit) ---

/**
 * Waarover wil je meldingen (punt 15): één schakelaar per soort, standaard
 * allemaal aan. Uitzetten filtert alleen het pushkanaal (api/push.ts); in
 * Meldingen blijft elke melding staan. 'systeem' (vervaldata van je eigen
 * attesten) is bewust niet uit te zetten en staat er niet tussen.
 */
function MeldingssoortenRijen({ user }: { user: User }) {
  const [uit, setUit] = useState<ReadonlySet<MeldingSoort>>(() => new Set(user.dashboardVoorkeuren?.meldingssoortenUit ?? []));
  const [bezig, setBezig] = useState(false);

  const zet = async (soort: MeldingSoort, aan: boolean) => {
    const vorige = uit;
    const volgende = new Set(vorige);
    if (aan) volgende.delete(soort); else volgende.add(soort);
    setUit(volgende);
    setBezig(true);
    try {
      // Lege lijst = voorkeur wissen (null): "nooit iets uitgezet" en "alles
      // weer aan" zijn dan hetzelfde, ook voor soorten die later bijkomen.
      await bewaarVoorkeurDeel({ meldingssoortenUit: volgende.size ? [...volgende] : null });
    } catch (err) {
      setUit(vorige);
      meldSchrijffout('Meldingsvoorkeur opslaan', err, () => void zet(soort, aan));
    } finally {
      setBezig(false);
    }
  };

  return (
    <>
      <Rij
        icoon={<Bell size={16} />}
        titel="Waarover wil je meldingen"
        uitleg="Zet een soort uit en je krijgt er geen seintje meer van; onder Meldingen blijft alles staan. Systeemmeldingen, zoals een attest dat verloopt, komen altijd."
        rechts={<span />}
      />
      <ul className="grid gap-y-2 pl-11 pb-3.5 sm:grid-cols-2 sm:gap-x-6" aria-label="Meldingssoorten">
        {UITZETBARE_MELDING_SOORTEN.map((soort) => (
          <li key={soort} className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-slate-700">{MELDING_SOORT_LABEL[soort]}</span>
            <Switch checked={!uit.has(soort)} disabled={bezig} onChange={(aan) => { void zet(soort, aan); }} label={`Meldingen over ${MELDING_SOORT_LABEL[soort].toLowerCase()}`} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Instellingen: alles wat vroeger verspreid stond over het avatar-menu, het
 * rooster (agenda-koppeling) en de beheerschermen, op één adres
 * (/instellingen). Het avatar-menu houdt de snelle schakelaars; dit scherm
 * legt uit wat ze doen.
 */
function Rij({ icoon, titel, uitleg, rechts }: { icoon: React.ReactNode; titel: React.ReactNode; uitleg: string; rechts: React.ReactNode }) {
  return (
    // flex-wrap + min-w op de tekst: op een smal scherm (lang e-mailadres
    // naast "Wachtwoord wijzigen") zakt de knop onder de tekst i.p.v. dat de
    // tekst eronder doorloopt (Jarno 04-09). break-words als extra vangnet.
    <div className="flex flex-wrap items-start gap-3 py-3.5 first:pt-0 last:pb-0 border-b last:border-b-0 border-hairline-subtle">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600">{icoon}</span>
      <div className="min-w-[11rem] flex-1 basis-0">
        <p className="text-md font-semibold text-slate-900">{titel}</p>
        <p className="mt-0.5 break-words text-body-sm text-slate-500">{uitleg}</p>
      </div>
      <div className="ml-auto shrink-0 pt-0.5">{rechts}</div>
    </div>
  );
}

export function InstellingenView({
  user,
  theme,
  onToggleTheme,
  pushBeschikbaar,
  pushEnabled,
  onTogglePush,
  onChangePassword,
  onAgenda,
  onProbleem,
  onLogout,
  onNavigate,
}: {
  user: User;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  pushBeschikbaar: boolean;
  pushEnabled: boolean;
  onTogglePush: () => void;
  onChangePassword: () => void;
  onAgenda: () => void;
  onProbleem: () => void;
  onLogout: () => void;
  onNavigate: (view: View) => void;
}) {
  const rolLabel = ROL_LABEL[user.role];
  const isAdmin = user.role === 'admin';
  return (
    <PageShell>
      <PageHeader title="Instellingen" description="Weergave, meldingen, account, beveiliging en koppelingen." />

      <Card>
        <CardHeader title="Weergave" />
        <div className="mt-4">
          <Rij
            icoon={<Moon size={16} />}
            titel="Donkere modus"
            uitleg={theme === 'dark' ? 'Aan, het portaal gebruikt het donkere thema op dit toestel.' : 'Uit, het portaal gebruikt het lichte thema op dit toestel.'}
            rechts={<Switch checked={theme === 'dark'} onChange={onToggleTheme} label="Donkere modus" />}
          />
          <StartschermRij user={user} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Meldingen" />
        <div className="mt-4">
          <Rij
            icoon={<BellRing size={16} />}
            titel="Pushmeldingen"
            uitleg={pushBeschikbaar
              ? 'Een seintje op dit toestel bij planning, verlof en dienstruil. Werkt alleen als het portaal op je beginscherm staat.'
              : 'Niet beschikbaar op dit toestel of in deze browser. Zet het portaal op je beginscherm om meldingen te kunnen ontvangen.'}
            rechts={<Switch checked={pushEnabled} onChange={onTogglePush} label="Pushmeldingen" disabled={!pushBeschikbaar} />}
          />
          <MeldingssoortenRijen user={user} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Account" aside={<Badge tone="oker">{rolLabel}</Badge>} />
        <div className="mt-4">
          <Rij
            icoon={<CalendarPlus size={16} />}
            titel="Agenda-koppeling"
            uitleg="Abonneer je agenda op je rooster of download je diensten als agendabestand."
            rechts={<Button variant="secondary" size="sm" onClick={onAgenda}>Koppelen</Button>}
          />
        </div>
      </Card>

      <BeveiligingSectie user={user} onChangePassword={onChangePassword} />

      <ToestellenSectie />

      {isAdmin && (
        <Card>
          <CardHeader title="Beheer" description="Instellingen die voor iedereen gelden." />
          <div className="mt-4">
            <Rij
              icoon={<Smartphone size={16} />}
              titel="Toestel-goedkeuring"
              uitleg="Bepaal of een nieuw toestel eerst goedgekeurd moet worden voordat het toegang krijgt."
              rechts={<Button variant="secondary" size="sm" onClick={() => onNavigate('toestellen')}>Toestellen</Button>}
            />
            <OnderhoudBeheer />
            <Rij
              icoon={<HeartPulse size={16} />}
              titel="Systeemstatus"
              uitleg="Koppelingen, tabellen en foutmeldingen van het portaal."
              rechts={<Button variant="secondary" size="sm" onClick={() => onNavigate('beheer-debug')}>Bekijken</Button>}
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Hulp" />
        <div className="mt-4">
          <Rij
            icoon={<LifeBuoy size={16} />}
            titel="Meld een probleem"
            uitleg="Klopt er iets niet? Beschrijf het kort; het scherm waar je bent sturen we mee."
            rechts={<Button variant="secondary" size="sm" onClick={onProbleem}>Melden</Button>}
          />
          <Rij
            icoon={<Info size={16} />}
            titel={`Versie ${BUILD_INFO.version}`}
            uitleg={`Build ${BUILD_INFO.sha || 'lokaal'} · gebouwd op ${new Date(BUILD_INFO.builtAt).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short' })}.`}
            rechts={<Chip>{BUILD_INFO.sha || 'lokaal'}</Chip>}
          />
          <Rij
            icoon={<LogOut size={16} />}
            titel="Uitloggen"
            uitleg="Meld je af op dit toestel. Op een gedeeld toestel wissen we ook de offline-gegevens."
            rechts={<Button variant="danger" size="sm" onClick={onLogout}>Uitloggen</Button>}
          />
        </div>
      </Card>
    </PageShell>
  );
}
