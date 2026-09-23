import { formatDateHuman } from '../lib/format';
import { dagenTotVerval, kortVervalDatum, vervalDagenTekst, vervalStil, vervalToon } from '../lib/verval';
import { Badge } from './primitives';

/**
 * Eén vervaldatum als pil: "27 nov 2027 · 45 d", kleur volgens de termijn
 * (src/lib/verval.ts), volledige datum in de tooltip, niet afbrekend. Zonder
 * datum een gedempte "—". `label` zet de soort ervoor ("Code 95: …") voor
 * een kaart op de telefoon, waar geen kolomkop boven staat.
 *
 * `dagen` mag de aanroeper meegeven als hij ze al gerekend heeft (sorteren,
 * tellers); anders rekent de pil zelf tegen vandaag.
 */
export function VervalPil({ datum, dagen, label }: { datum?: string | null; dagen?: number; label?: string }) {
  const voor = label ? `${label}: ` : '';
  if (!datum) {
    return <Badge tone="slate" className="whitespace-nowrap opacity-70">{voor}—</Badge>;
  }
  const n = dagen ?? dagenTotVerval(datum);
  return (
    <Badge tone={vervalToon(n)} dot stil={vervalStil(n)} className="whitespace-nowrap">
      {voor}
      <span title={formatDateHuman(datum)}>{kortVervalDatum(datum)}</span>
      <span className="text-slate-500">· {vervalDagenTekst(n)}</span>
    </Badge>
  );
}
