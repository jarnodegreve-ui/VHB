import { useMemo, useState } from 'react';
import type { LeaveRequest, User } from '../types';
import { formatUpdateDate, MONTH_NAMES } from '../lib/format';
import { beschikbareZiekteJaren, berekenZiekteInzicht } from '../lib/ziekteInzicht';
import { Avatar } from './Avatar';
import { Card, CardHeader } from './Card';
import { Field, Input, Select } from './Field';
import { InfoTip } from './InfoTip';
import { Paginering } from './Table';
import { TableShell, Td, Th } from './TabelBasis';
import { EmptyState } from './ui';

const naamVolgorde = new Intl.Collator('nl-BE', { sensitivity: 'base', numeric: true });
const getal = (waarde: number) => waarde.toLocaleString('nl-BE');
const PER_PAGINA = 6;

export function ZiekteInzicht({ leaveRequests, users, vandaag }: {
  leaveRequests: LeaveRequest[];
  users: User[];
  vandaag: string;
}) {
  const huidigJaar = Number(vandaag.slice(0, 4));
  const [gekozenJaar, setGekozenJaar] = useState(huidigJaar);
  const [zoek, setZoek] = useState('');
  const [pagina, setPagina] = useState(1);
  const jaren = useMemo(() => beschikbareZiekteJaren(leaveRequests, vandaag), [leaveRequests, vandaag]);
  const jaar = jaren.includes(gekozenJaar) ? gekozenJaar : huidigJaar;
  const inzicht = useMemo(() => berekenZiekteInzicht(leaveRequests, jaar, vandaag), [leaveRequests, jaar, vandaag]);
  const chauffeurs = useMemo(() => {
    const namen = new Map(users.map((user) => [user.id, user.name]));
    return inzicht.chauffeurs
      .map((chauffeur) => ({ ...chauffeur, naam: namen.get(chauffeur.userId) || 'Onbekende chauffeur' }))
      .sort((a, b) => naamVolgorde.compare(a.naam, b.naam) || a.userId.localeCompare(b.userId));
  }, [inzicht.chauffeurs, users]);
  const zoekterm = zoek.trim().toLocaleLowerCase('nl-BE');
  const zichtbaar = chauffeurs.filter((chauffeur) => chauffeur.naam.toLocaleLowerCase('nl-BE').includes(zoekterm));
  const huidigePagina = Math.min(pagina, Math.max(1, Math.ceil(zichtbaar.length / PER_PAGINA)));
  const paginaChauffeurs = zichtbaar.slice((huidigePagina - 1) * PER_PAGINA, huidigePagina * PER_PAGINA);
  const maximum = Math.max(1, ...inzicht.maanden.map((maand) => maand.kalenderdagen));
  const overzichtLabel = `Ziekte per chauffeur in ${jaar}`;

  return (
    <Card as="section" aria-label="Jaaroverzicht ziekte" className="@container min-w-0 space-y-6">
      <CardHeader
        size="lg"
        title="Jaaroverzicht"
        description={`Geregistreerde ziekte in ${jaar}${inzicht.totEnMet ? `, t/m ${formatUpdateDate(inzicht.totEnMet)}` : ''}.`}
        aside={(
          <div className="ml-auto flex items-end gap-2">
            <Field label="Jaar" className="w-28">
              {({ id }) => (
                <Select id={id} value={jaar} onChange={(event) => { setGekozenJaar(Number(event.target.value)); setPagina(1); }}>
                  {jaren.map((optie) => <option key={optie} value={optie}>{optie}</option>)}
                </Select>
              )}
            </Field>
            <InfoTip label="Toelichting bij het jaaroverzicht" align="right" className="mb-1 [&_[role=dialog]]:max-w-[calc(100vw-5rem)]">
              Alleen goedgekeurde ziekmeldingen tellen mee. Kalenderdagen zijn inclusief weekends,
              tot en met vandaag. Overlappende meldingen tellen per chauffeur en dag één keer mee.
              Elke afzonderlijke melding die deze periode raakt, telt als geregistreerde melding.
              Een geregistreerde einddatum bevestigt niet dat iemand hersteld is.
            </InfoTip>
          </div>
        )}
      />

      <dl aria-label="Jaartotalen" className="grid grid-cols-2 gap-5 rounded-2xl bg-surface-muted p-4 sm:grid-cols-3">
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <dt className="text-label text-slate-600">Kalenderdagen</dt>
          <dd className="mt-1 text-stat text-slate-900">{getal(inzicht.totaalKalenderdagen)}</dd>
          <dd className="mt-0.5 text-xs text-slate-500">Inclusief weekends</dd>
        </div>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <dt className="text-label text-slate-600">Chauffeurs</dt>
          <dd className="mt-1 text-stat text-slate-900">{getal(chauffeurs.length)}</dd>
          <dd className="mt-0.5 text-xs text-slate-500">Met een registratie</dd>
        </div>
        <div className="col-span-2 min-w-0 [overflow-wrap:anywhere] sm:col-span-1">
          <dt className="text-label text-slate-600">Geregistreerde meldingen</dt>
          <dd className="mt-1 text-stat text-slate-900">{getal(inzicht.aantalMeldingen)}</dd>
        </div>
      </dl>

      <div className="grid gap-6 @[60rem]:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
        <figure aria-label={`Kalenderdagen per maand in ${jaar}`} className="min-w-0 space-y-3">
          <figcaption className="text-label text-slate-700">Kalenderdagen per maand</figcaption>
          {/* Horizontale staven houden maandnamen én aantallen leesbaar op een smal scherm. */}
          <ol className="space-y-2">
            {inzicht.maanden.map((maand) => {
              const naam = MONTH_NAMES[maand.maand - 1];
              const toekomst = `${jaar}-${String(maand.maand).padStart(2, '0')}-01` > vandaag;
              return (
                <li
                  key={maand.maand}
                  aria-label={`${naam}: ${toekomst ? 'nog niet begonnen' : `${maand.kalenderdagen} kalenderdagen`}`}
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-body-sm"
                >
                  <span aria-hidden="true" className="text-slate-600">{naam}</span>
                  <span aria-hidden="true" className="h-3 overflow-hidden rounded-full bg-surface-muted">
                    <span className="block h-full rounded-full bg-slate-500" style={{ width: `${maand.kalenderdagen / maximum * 100}%` }} />
                  </span>
                  <span aria-hidden="true" className="text-right font-medium text-slate-800">{toekomst ? '—' : getal(maand.kalenderdagen)}</span>
                </li>
              );
            })}
          </ol>
          {jaar === huidigJaar && vandaag.slice(5, 7) !== '12' && (
            <p className="text-xs text-slate-500">Een streepje betekent dat de maand nog niet begonnen is.</p>
          )}
        </figure>

        <div className="min-w-0 space-y-4 border-t border-hairline pt-5 @[60rem]:border-l @[60rem]:border-t-0 @[60rem]:pl-6 @[60rem]:pt-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-card-title">Per chauffeur</h3>
              <p className="mt-1 text-xs text-slate-500">Alfabetisch op naam</p>
            </div>
            <Field label="Zoek chauffeur" className="w-full sm:max-w-xs">
              {({ id }) => <Input id={id} type="search" value={zoek} onChange={(event) => { setZoek(event.target.value); setPagina(1); }} placeholder="Naam…" />}
            </Field>
          </div>

          {zichtbaar.length === 0 ? (
            <EmptyState
              kaal
              title={chauffeurs.length === 0 ? `Geen geregistreerde ziektedagen in ${jaar}` : 'Geen chauffeur gevonden'}
              message={chauffeurs.length === 0 ? undefined : 'Pas de naam in het zoekveld aan.'}
            />
          ) : (
            <>
              <TableShell className="hidden sm:block">
                <table aria-label={overzichtLabel} className="w-full table-fixed">
                  <colgroup><col className="w-1/2" /><col className="w-1/4" /><col className="w-1/4" /></colgroup>
                  <thead>
                    <tr>
                      <Th>Chauffeur</Th>
                      <Th num className="whitespace-normal [overflow-wrap:anywhere]">Kalenderdagen</Th>
                      <Th num className="whitespace-normal [overflow-wrap:anywhere]">Geregistreerde meldingen</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {paginaChauffeurs.map((chauffeur) => (
                      <tr key={chauffeur.userId}>
                        <Td>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar naam={chauffeur.naam} />
                            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{chauffeur.naam}</span>
                          </div>
                        </Td>
                        <Td num>{getal(chauffeur.kalenderdagen)}</Td>
                        <Td num>{getal(chauffeur.meldingen)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <ul aria-label={overzichtLabel} className="divide-y divide-hairline sm:hidden">
                {paginaChauffeurs.map((chauffeur) => (
                  <li key={chauffeur.userId} className="space-y-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar naam={chauffeur.naam} />
                      <span className="min-w-0 text-body font-medium text-slate-800 [overflow-wrap:anywhere]">{chauffeur.naam}</span>
                    </div>
                    <dl className="grid grid-cols-2 gap-4 text-body-sm [overflow-wrap:anywhere]">
                      <div className="min-w-0">
                        <dt className="text-slate-500">Kalenderdagen</dt>
                        <dd className="mt-0.5 font-semibold text-slate-800">{getal(chauffeur.kalenderdagen)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-slate-500">Geregistreerde meldingen</dt>
                        <dd className="mt-0.5 font-semibold text-slate-800">{getal(chauffeur.meldingen)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
              <Paginering totaal={zichtbaar.length} perPagina={PER_PAGINA} pagina={huidigePagina} onPagina={setPagina} />
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
