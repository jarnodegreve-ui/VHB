import { useState } from 'react';
import { Phone, Search, Users } from 'lucide-react';
import type { User } from '../types';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { MicroLabel } from '../components/primitives';

export function ContactsView({ users, currentUser }: { users: User[], currentUser: User }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = users.filter(u => {
    // Hide 'beheerder' from others, but let 'beheerder' see themselves
    const isBeheerder = u.name.toLowerCase() === 'beheerder';
    const isMe = u.id === currentUser.id;

    if (isBeheerder && !isMe) return false;

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
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 bg-oker-50 rounded-2xl flex items-center justify-center text-oker-600 font-bold text-base shrink-0">
                {u.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <h4 className="font-bold text-slate-800 tracking-tight truncate">{u.name}</h4>
                <MicroLabel className="truncate">{u.role === 'chauffeur' ? 'Chauffeur' : u.role === 'planner' ? 'Planning' : u.role === 'admin' ? 'Beheer' : u.role}</MicroLabel>
              </div>
            </div>
            {u.phone ? (
              <a
                href={`tel:${u.phone.replace(/\s/g, '')}`}
                aria-label={`Bel ${u.name}`}
                title={`Bel ${u.name}`}
                className="ios-pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-500 hover:border-emerald-500 hover:text-white transition-colors"
              >
                <Phone size={18} />
              </a>
            ) : (
              <p className="text-[11px] font-medium italic text-slate-400 shrink-0">Geen nummer</p>
            )}
          </div>
        ))}
        {filteredUsers.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={<Users size={28} />}
              title="Geen contacten gevonden"
              message="Pas je zoekopdracht aan om medewerkers terug te vinden."
            />
          </div>
        )}
      </div>
    </PageShell>
  );
}
