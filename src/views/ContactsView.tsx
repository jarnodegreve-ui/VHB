import { useState } from 'react';
import { Check, Copy, Phone, Search, Users, X } from 'lucide-react';
import type { User } from '../types';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { MicroLabel } from '../components/primitives';
import { Modal } from '../components/Modal';
import { notify, telHref } from '../lib/ui';

const roleLabel = (role: string) =>
  role === 'chauffeur' ? 'Chauffeur' : role === 'planner' ? 'Planning' : role === 'admin' ? 'Beheer' : role;

export function ContactsView({ users, currentUser }: { users: User[], currentUser: User }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<User | null>(null);
  const [copied, setCopied] = useState(false);

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

  return (
    <PageShell width="6xl">
      <PageHeader
        title="Contactlijst"
        description="Contactgegevens van alle medewerkers."
        actions={(
          <div className="relative w-full md:w-72 group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search size={18} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
            </div>
            <input
              type="text"
              placeholder="Zoek op naam of nummer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="control-input w-full pl-11 pr-4 py-3 rounded-2xl focus:outline-none transition-all font-medium text-sm"
            />
          </div>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-5">
        {filteredUsers.map(u => (
          <div key={u.id} className="surface-card surface-card-hover px-4 py-3 rounded-2xl flex items-center justify-between gap-3 group">
            <button
              type="button"
              onClick={() => { setSelected(u); setCopied(false); }}
              aria-label={`Contactgegevens van ${u.name}`}
              className="ios-pressable flex items-center gap-3 min-w-0 text-left flex-1 rounded-xl -m-1 p-1 hover:bg-slate-50/60 transition-colors"
            >
              <div className="w-11 h-11 bg-oker-50 rounded-2xl flex items-center justify-center text-oker-600 font-bold text-base shrink-0">
                {u.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-slate-800 tracking-tight truncate">{u.name}</h4>
                <MicroLabel className="truncate">{roleLabel(u.role)}</MicroLabel>
              </div>
            </button>
            {u.phone ? (
              <a
                href={telHref(u.phone)}
                aria-label={`Bel ${u.name}`}
                title={`Bel ${u.name}`}
                className="ios-pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-700 hover:border-emerald-700 hover:text-white transition-colors"
              >
                <Phone size={18} />
              </a>
            ) : (
              <p className="text-2xs font-medium text-slate-500 shrink-0">Geen nummer</p>
            )}
          </div>
        ))}
        {filteredUsers.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={<Users size={28} />}
              title="Geen contacten gevonden"
              message={searchQuery ? "Pas je zoekopdracht aan om medewerkers terug te vinden." : "Zodra collega's zichtbaar staan in de contactlijst verschijnen ze hier."}
            />
          </div>
        )}
      </div>

      {/* Contact-popup: naam aangeklikt → nummer zichtbaar, bellen of kopiëren. */}
      <Modal open={!!selected} onClose={() => setSelected(null)} maxWidth="sm">
        {selected && (
          <div className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 bg-oker-50 rounded-2xl flex items-center justify-center text-oker-600 font-bold text-lg shrink-0">
                  {selected.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold tracking-tight text-slate-900 truncate">{selected.name}</h3>
                  <MicroLabel>{roleLabel(selected.role)}</MicroLabel>
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Sluiten" className="ios-pressable shrink-0 w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 inline-flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                <X size={16} />
              </button>
            </div>

            {selected.phone ? (
              <>
                <div className="mt-5 rounded-2xl bg-slate-50/80 px-4 py-3.5">
                  <MicroLabel>Telefoonnummer</MicroLabel>
                  <p className="mt-1 text-xl font-bold tracking-tight text-slate-900 tabular-nums select-all">{selected.phone}</p>
                </div>
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <a
                    href={telHref(selected.phone)}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 text-white px-4 py-3 text-sm font-semibold hover:bg-emerald-800 transition-colors"
                  >
                    <Phone size={16} /> Bellen
                  </a>
                  <button
                    type="button"
                    onClick={() => copyNumber(selected.phone!)}
                    className="ios-pressable flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-surface-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-surface-soft-hover transition-colors"
                  >
                    {copied ? <><Check size={16} className="text-emerald-500" /> Gekopieerd</> : <><Copy size={16} /> Kopieer nummer</>}
                  </button>
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
