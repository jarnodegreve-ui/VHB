import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Modal } from './Modal';
import { ModalHeader } from './ui';
import { Button, TableShell, Td, Th } from './primitives';
import { SortTh, useSort } from './Table';
import { Input } from './Field';
import { Avatar } from './Avatar';
import { downloadBlob, cn } from '../lib/ui';
import { csvTekst } from '../lib/csv';
import type { LeaveBalance } from '../lib/leaveBalance';
import { verlofSaldoRijen } from '../lib/verlofSaldoRijen';
import type { LeaveRequest, User } from '../types';

type Kolom = 'naam' | 'budget' | 'gebruikt' | 'aangevraagd' | 'vrij' | 'kleinVerlet';

/**
 * Saldo-overzicht (verzoek Jarno 10-09): alle medewerkers met hun verlofsaldo
 * van een jaar naast elkaar, zodat de planning niet per persoon hoeft te
 * klikken. Zelfde telling als overal (verlofBalans: zondag en feestdagen
 * tellen niet mee), dus dit klopt met wat de chauffeur zelf ziet.
 */
export function VerlofSaldoModal({ open, onClose, users, leaveRequests }: {
  open: boolean;
  onClose: () => void;
  users: User[];
  leaveRequests: LeaveRequest[];
}) {
  const [jaar, setJaar] = useState(new Date().getFullYear());
  const [zoek, setZoek] = useState('');
  const sort = useSort<Kolom>('naam');

  // Iedereen die verlof opneemt (zie verlofSaldoRijen); het rapport
  // Verlofsaldo telt op de server met dezelfde regel.
  const rijen = useMemo(() => verlofSaldoRijen(users, leaveRequests, jaar), [users, leaveRequests, jaar]);
  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    const gefilterd = q ? rijen.filter((r) => r.user.name.toLowerCase().includes(q)) : rijen;
    return sort.sorteer(gefilterd, (r, k) => {
      const b: LeaveBalance = r.balans;
      switch (k) {
        case 'naam': return r.user.name;
        case 'budget': return b.betaaldBudget;
        case 'gebruikt': return b.betaaldGebruikt;
        case 'aangevraagd': return b.betaaldAangevraagd;
        case 'vrij': return b.betaaldVrij;
        case 'kleinVerlet': return b.kleinVerletDagen;
      }
    });
  }, [rijen, zoek, sort]);
  const totaal = useMemo(() => rijen.reduce((t, r) => ({
    budget: t.budget + r.balans.betaaldBudget, gebruikt: t.gebruikt + r.balans.betaaldGebruikt,
    aangevraagd: t.aangevraagd + r.balans.betaaldAangevraagd, vrij: t.vrij + r.balans.betaaldVrij,
    kleinVerlet: t.kleinVerlet + r.balans.kleinVerletDagen,
  }), { budget: 0, gebruikt: 0, aangevraagd: 0, vrij: 0, kleinVerlet: 0 }), [rijen]);

  const exporteer = () => {
    const csv = '﻿' + csvTekst([
      ['Naam', 'Rol', 'Budget', 'Opgenomen', 'Aangevraagd', 'Vrij', 'Klein verlet'],
      ...zichtbaar.map((r) => [r.user.name, r.user.role, r.balans.betaaldBudget, r.balans.betaaldGebruikt, r.balans.betaaldAangevraagd, r.balans.betaaldVrij, r.balans.kleinVerletDagen]),
    ], ';');
    void downloadBlob(`vhb-verlofsaldo-${jaar}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="3xl" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
      <ModalHeader
        title={`Verlofsaldo ${jaar}`}
        description="Betaald verlof per medewerker: opgenomen en aangevraagd tegenover het budget. Vrij is wat nog aan te vragen valt, dus na aftrek van aangevraagde dagen. Zondagen en feestdagen tellen niet mee."
        onClose={onClose}
      />
      <div className="flex-1 space-y-4 overflow-y-auto p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"><Search size={16} className="text-slate-400" /></div>
            <Input type="search" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek medewerker…" aria-label="Zoek medewerker" className="pl-9" />
          </div>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setJaar((j) => j - 1)} aria-label="Vorig jaar">‹</Button>
            <span className="min-w-14 text-center text-sm font-semibold text-slate-800">{jaar}</span>
            <Button variant="secondary" size="sm" onClick={() => setJaar((j) => j + 1)} aria-label="Volgend jaar">›</Button>
          </div>
          <span className="ml-auto text-xs font-medium text-slate-500">{zichtbaar.length} {zichtbaar.length === 1 ? 'medewerker' : 'medewerkers'}</span>
          <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exporteer} disabled={zichtbaar.length === 0}>CSV</Button>
        </div>

        <TableShell>
          {/* table-fixed: de cijferkolommen krijgen een vaste breedte en de naam de rest,
              anders duwt de tabel op iPhone de laatste kolom buiten beeld. */}
          <table className="w-full table-fixed text-left">
            <thead>
              <tr>
                <SortTh kolom="naam" sort={sort}>Medewerker</SortTh>
                <SortTh kolom="budget" sort={sort} align="right" className="max-md:hidden md:w-20">Budget</SortTh>
                <SortTh kolom="gebruikt" sort={sort} align="right" className="w-24">Opgenomen</SortTh>
                <SortTh kolom="aangevraagd" sort={sort} align="right" className="max-md:hidden md:w-28">Aangevraagd</SortTh>
                <SortTh kolom="vrij" sort={sort} align="right" className="w-24 md:w-32">Vrij</SortTh>
                <SortTh kolom="kleinVerlet" sort={sort} align="right" className="max-md:hidden md:w-28">Klein verlet</SortTh>
              </tr>
            </thead>
            <tbody>
              {zichtbaar.map(({ user: u, balans: b }) => {
                // Krap/laag op het vrij aan te vragen saldo: hetzelfde
                // hoofdgetal als het dashboard en de verlofbalans-kaart.
                const krap = b.betaaldVrij <= 0;
                const laag = !krap && b.betaaldVrij <= 3;
                const boven = Math.max(0, b.betaaldGebruikt - b.betaaldBudget);
                return (
                  <tr key={u.id}>
                    <Td className="max-md:px-3">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="max-md:hidden"><Avatar naam={u.name} size="sm" /></span>
                        <span className="truncate font-medium text-slate-800">{u.name}</span>
                      </span>
                    </Td>
                    <Td num className="max-md:hidden">{b.betaaldBudget}</Td>
                    <Td num>{b.betaaldGebruikt}</Td>
                    <Td num className={cn('max-md:hidden', b.betaaldAangevraagd > 0 ? 'text-amber-700' : 'text-slate-500')}>{b.betaaldAangevraagd || '—'}</Td>
                    <Td num className={cn('font-semibold', krap ? 'text-red-700' : laag ? 'text-amber-700' : 'text-slate-800')}>
                      {b.betaaldVrij}
                      {boven > 0 && <span className="block whitespace-normal text-xs font-normal text-red-700 md:whitespace-nowrap">{boven} boven budget</span>}
                    </Td>
                    <Td num className="max-md:hidden">{b.kleinVerletDagen || '—'}</Td>
                  </tr>
                );
              })}
              {zichtbaar.length === 0 && (
                <tr><Td className="py-6 text-center text-sm text-slate-500">{zoek ? `Niemand gevonden voor “${zoek}”.` : 'Geen medewerkers.'}</Td></tr>
              )}
            </tbody>
            {rijen.length > 1 && !zoek && (
              <tfoot>
                <tr className="bg-surface-muted/60 text-xs font-semibold text-slate-700">
                  <Th>Totaal ({rijen.length})</Th>
                  <Th num className="max-md:hidden">{totaal.budget}</Th>
                  <Th num>{totaal.gebruikt}</Th>
                  <Th num className="max-md:hidden">{totaal.aangevraagd || '—'}</Th>
                  <Th num>{totaal.vrij}</Th>
                  <Th num className="max-md:hidden">{totaal.kleinVerlet || '—'}</Th>
                </tr>
              </tfoot>
            )}
          </table>
        </TableShell>
      </div>
    </Modal>
  );
}
