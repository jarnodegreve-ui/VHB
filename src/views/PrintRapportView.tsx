import { useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import { rapportVan } from '../../shared/rapporten/register';
import { filtersInWoorden, leesFilters, periodeVanFilters } from '../../shared/rapporten/filters';
import { berekenTotalen, rijBevat } from '../../shared/rapporten/opmaak';
import { ZOEK_PARAM, laadRapport, type RapportAntwoord } from '../lib/rapporten';
import { bereikUitleg } from '../lib/rapportBereik';
import { isoDate } from '../lib/datum';
import { PrintBlad, PrintTabel } from '../components/PrintBlad';
import { useVoertuigen, voertuigLabel } from '../components/Voertuigkiezer';

/**
 * Printblad van een rapport uit het register: nieuw tabblad via
 * `?print-rapport=<id>` plus dezelfde filterparameters als het scherm
 * (App.tsx vangt de parameter af vóór de app-schil, zoals de andere
 * printbladen). Haalt zijn cijfers zelf op bij dezelfde API als het scherm,
 * dus blad en scherm tonen hetzelfde. De opmaak is volledig `PrintBlad`.
 */
export function PrintRapportView({ rapportId, users, door }: { rapportId: string; users: User[]; door: string }) {
  const def = rapportVan(rapportId);
  const filters = useMemo(
    () => (def ? leesFilters(def, new URLSearchParams(window.location.search), isoDate(new Date())) : null),
    [def],
  );
  const zoek = useMemo(() => (new URLSearchParams(window.location.search).get(ZOEK_PARAM) ?? '').trim(), []);
  const [data, setData] = useState<RapportAntwoord | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const voertuigen = useVoertuigen(Boolean(def?.filters.some((f) => f.soort === 'voertuig')));

  useEffect(() => {
    if (!def || !filters) return;
    let actief = true;
    laadRapport(def, filters)
      .then((d) => { if (actief) setData(d); })
      .catch((e: unknown) => { if (actief) setFout(e instanceof Error ? e.message : 'Het rapport kon niet geladen worden.'); });
    return () => { actief = false; };
  }, [def, filters]);

  if (!def || !filters) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-white p-8 text-center text-slate-700">Dit rapport bestaat niet. Sluit dit tabblad.</div>;
  }
  if (fout) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-white p-8 text-center text-slate-700">{fout} Sluit dit tabblad en probeer het opnieuw.</div>;
  }
  if (!data) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-white p-8 text-slate-500">{def.titel} wordt geladen…</div>;
  }

  const { toestand, tekst: regel } = bereikUitleg(def, periodeVanFilters(def, filters), data.bereik);
  const buiten = toestand === 'geen-bron' || toestand === 'buiten';
  const woorden = filtersInWoorden(def, filters, {
    chauffeur: (id) => users.find((u) => u.id === id)?.name,
    voertuig: (id) => { const v = voertuigen.find((x) => x.id === id); return v ? voertuigLabel(v) : undefined; },
    peildatum: data.peildatum,
  });
  if (zoek) woorden.push(`Zoekterm: “${zoek}”`);
  // De zoekterm van het scherm telt als filter: dezelfde rijen, en de totalen
  // van precies die rijen (zonder zoekterm zijn dat de totalen van de server).
  const rijen = zoek ? data.rijen.filter((r) => rijBevat(def, r, zoek)) : data.rijen;
  const totalen = zoek ? berekenTotalen(def, rijen) : data.totalen;

  return (
    <PrintBlad
      titel={def.titel}
      filters={woorden}
      door={door}
      richting={def.print === 'liggend' ? 'liggend' : 'staand'}
      tabbladTitel={`VHB ${def.titel} ${woorden[0] ?? ''}`.trim()}
      opmerking={toestand === 'deels' ? regel : undefined}
    >
      {/* Periode zonder gegevens: geen tabel met nullen, wel een blad dat zegt
          vanaf wanneer er gegevens zijn (een leeg blad is soms het bewijsstuk). */}
      <PrintTabel
        def={def}
        rijen={buiten ? [] : rijen}
        totalen={buiten ? null : totalen}
        leegTekst={toestand === 'geen-bron' && regel ? regel : buiten && regel ? `Geen gegevens voor deze periode. ${regel}` : periodeVanFilters(def, filters) ? 'Geen gegevens voor deze periode.' : 'Geen gegevens voor deze filters.'}
      />
    </PrintBlad>
  );
}
