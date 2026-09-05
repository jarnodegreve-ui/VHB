import { useState } from 'react';
import { Check, Copy, Phone, Search, X } from 'lucide-react';
import type { User } from '../types';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Avatar } from '../components/Avatar';
import { Badge, Button, IconButton, MicroLabel } from '../components/primitives';
import { Card } from '../components/Card';
import { Input } from '../components/Field';
import { Modal } from '../components/Modal';
import { notify, telHref } from '../lib/ui';
import { useMinWidth } from '../lib/useMinWidth';

const roleLabel = (role: string) =>
  role === 'chauffeur' ? 'Chauffeur' : role === 'planner' ? 'Planning' : role === 'admin' ? 'Beheer' : role;

/** Eerste letter voor de groepering/letterindex; cijfers en tekens onder '#'. */
const letterOf = (name: string) => {
  const c = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

/**
 * Breekpunt als React-state (Tailwind `lg` = 1024 px). Onder `lg` de vlakke
 * kaartlijst; daarboven groepering per letter met een plakkende letterindex.
 * Lokaal — een gedeelde useMediaQuery ontbreekt nog in src/lib.
 */

export function ContactsView({ users, currentUser }: { users: User[], currentUser: User }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<User | null>(null);
  const [copied, setCopied] = useState(false);
  const lg = useMinWidth(1024);

  const copyNumber = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('Kopiëren is mislukt — selecteer het nummer handmatig.', 'error');
    }
  };

  const filteredUsers = users.filter(u => {
    // Hide 'beheerder' from others, but let 'beheerder' see themselves
    const isBeheerder = u.name.toLowerCase() === 'beheerder';
    const isMe = u.id === currentUser.id;

    if (isBeheerder && !isMe) return false;
    // Handmatig verborgen in gebruikersbeheer — maar toon jezelf altijd.
    if (u.showInContacts === false && !isMe) return false;

    return u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           (u.phone && u.phone.includes(searchQuery));
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Groepering per eerste letter (alleen lg+), in alfabetische volgorde —
  // de lijst is al gesorteerd, dus de Map bewaart die volgorde.
  const groups = new Map<string, User[]>();
  for (const u of filteredUsers) {
    const l = letterOf(u.name);
    const list = groups.get(l);
    if (list) list.push(u);
    else groups.set(l, [u]);
  }

  const scrollNaarLetter = (letter: string) => {
    document.getElementById(`contact-letter-${letter === '#' ? 'overig' : letter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const zoekveld = (
    <div className="relative w-full md:w-72 group">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Search size={16} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
      </div>
      <Input
        type="text"
        placeholder="Zoek op naam of nummer…"
        aria-label="Zoek op naam of nummer"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="pl-9"
      />
    </div>
  );

  const kaart = (u: User) => (
    <Card key={u.id} padding="none" interactive className="px-4 py-3 flex items-center justify-between gap-3 group">
      {/* rauw: kaart-als-knop met eigen layout (avatar + naam + rol); opent de contact-popup */}
      <button
        type="button"
        onClick={() => { setSelected(u); setCopied(false); }}
        aria-label={`Contactgegevens van ${u.name}`}
        className="ios-pressable flex items-center gap-3 min-w-0 text-left flex-1 rounded-xl -m-1 p-1 hover:bg-slate-50/60 transition-colors"
      >
        <Avatar naam={u.name} size="lg" />
        <div className="min-w-0">
          <h4 className="font-bold text-slate-800 tracking-tight truncate">{u.name}</h4>
          {/* Mobiel: rol als micro-label onder de naam; lg+: als badge. */}
          {lg ? (
            <Badge tone={u.role === 'chauffeur' ? 'slate' : 'oker'} className="mt-1">{roleLabel(u.role)}</Badge>
          ) : (
            <MicroLabel className="truncate">{roleLabel(u.role)}</MicroLabel>
          )}
        </div>
      </button>
      {u.phone ? (
        <a
          href={telHref(u.phone)}
          aria-label={`Bel ${u.name}`}
          title={`Bel ${u.name}`}
          className="ios-pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:border-emerald-700 hover:text-white transition-colors"
        >
          <Phone size={18} />
        </a>
      ) : (
        <p className="text-2xs font-medium text-slate-500 shrink-0">Geen nummer</p>
      )}
    </Card>
  );

  const leeg = (
    <EmptyState
      title="Geen contacten gevonden"
      message={searchQuery ? "Pas je zoekopdracht aan om medewerkers terug te vinden." : "Zodra collega's zichtbaar staan in de contactlijst verschijnen ze hier."}
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="Contacten"
        description="Contactgegevens van alle medewerkers."
        actions={lg ? undefined : zoekveld}
      />

      {lg ? (
        <>
          {/* Plakkende werkbalk: zoekveld + letterindex. top = hoogte van de
              topbar (zelfde waarde als StickyThead). */}
          <Card padding="none" className="sticky top-[3.25rem] z-20 flex flex-wrap items-center gap-3 px-3 py-2.5">
            {zoekveld}
            <nav aria-label="Letterindex" className="flex flex-wrap items-center gap-0.5">
              {Array.from(groups.keys()).map((letter) => (
                <Button key={letter} variant="ghost" size="sm" className="min-w-8 px-2 tabular-nums" onClick={() => scrollNaarLetter(letter)} aria-label={`Spring naar ${letter === '#' ? 'overige' : letter}`}>
                  {letter}
                </Button>
              ))}
            </nav>
            <span className="ml-auto text-xs font-medium tabular-nums text-slate-500">
              {filteredUsers.length} {filteredUsers.length === 1 ? 'contact' : 'contacten'}
            </span>
          </Card>

          {filteredUsers.length === 0 ? leeg : (
            <div className="space-y-6">
              {Array.from(groups.entries()).map(([letter, list]) => (
                <section key={letter} id={`contact-letter-${letter === '#' ? 'overig' : letter}`} aria-label={letter === '#' ? 'Overige' : letter} className="scroll-mt-32">
                  <MicroLabel className="mb-2 px-1">{letter === '#' ? 'Overige' : letter}</MicroLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-3">
                    {list.map(kaart)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-5">
          {filteredUsers.map(kaart)}
          {filteredUsers.length === 0 && (
            <div className="col-span-full">{leeg}</div>
          )}
        </div>
      )}

      {/* Contact-popup: naam aangeklikt → nummer zichtbaar, bellen of kopiëren. */}
      <Modal open={!!selected} onClose={() => setSelected(null)} maxWidth="sm">
        {selected && (
          <div className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar naam={selected.name} size="lg" />
                <div className="min-w-0">
                  <h3 className="text-section-title truncate">{selected.name}</h3>
                  <MicroLabel>{roleLabel(selected.role)}</MicroLabel>
                </div>
              </div>
              <IconButton label="Sluiten" variant="ghost" size="sm" onClick={() => setSelected(null)} className="text-slate-400">
                <X size={16} />
              </IconButton>
            </div>

            {selected.phone ? (
              <>
                <div className="mt-5 rounded-2xl bg-slate-50/80 px-4 py-3.5">
                  <MicroLabel>Telefoonnummer</MicroLabel>
                  <p className="mt-1 text-xl font-mono font-bold tracking-tight text-slate-900 tabular-nums select-all">{selected.phone}</p>
                </div>
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <a
                    href={telHref(selected.phone)}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500/15 text-emerald-800 px-4 py-3 text-sm font-semibold transition-colors hover:bg-emerald-500/25"
                  >
                    <Phone size={16} /> Bellen
                  </a>
                  <Button
                    variant="secondary"
                    size="lg"
                    className="flex-1"
                    onClick={() => copyNumber(selected.phone!)}
                    icon={copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                  >
                    {copied ? 'Gekopieerd' : 'Kopieer nummer'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-5 rounded-2xl bg-slate-50/80 px-4 py-3.5 text-sm text-slate-500">Geen telefoonnummer bekend.</p>
            )}
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
