import { useEffect, useMemo, useState } from 'react';
import type { Dienstregeling, Service } from '../../types';
import { SlideOver } from '../SlideOver';
import { EmptyState } from '../ui';
import { Chip, MicroLabel } from '../primitives';
import { BrandSpinner } from '../BrandSpinner';
import { haalVersieDiensten } from '../../lib/dienstregelingen';
import { DIENST_VELD_LABEL, vergelijkDiensten, versieLabel, type DienstKern, type DienstVerschil } from '../../../shared/dienstregeling';
import { cn } from '../../lib/ui';

const tekst = (d: DienstKern | null, veld: keyof typeof DIENST_VELD_LABEL): string => String(d?.[veld] ?? '').trim() || 'leeg';

function Deel({ d }: { d: DienstKern }) {
  const delen = [
    [d.loopnr, d.startTime, d.endTime], [d.loopnr2, d.startTime2, d.endTime2], [d.loopnr3, d.startTime3, d.endTime3],
  ].filter(([, s, e]) => String(s ?? '').trim() && String(e ?? '').trim());
  return (
    <span className="tabular-nums text-slate-600">
      {delen.map(([loop, s, e], i) => (
        <span key={i} className="mr-2 whitespace-nowrap">{loop ? <Chip>{String(loop)}</Chip> : null} {s}–{e}</span>
      ))}
    </span>
  );
}

/**
 * Wat verandert er tussen twee versies van de dienstregeling? Het
 * controleblad vóór een nieuwe dienstregeling ingaat: per dienst welke
 * tijden en loopnummers verschuiven, en welke diensten erbij komen of
 * verdwijnen. De vorige versie wordt hier geladen; de gekozen krijgt het
 * scherm al mee.
 */
export function VersieVergelijking({ open, onClose, gekozen, vorige, gekozenDiensten }: {
  open: boolean;
  onClose: () => void;
  gekozen: Dienstregeling;
  vorige: Dienstregeling;
  gekozenDiensten: Service[];
}) {
  const [vorigeDiensten, setVorigeDiensten] = useState<Service[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let actief = true;
    setVorigeDiensten(null);
    setFout(null);
    haalVersieDiensten(vorige.id)
      .then((r) => { if (actief) setVorigeDiensten(r.services); })
      .catch((err) => { if (actief) setFout(err instanceof Error ? err.message : 'De vorige versie kon niet geladen worden.'); });
    return () => { actief = false; };
  }, [open, vorige.id]);

  const v = useMemo(() => (vorigeDiensten ? vergelijkDiensten(vorigeDiensten, gekozenDiensten) : null), [vorigeDiensten, gekozenDiensten]);

  const rij = (d: DienstVerschil, soort: 'gewijzigd' | 'nieuw' | 'weg') => (
    <li key={`${soort}-${d.nummer}`} className="py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold tabular-nums">{d.nummer}</span>
        {soort === 'nieuw' && d.nieuw && <Deel d={d.nieuw} />}
        {soort === 'weg' && d.oud && <Deel d={d.oud} />}
      </div>
      {soort === 'gewijzigd' && (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
          {d.velden.map((veld) => (
            <li key={veld} className="flex flex-wrap gap-x-2 tabular-nums">
              <span className="w-24 shrink-0 text-slate-500">{DIENST_VELD_LABEL[veld]}</span>
              <span className="line-through decoration-slate-400">{tekst(d.oud, veld)}</span>
              <span className="font-medium text-ink">{tekst(d.nieuw, veld)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  const blok = (titel: string, lijst: DienstVerschil[], soort: 'gewijzigd' | 'nieuw' | 'weg') => lijst.length > 0 && (
    <section className="mt-5 first:mt-0">
      <MicroLabel className={cn(soort === 'weg' && 'text-red-700')}>{titel} ({lijst.length})</MicroLabel>
      <ul className="mt-1 divide-y divide-hairline">{lijst.map((d) => rij(d, soort))}</ul>
    </section>
  );

  return (
    <SlideOver open={open} onClose={onClose} width="lg" title="Wat verandert er?" subtitle={`${versieLabel(vorige)} vergeleken met ${versieLabel(gekozen)}.`} titelTerugloop>
      {fout ? (
        <EmptyState variant="fout" title="Vergelijken lukt niet" message={fout} />
      ) : !v ? (
        <div className="flex justify-center py-10"><BrandSpinner /></div>
      ) : v.gewijzigd.length + v.nieuw.length + v.weg.length === 0 ? (
        <EmptyState title="Geen verschillen" message={`Alle ${v.ongewijzigd} diensten zijn gelijk in beide versies.`} />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {v.gewijzigd.length} gewijzigd, {v.nieuw.length} nieuw, {v.weg.length} weg, {v.ongewijzigd} ongewijzigd.
          </p>
          {blok('Gewijzigde diensten', v.gewijzigd, 'gewijzigd')}
          {blok('Nieuwe diensten', v.nieuw, 'nieuw')}
          {blok('Verdwenen diensten', v.weg, 'weg')}
        </>
      )}
    </SlideOver>
  );
}
