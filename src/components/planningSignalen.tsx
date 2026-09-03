import { Badge, Button } from './primitives';
import { formatShortDay } from '../lib/format';
import type { VerwachtingAfwijking } from '../lib/coverageGaps';

/**
 * Gedeelde bouwstenen voor de "Excel en portaal lopen uiteen"-signalen.
 * De import-preview en de dekking/ZiekteView toonden dezelfde data eerst elk
 * in hun eigen dialect (andere datumnotatie, knoptekst, chipvorm) — wie na de
 * preview het Ziekte-blad opende zag dezelfde lijst in een ander jasje, en de
 * teksten dreven bij elke tweak verder uiteen (controle-ronde 20-08).
 */

/** Afwijkingen tussen de dag-type-verwachtingen en de gereden praktijk. */
export function VerwachtingAfwijkingLijst({ afwijkingen }: { afwijkingen: VerwachtingAfwijking[] }) {
  return (
    <ul className="mt-3 space-y-1.5 text-xs font-medium text-amber-900">
      {afwijkingen.map((a) => (
        <li key={a.dayType} className="flex items-start gap-2">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          <span>
            <span className="font-bold capitalize">{a.dayType}</span>
            <span className="tabular-nums"> ({a.dagen} {a.dagen === 1 ? 'dag' : 'dagen'})</span>
            {a.nooitGereden.length > 0 && <> — verwacht maar nooit gereden: <span className="font-bold tabular-nums">{a.nooitGereden.join(', ')}</span></>}
            {a.nietVerwacht.length > 0 && <>{a.nooitGereden.length > 0 ? ' · ' : ' — '}wél gereden maar niet in de verwachting: <span className="font-bold tabular-nums">{a.nietVerwacht.map((x) => x.code).join(', ')}</span></>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Eén "ziek in de Excel, niet geregistreerd"-reeks zoals de server hem levert. */
export type ZiekteReeks = {
  userId: string | null;
  naam: string;
  van: string;
  tot: string;
  dagen: number;
  /** false = account gepauzeerd → sick-report weigert, dus geen knop tonen. */
  actief?: boolean;
  /** true = naam matcht méérdere accounts (remedie: namen uniek maken). */
  ambigu?: boolean;
};

export const ziekteReeksSleutel = (r: Pick<ZiekteReeks, 'userId' | 'naam' | 'van'>) =>
  `${r.userId ?? r.naam}|${r.van}`;

/**
 * Eén rij "ziek in de planning, hier niet geregistreerd" met de juiste actie:
 * registreer-knop, of een chip die uitlegt waaróm registreren niet kan —
 * geen account, méérdere accounts (naam-botsing) of een gepauzeerd account.
 */
export function ZiekteReeksRij({ reeks, bezig, klaar, disabled, onRegistreer }: {
  reeks: ZiekteReeks;
  /** Deze reeks wordt op dit moment geregistreerd. */
  bezig: boolean;
  /** Al geregistreerd in deze sessie (preview toont dan een vinkje). */
  klaar?: boolean;
  /** Een andere registratie loopt — knop tijdelijk uit. */
  disabled?: boolean;
  onRegistreer: (reeks: ZiekteReeks) => void;
}) {
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl bg-surface-white ring-1 ring-amber-200/70 px-3 py-2">
      <span className="min-w-0 flex-1 text-xs font-medium text-slate-700">
        <span className="font-bold">{reeks.naam}</span>
        {' — ziek '}
        <span className="tabular-nums">{formatShortDay(reeks.van)}{reeks.tot !== reeks.van ? ` → ${formatShortDay(reeks.tot)}` : ''}</span>
        <span className="text-slate-400 tabular-nums"> · {reeks.dagen} {reeks.dagen === 1 ? 'dag' : 'dagen'}</span>
      </span>
      {klaar ? (
        <Badge tone="emerald">Geregistreerd</Badge>
      ) : !reeks.userId ? (
        reeks.ambigu
          ? <Badge tone="amber" title="Deze naam matcht meerdere accounts — maak de namen uniek in het gebruikersbeheer, dan kan er geregistreerd worden.">Meerdere accounts</Badge>
          : <Badge tone="slate" title="Deze Excel-naam is niet aan een account te koppelen — controleer de schrijfwijze of maak het account aan.">Geen account</Badge>
      ) : reeks.actief === false ? (
        <Badge tone="slate" title="Dit account staat gepauzeerd — activeer het in het gebruikersbeheer om de ziekte te registreren.">Account gepauzeerd</Badge>
      ) : (
        <Button variant="secondary" size="sm" className="shrink-0" disabled={disabled} onClick={() => onRegistreer(reeks)}>
          {bezig ? 'Bezig…' : 'Registreer ziekte'}
        </Button>
      )}
    </li>
  );
}
