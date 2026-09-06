import { useEffect, useState } from 'react';
import { BellRing, CalendarPlus, HeartPulse, Info, KeyRound, LifeBuoy, LogOut, Monitor, Moon, Smartphone, Tablet } from 'lucide-react';
import { Card, CardHeader } from '../components/Card';
import { ConfirmationModal, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, Chip, Switch } from '../components/primitives';
import { ActieMenu } from '../components/ActieMenu';
import { apiJson } from '../lib/api';
import { BUILD_INFO } from '../lib/appVersion';
import { formatRelatief } from '../lib/format';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/ui';
import type { User, View } from '../types';

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
      notify(err instanceof Error ? err.message : 'Uitloggen is mislukt.', 'error');
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
      notify(err instanceof Error ? err.message : 'Uitloggen op andere toestellen is mislukt.', 'error');
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
        ? 'Toestellen waarop je bent aangemeld. Een toestel uitloggen trekt het in; je meldt je er dan opnieuw aan.'
        : 'Toestel-goedkeuring staat uit, dus elk toestel wordt bij aanmelden meteen toegelaten; dit is wat er bekend is.';

  return (
    <Card>
      <CardHeader title="Toestellen en sessies" description={uitleg || undefined} />
      <div className="mt-4">
        {/* Eigen wrapper voor de rijen: zo blijft `last:border-b-0` van Rij
            werken naast het voetje (anders een dubbele haarlijn). */}
        <div>
        {fout ? (
          <p className="text-sm text-slate-500">Toestellen konden niet geladen worden.</p>
        ) : data === null ? (
          <p className="text-sm text-slate-500">Laden…</p>
        ) : toestellen.length === 0 ? (
          <p className="text-sm text-slate-500">Alleen de sessie op dit toestel is bekend.</p>
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
                    {ingetrokken && <Badge tone="slate" stil>Uitgelogd</Badge>}
                    {t.status === 'pending' && <Badge tone="amber" stil>Wacht op goedkeuring</Badge>}
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
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-xs leading-relaxed text-slate-500">Beëindigt ook sessies in andere browsers en tabbladen; dit toestel blijft aangemeld.</p>
          <Button variant="secondary" size="sm" icon={<LogOut size={14} />} disabled={bezig !== null || (data !== null && data.beschikbaar && anderenActief === 0 && toestellen.length > 0)} onClick={() => setBevestigAnderen(true)}>
            Uitloggen op alle andere toestellen
          </Button>
        </div>
      </div>
      <ConfirmationModal
        isOpen={bevestigAnderen}
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
    <div className="flex flex-wrap items-start gap-3 py-3.5 first:pt-0 last:pb-0 border-b last:border-b-0 border-slate-100">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600">{icoon}</span>
      <div className="min-w-[11rem] flex-1 basis-0">
        <p className="text-sm font-semibold text-slate-900">{titel}</p>
        <p className="mt-0.5 break-words text-sm text-slate-500 leading-relaxed">{uitleg}</p>
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
  const rolLabel = { admin: 'Beheerder', planner: 'Planner', chauffeur: 'Chauffeur' }[user.role] ?? user.role;
  const isAdmin = user.role === 'admin';
  return (
    <PageShell>
      <PageHeader title="Instellingen" description="Weergave, meldingen, account en koppelingen." />

      <Card>
        <CardHeader title="Weergave" />
        <div className="mt-4">
          <Rij
            icoon={<Moon size={16} />}
            titel="Donkere modus"
            uitleg={theme === 'dark' ? 'Aan, het portaal gebruikt het donkere thema op dit toestel.' : 'Uit, het portaal gebruikt het lichte thema op dit toestel.'}
            rechts={<Switch checked={theme === 'dark'} onChange={onToggleTheme} label="Donkere modus" />}
          />
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
        </div>
      </Card>

      <Card>
        <CardHeader title="Account" aside={<Badge tone="oker">{rolLabel}</Badge>} />
        <div className="mt-4">
          <Rij
            icoon={<KeyRound size={16} />}
            titel={user.name}
            uitleg={user.email || 'Geen e-mailadres bekend.'}
            rechts={<Button variant="secondary" size="sm" onClick={onChangePassword}>Wachtwoord wijzigen</Button>}
          />
          <Rij
            icoon={<CalendarPlus size={16} />}
            titel="Agenda-koppeling"
            uitleg="Abonneer je agenda op je rooster of download je diensten als agendabestand."
            rechts={<Button variant="secondary" size="sm" onClick={onAgenda}>Koppelen</Button>}
          />
        </div>
      </Card>

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
