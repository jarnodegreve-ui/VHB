import { useCallback, useEffect, useState } from 'react';
import { MailBevestiging, type MailVoorbeeld } from '../../components/MailBevestiging';
import { apiFetch, apiJson } from '../../lib/api';
import { meldSchrijffout } from '../../lib/fouten';
import { formatMomentKort } from '../../lib/format';
import type { MailUitkomst } from '../../lib/mailUitkomst';
import { cn } from '../../lib/ui';
import { UITNODIGING_GELDIG_DAGEN, beschrijfOvergeslagen, type UitnodigingBeletsel } from '../../../shared/uitnodiging';

/**
 * Uitnodigen voor het portaal vanuit Gebruikers (30-09): het rijmenu en de
 * bulkbalk starten hier. Eerst een droge run (wie, en hoe de mail eruitziet),
 * dan de gedeelde MailBevestiging, die ook een deels mislukte verzending
 * afhandelt. De server maakt per persoon een eigen link die zeven dagen
 * werkt (api/_lib/uitnodiging.ts).
 */

export type Uitnodiging = { op: string; tot: string };
type Overgeslagen = { id: string; naam: string; reden: UitnodigingBeletsel };
type Droog = MailVoorbeeld & { overgeslagen: Overgeslagen[] };

/** Lopende uitnodiging per gebruiker; best-effort, zoals de andere kolommen van Gebruikers. */
export function useUitnodigingen() {
  const [perUser, setPerUser] = useState<ReadonlyMap<string, Uitnodiging>>(new Map());
  const laad = useCallback(async () => {
    try {
      const res = await apiFetch('/api/users/uitnodigingen');
      if (!res.ok) return;
      const body = await res.json();
      if (!Array.isArray(body?.uitnodigingen)) return;
      setPerUser(new Map(body.uitnodigingen.map((u: { userId: string } & Uitnodiging) => [String(u.userId), { op: u.op, tot: u.tot }])));
    } catch { /* zonder deze lijst geen "Uitgenodigd"-regel */ }
  }, []);
  useEffect(() => { void laad(); }, [laad]);
  return { perUser, laad };
}

/** `start(ids)` opent het voorbeeld; `venster` is de bevestiging, render die één keer. */
export function useUitnodigen({ onVerstuurd }: { onVerstuurd: () => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const [voorbeeld, setVoorbeeld] = useState<Droog | null>(null);
  const [bezig, setBezig] = useState(false);

  const start = async (kandidaten: string[]) => {
    if (bezig || kandidaten.length === 0) return;
    setBezig(true);
    try {
      const droog = await apiJson<Droog>('/api/users/uitnodigen', { method: 'POST', body: JSON.stringify({ ids: kandidaten, droog: true }) });
      setIds(kandidaten);
      setVoorbeeld(droog);
    } catch (err) {
      meldSchrijffout('Uitnodigen', err);
    } finally {
      setBezig(false);
    }
  };

  const verstuur = async (alleen?: string[]): Promise<MailUitkomst> => {
    const uitkomst = await apiJson<MailUitkomst>('/api/users/uitnodigen', { method: 'POST', body: JSON.stringify({ ids, ...(alleen ? { alleen } : {}) }) });
    onVerstuurd();
    return uitkomst;
  };

  const overgeslagen = voorbeeld?.overgeslagen ?? [];
  const venster = (
    <MailBevestiging
      voorbeeld={voorbeeld}
      naam="Voorbeeld van de uitnodiging"
      toon="naam"
      werkwoord="Uitnodiging verstuurd"
      extra={`Elk met een eigen link om een wachtwoord te kiezen, ${UITNODIGING_GELDIG_DAGEN} dagen geldig.${overgeslagen.length > 0 ? ` Niet uitgenodigd: ${beschrijfOvergeslagen(overgeslagen)}.` : ''}`}
      logVerwijzing="Het verzendlog staat in Beheer › Mails."
      verstuur={verstuur}
      onTerug={() => setVoorbeeld(null)}
      onKlaar={() => setVoorbeeld(null)}
    />
  );
  return { start, bezig, venster };
}

/** De regel onder "Nooit" in Laatst actief: de lopende of verlopen uitnodiging. */
export function UitnodigingRegel({ uitnodiging }: { uitnodiging?: Uitnodiging }) {
  if (!uitnodiging) return null;
  const verlopen = !(Date.parse(uitnodiging.tot) > Date.now());
  // Alleen de dag ("30/09"): de kaart op de telefoon is een halve breedte.
  const dag = formatMomentKort(uitnodiging.op).split(' ')[0];
  return (
    <span className={cn('block text-xs', verlopen ? 'font-medium text-amber-700' : 'font-normal text-slate-500')}>
      {verlopen ? 'Uitnodiging verlopen' : `Uitgenodigd ${dag}`}
    </span>
  );
}
