import { BellRing, CalendarPlus, HeartPulse, KeyRound, LifeBuoy, LogOut, Moon, Smartphone } from 'lucide-react';
import { Card, CardHeader } from '../components/Card';
import { PageHeader, PageShell } from '../components/ui';
import { Badge, Button, Switch } from '../components/primitives';
import type { User, View } from '../types';

/**
 * Instellingen: alles wat vroeger verspreid stond over het avatar-menu, het
 * rooster (agenda-koppeling) en de beheerschermen, op één adres
 * (/instellingen). Het avatar-menu houdt de snelle schakelaars; dit scherm
 * legt uit wat ze doen.
 */
function Rij({ icoon, titel, uitleg, rechts }: { icoon: React.ReactNode; titel: string; uitleg: string; rechts: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0 border-b last:border-b-0 border-slate-100">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600">{icoon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{titel}</p>
        <p className="mt-0.5 text-sm text-slate-500 leading-relaxed">{uitleg}</p>
      </div>
      <div className="shrink-0 pt-0.5">{rechts}</div>
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
            uitleg={theme === 'dark' ? 'Aan — het portaal gebruikt het donkere thema op dit toestel.' : 'Uit — het portaal gebruikt het lichte thema op dit toestel.'}
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
