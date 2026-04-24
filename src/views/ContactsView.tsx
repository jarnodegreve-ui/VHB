import { useState } from 'react';
import { Phone, Search, Users } from 'lucide-react';
import type { User } from '../types';
import { EmptyState, PageHeader, PageShell } from '../components/ui';

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
    <PageShell>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {filteredUsers.map(u => (
          <div key={u.id} className="surface-card surface-card-hover p-6 rounded-[32px] flex items-center justify-between group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-oker-50 rounded-2xl flex items-center justify-center text-oker-600 font-black text-lg">
                {u.name.charAt(0)}
              </div>
              <div>
                <h4 className="font-black text-slate-800 tracking-tight">{u.name}</h4>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{u.role}</p>
              </div>
            </div>
            {u.phone ? (
              <a 
                href={`tel:${u.phone.replace(/\s/g, '')}`}
                className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-all active:scale-90"
                title={`Bel ${u.name}`}
              >
                <Phone size={18} />
              </a>
            ) : (
              <div className="text-[10px] text-slate-300 font-bold italic">Geen nummer</div>
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

