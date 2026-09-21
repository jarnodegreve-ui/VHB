// @vitest-environment node
/**
 * De drie ruilrapporten op vaste cijfers. Het uitvoeringsmoment en wie
 * weigerde komen uit het activiteitenlog, nooit uit `decidedAt`; elke dag is
 * een Brusselse kalenderdag, ook rond middernacht en in de week van de zomer-
 * en winteruurwissel. Draai ook met TZ=UTC en TZ=Europe/Brussels: de uitkomst
 * mag niet van de tijdzone van de server afhangen.
 */
import { describe, expect, it } from 'vitest';
import { SWAP_UITVOERING_ACTIES } from '../api/helpers';
import { bouwRuilaanvragen, bouwRuilenPerChauffeur, bouwUitgevoerdeWissels, type RuilBron, type RuilRij } from '../api/_lib/rapporten/ruilen';
import { MAX_UITVOERING_DAGEN, brusselseDagVan, uitvoeringPeriodeFout, uitvoeringenOpDagen, utcVensterVoor } from '../api/_lib/ruilUitvoeringen';
import { rapportVan } from '../shared/rapporten/register';
import { totalenVoor } from '../shared/rapporten/opmaak';
import { RUIL_LOG_ACTIES, type RuilLogRegel } from '../shared/ruilVerloop';
import type { RapportFilters } from '../shared/rapporten/types';

const users = [
  { id: '10', name: 'Anna Aerts', role: 'chauffeur', isActive: true },
  { id: '11', name: 'Bert Bral', role: 'chauffeur', isActive: true },
  { id: '12', name: 'Carl Cools', role: 'chauffeur', isActive: false },
  { id: '1', name: 'Petra Planner', role: 'planner', isActive: true },
];

const HANDMATIG = 'Handmatige wissel door Petra Planner, Mondelinge dienstruil';
const swaps: RuilRij[] = [
  // Ruil over de maandgrens: aangevraagd in augustus, goedgekeurd op 01/09 om 00:30 Belgische tijd (31/08 22:30 UTC).
  { id: 's1', requesterId: '10', targetDriverId: '11', status: 'completed', createdAt: '2026-08-30T09:00:00.000Z', decidedAt: '2026-09-05T08:00:00.000Z', swapType: 'ruil', shiftDate: '2026-09-02', shiftLine: '2109', returnDate: '2026-09-03', returnCode: '2105' },
  // Rechtstreeks goedgekeurd door de planning, zonder het antwoord van de collega af te wachten.
  { id: 's2', requesterId: '11', targetDriverId: '10', status: 'approved', createdAt: '2026-09-10T08:00:00.000Z', decidedAt: '2026-09-10T09:00:00.000Z', swapType: 'overname', shiftDate: '2026-09-20', shiftLine: '2703' },
  // Handmatige wissel (geen collega-akkoord), later teruggedraaid: `decidedAt` is dan de terugdraai, niet de doorvoer.
  { id: 's3', requesterId: '10', targetDriverId: '12', status: 'cancelled', createdAt: '2026-09-12T07:00:00.000Z', decidedAt: '2026-09-14T09:00:00.000Z', reason: HANDMATIG, swapType: 'overname', shiftDate: '2026-09-15', shiftLine: '2102' },
  // Geweigerd door de collega.
  { id: 's4', requesterId: '10', targetDriverId: '11', status: 'rejected', createdAt: '2026-09-15T08:00:00.000Z', decidedAt: '2026-09-16T08:00:00.000Z', swapType: 'ruil', shiftDate: '2026-09-25', shiftLine: '2111', returnDate: '2026-09-26', returnCode: 'vrij' },
  // Nog open.
  { id: 's5', requesterId: '11', targetDriverId: '10', status: 'pending', createdAt: '2026-09-18T08:00:00.000Z', swapType: 'ruil', shiftDate: '2026-10-02', shiftLine: '2116', returnDate: '2026-10-03', returnCode: '2104' },
  // Ingetrokken door de aanvrager.
  { id: 's6', requesterId: '10', targetDriverId: '11', status: 'cancelled', createdAt: '2026-09-19T08:00:00.000Z', decidedAt: '2026-09-19T12:00:00.000Z', swapType: 'ruil', shiftDate: '2026-10-05', shiftLine: '2101', returnDate: '2026-10-06', returnCode: '2102' },
  // Winteruur (zondag 25/10/2026 03:00 → 02:00): 24/10 22:30 UTC is 25/10 00:30 (nog +2), 25/10 23:30 UTC is 26/10 00:30 (+1).
  { id: 's7', requesterId: '11', targetDriverId: '10', status: 'approved', createdAt: '2026-10-20T08:00:00.000Z', swapType: 'overname', shiftDate: '2026-10-30', shiftLine: '4406' },
  { id: 's8', requesterId: '10', targetDriverId: '11', status: 'approved', createdAt: '2026-10-21T08:00:00.000Z', swapType: 'overname', shiftDate: '2026-10-31', shiftLine: '4407' },
];

const regel = (createdAt: string, action: string, actorRole: string, actorName: string, details = ''): RuilLogRegel => ({ createdAt, action, actorRole, actorName, details });
const logPerRuil: Record<string, RuilLogRegel[]> = {
  s1: [
    regel('2026-08-30T09:00:00.000Z', 'Dienstruil aangevraagd', 'chauffeur', 'Anna Aerts'),
    regel('2026-08-30T10:00:00.000Z', 'Dienstruil geaccepteerd', 'chauffeur', 'Bert Bral', 'Anna Aerts, dienstruil (pending → accepted).'),
    regel('2026-08-31T22:30:00.000Z', 'Dienstruil goedgekeurd', 'planner', 'Petra Planner', 'Anna Aerts, dienstruil (accepted → approved).'),
    regel('2026-09-05T08:00:00.000Z', 'Dienstruil voltooid', 'planner', 'Petra Planner', 'Anna Aerts, dienstruil (approved → completed).'),
  ],
  s2: [
    regel('2026-09-10T08:00:00.000Z', 'Dienstruil aangevraagd', 'chauffeur', 'Bert Bral'),
    regel('2026-09-10T09:00:00.000Z', 'Dienstruil goedgekeurd', 'admin', 'Jarno De Greve', 'Bert Bral, dienstruil (pending → approved).'),
  ],
  s3: [
    regel('2026-09-12T07:00:00.000Z', 'Dienst handmatig overgezet', 'planner', 'Petra Planner', 'Anna Aerts → Carl Cools, dienst 2102.'),
    regel('2026-09-14T09:00:00.000Z', 'Dienstruil geannuleerd', 'planner', 'Petra Planner', 'Anna Aerts, dienstruil (approved → cancelled).'),
  ],
  s4: [
    regel('2026-09-15T08:00:00.000Z', 'Dienstruil aangevraagd', 'chauffeur', 'Anna Aerts'),
    regel('2026-09-16T08:00:00.000Z', 'Dienstruil afgewezen', 'chauffeur', 'Bert Bral', 'Anna Aerts, dienstruil (pending → rejected).'),
  ],
  s5: [regel('2026-09-18T08:00:00.000Z', 'Dienstruil aangevraagd', 'chauffeur', 'Bert Bral')],
  s6: [
    regel('2026-09-19T08:00:00.000Z', 'Dienstruil aangevraagd', 'chauffeur', 'Anna Aerts'),
    regel('2026-09-19T12:00:00.000Z', 'Dienstruil geannuleerd', 'chauffeur', 'Anna Aerts', 'Anna Aerts, dienstruil (pending → cancelled).'),
  ],
  s7: [regel('2026-10-24T22:30:00.000Z', 'Dienstruil goedgekeurd', 'planner', 'Petra Planner', '(pending → approved)')],
  s8: [regel('2026-10-25T23:30:00.000Z', 'Dienstruil goedgekeurd', 'planner', 'Petra Planner', '(pending → approved)')],
  // Een verwijderde ruil: het logspoor blijft, het record niet.
  weg: [regel('2026-09-11T09:00:00.000Z', 'Dienstruil goedgekeurd', 'planner', 'Petra Planner')],
};

const bron: RuilBron = { swaps, users, logPerRuil, uitvoeringActies: SWAP_UITVOERING_ACTIES };
const filters = (van: string, tot: string, extra: Partial<RapportFilters> = {}): RapportFilters => ({ van, tot, keuzes: { status: 'alle', soort: 'alle' }, ...extra });
const SEPTEMBER = ['2026-09-01', '2026-09-30'] as const;

describe('de kern onder weekblad en rapport (api/_lib/ruilUitvoeringen.ts)', () => {
  it('de grens is de rapportgrens van 366 dagen (was 31), met dezelfde foutteksten', () => {
    expect(MAX_UITVOERING_DAGEN).toBe(366);
    expect(uitvoeringPeriodeFout('2026-09-14', '2026-09-20')).toBeNull();
    expect(uitvoeringPeriodeFout('2026-01-01', '2026-12-31')).toBeNull();
    expect(uitvoeringPeriodeFout('2028-01-01', '2028-12-31')).toBeNull();
    expect(uitvoeringPeriodeFout('2026-01-01', '2027-01-02')).toBe('De periode mag hoogstens 366 dagen beslaan.');
    expect(uitvoeringPeriodeFout('2026-09-20', '2026-09-14')).toMatch(/^Geef een geldige periode mee/);
    expect(uitvoeringPeriodeFout('2026-02-30', '2026-03-01')).toMatch(/^Geef een geldige periode mee/);
    expect(uitvoeringPeriodeFout('', '')).toMatch(/^Geef een geldige periode mee/);
  });

  it('het UTC-venster is een dag ruimer aan elke kant', () => {
    expect(utcVensterVoor('2026-09-14', '2026-09-20')).toEqual({ vanIso: '2026-09-13T00:00:00.000Z', totIso: '2026-09-22T00:00:00.000Z' });
  });

  it('de Brusselse dag rond middernacht, in zomer- en wintertijd', () => {
    expect(brusselseDagVan('2026-08-31T22:30:00.000Z')).toBe('2026-09-01');
    expect(brusselseDagVan('2026-08-31T21:59:00.000Z')).toBe('2026-08-31');
    // Winter (+1): 23:30 UTC is al de volgende dag, 22:30 UTC nog niet.
    expect(brusselseDagVan('2026-01-10T23:30:00+00:00')).toBe('2026-01-11');
    expect(brusselseDagVan('2026-01-10T22:30:00+00:00')).toBe('2026-01-10');
  });

  it('rond de zomer- en winteruurwissel', () => {
    // Zomeruur op 29/03/2026: 28/03 23:30 UTC = 29/03 00:30 (+1), 29/03 22:30 UTC = 30/03 00:30 (+2).
    expect(brusselseDagVan('2026-03-28T23:30:00.000Z')).toBe('2026-03-29');
    expect(brusselseDagVan('2026-03-29T22:30:00.000Z')).toBe('2026-03-30');
    expect(brusselseDagVan('2026-03-29T21:30:00.000Z')).toBe('2026-03-29');
    // Winteruur op 25/10/2026.
    expect(brusselseDagVan('2026-10-24T22:30:00.000Z')).toBe('2026-10-25');
    expect(brusselseDagVan('2026-10-25T22:30:00.000Z')).toBe('2026-10-25');
    expect(brusselseDagVan('2026-10-25T23:30:00.000Z')).toBe('2026-10-26');
  });

  it('een moment zonder tijdzone is al plaatselijke tijd en blijft wat het is; rommel is null', () => {
    expect(brusselseDagVan('2026-09-17T23:45:00')).toBe('2026-09-17');
    expect(brusselseDagVan('2026-09-17')).toBe('2026-09-17');
    expect(brusselseDagVan('gisteren')).toBeNull();
    expect(brusselseDagVan(null)).toBeNull();
  });

  it('filtert op de Brusselse dag, oudste eerst', () => {
    const regels = [{ createdAt: '2026-09-01T08:00:00.000Z' }, { createdAt: '2026-08-31T22:30:00.000Z' }, { createdAt: '2026-08-31T21:30:00.000Z' }];
    expect(uitvoeringenOpDagen(regels, '2026-09-01', '2026-09-30').map((r) => r.createdAt)).toEqual(['2026-08-31T22:30:00.000Z', '2026-09-01T08:00:00.000Z']);
  });

  it('elke uitvoeringsactie is een bekende ruil-logactie, en "bekeken" hoort er nooit bij', () => {
    for (const actie of SWAP_UITVOERING_ACTIES) expect(RUIL_LOG_ACTIES[actie], actie).toBeTruthy();
    expect(SWAP_UITVOERING_ACTIES).not.toContain('Dienstruil bekeken');
  });
});

describe('Uitgevoerde wissels', () => {
  it('september: de goedkeuring van 00:30 telt op 01/09, niet in augustus; de verwijderde ruil valt weg', () => {
    const uit = bouwUitgevoerdeWissels(bron, filters(...SEPTEMBER));
    expect(uit.rijen.map((r) => [r.uitgevoerdOp, r.van, r.naar, r.dienst, r.soort, r.status])).toEqual([
      ['2026-09-01', 'Anna Aerts', 'Bert Bral', '2109', 'Ruil', 'Afgehandeld'],
      ['2026-09-10', 'Bert Bral', 'Anna Aerts', '2703', 'Overname', 'Goedgekeurd'],
      ['2026-09-12', 'Anna Aerts', 'Carl Cools (uit dienst)', '2102', 'Handmatig', 'Teruggedraaid'],
    ]);
    expect(bouwUitgevoerdeWissels(bron, filters('2026-08-01', '2026-08-31')).rijen).toEqual([]);
  });

  it('de tegendienst staat er alleen bij een 1-op-1, en wie het uitvoerde komt uit de logregel', () => {
    const [ruil, overname, handmatig] = bouwUitgevoerdeWissels(bron, filters(...SEPTEMBER)).rijen;
    expect(ruil).toMatchObject({ dienstdatum: '2026-09-02', tegenDatum: '2026-09-03', tegenDienst: '2105', door: 'Petra Planner' });
    expect(overname).toMatchObject({ tegenDatum: null, tegenDienst: null, door: 'Jarno De Greve' });
    expect(handmatig).toMatchObject({ tegenDatum: null, door: 'Petra Planner' });
  });

  it('een teruggedraaide wissel blijft staan op de dag van de doorvoer, niet op die van de terugdraai (decidedAt)', () => {
    const teruggedraaid = bouwUitgevoerdeWissels(bron, filters('2026-09-12', '2026-09-12')).rijen;
    expect(teruggedraaid.map((r) => [r.id, r.status])).toEqual([['s3|2026-09-12T07:00:00.000Z', 'Teruggedraaid']]);
    expect(bouwUitgevoerdeWissels(bron, filters('2026-09-14', '2026-09-14')).rijen).toEqual([]);
  });

  it('winteruur: 25/10 00:30 en 26/10 00:30 vallen elk op hun eigen Brusselse dag', () => {
    expect(bouwUitgevoerdeWissels(bron, filters('2026-10-25', '2026-10-25')).rijen.map((r) => [r.uitgevoerdOp, r.dienst])).toEqual([['2026-10-25', '4406']]);
    expect(bouwUitgevoerdeWissels(bron, filters('2026-10-26', '2026-10-26')).rijen.map((r) => [r.uitgevoerdOp, r.dienst])).toEqual([['2026-10-26', '4407']]);
  });

  it('chauffeurfilter: aanvrager of collega', () => {
    expect(bouwUitgevoerdeWissels(bron, filters(...SEPTEMBER, { chauffeur: '12' })).rijen.map((r) => r.dienst)).toEqual(['2102']);
    expect(bouwUitgevoerdeWissels(bron, filters(...SEPTEMBER, { chauffeur: '11' })).rijen.map((r) => r.dienst)).toEqual(['2109', '2703']);
  });

  it('het bereik loopt van de eerste tot de laatste doorvoer in het log (het log van ruilen wordt nooit opgeruimd)', () => {
    expect(bouwUitgevoerdeWissels(bron, filters(...SEPTEMBER)).bereik).toEqual({ van: '2026-09-01', tot: '2026-10-26' });
    // Een periode vóór de eerste gegevens: geen rijen, en het bereik zegt vanaf wanneer.
    const voor = bouwUitgevoerdeWissels(bron, filters('2026-01-01', '2026-03-31'));
    expect(voor.rijen).toEqual([]);
    expect(voor.bereik?.van).toBe('2026-09-01');
    // Geen enkele doorvoer: de bron is leeg.
    expect(bouwUitgevoerdeWissels({ ...bron, logPerRuil: { s5: logPerRuil.s5 } }, filters(...SEPTEMBER)).bereik).toBeNull();
  });

  it('een verwijderde gebruiker blijft staan als "Onbekend (<id>)"', () => {
    const zonderBert = { ...bron, users: users.filter((u) => u.id !== '11') };
    expect(bouwUitgevoerdeWissels(zonderBert, filters('2026-09-01', '2026-09-01')).rijen[0].naar).toBe('Onbekend (11)');
  });
});

describe('Ruilen per chauffeur', () => {
  it('telt op de aanvraagdatum; een handmatige wissel is geen aanvraag', () => {
    const uit = bouwRuilenPerChauffeur(bron, filters(...SEPTEMBER));
    const perNaam = Object.fromEntries(uit.rijen.map((r) => [r.naam, r]));
    expect(perNaam['Anna Aerts']).toMatchObject({ aangevraagd: 2, ontvangen: 2, goedgekeurd: 1, geweigerd: 1, ingetrokken: 1, teruggedraaid: 1, open: 1, doorPlanning: 1 });
    expect(perNaam['Bert Bral']).toMatchObject({ aangevraagd: 2, ontvangen: 2, goedgekeurd: 1, geweigerd: 1, ingetrokken: 1, teruggedraaid: 0, open: 1, doorPlanning: 0 });
    expect(perNaam['Carl Cools (uit dienst)']).toMatchObject({ aangevraagd: 0, ontvangen: 0, teruggedraaid: 1, doorPlanning: 1 });
  });

  it('de totaalrij telt ruilen, niet de som van de rijen: een ruil staat bij twee chauffeurs maar is er één', () => {
    const def = rapportVan('ruilen-per-chauffeur')!;
    const uit = bouwRuilenPerChauffeur(bron, filters(...SEPTEMBER));
    expect(uit.totalen).toEqual({ aangevraagd: 4, ontvangen: 4, goedgekeurd: 1, geweigerd: 1, ingetrokken: 1, teruggedraaid: 1, open: 1, doorPlanning: 1 });
    // De som van de rijen zou 2 goedgekeurde ruilen geven; het totaal van de lader wint.
    expect(totalenVoor(def, uit.rijen, { vanLader: uit.totalen }).goedgekeurd).toBe(1);
  });

  it('de ruil van 30/08 hoort bij augustus, ook al is hij in september goedgekeurd', () => {
    const augustus = bouwRuilenPerChauffeur(bron, filters('2026-08-01', '2026-08-31'));
    expect(augustus.totalen).toMatchObject({ aangevraagd: 1, goedgekeurd: 1 });
    expect(augustus.bereik).toEqual({ van: '2026-08-30', tot: '2026-10-21' });
  });

  it('lege periode: geen rijen en geen totalen, het bereik blijft; zonder ruilen is de bron leeg', () => {
    const leeg = bouwRuilenPerChauffeur(bron, filters('2026-11-01', '2026-11-30'));
    expect(leeg.rijen).toEqual([]);
    expect(leeg.totalen).toBeUndefined();
    expect(leeg.bereik).toEqual({ van: '2026-08-30', tot: '2026-10-21' });
    expect(bouwRuilenPerChauffeur({ ...bron, swaps: [] }, filters(...SEPTEMBER)).bereik).toBeNull();
  });
});

describe('Ruilaanvragen', () => {
  const VANDAAG = '2026-09-21';
  const alle = () => bouwRuilaanvragen(bron, filters('2026-08-01', '2026-09-30'), VANDAAG);
  const rij = (id: string) => alle().rijen.find((r) => r.id === id)!;

  it('status, antwoord van de collega, beslismoment en wie besliste komen uit het verloop', () => {
    // Beslist = de goedkeuring (01/09 00:30 in Brussel), niet het latere afhandelen in decidedAt (05/09).
    expect(rij('s1')).toMatchObject({ aangevraagdOp: '2026-08-30', status: 'Afgehandeld', antwoord: 'Geaccepteerd', beslistOp: '2026-09-01', door: 'Petra Planner', doorlooptijd: 2, soort: 'Ruil' });
    // Rechtstreekse goedkeuring: het antwoord is niet afgewacht.
    expect(rij('s2')).toMatchObject({ status: 'Goedgekeurd', antwoord: 'Niet afgewacht', beslistOp: '2026-09-10', door: 'Jarno De Greve', doorlooptijd: 0, soort: 'Overname' });
    // De collega weigerde: hij staat bij "door wie", niet de planning.
    expect(rij('s4')).toMatchObject({ status: 'Geweigerd', antwoord: 'Geweigerd', beslistOp: '2026-09-16', door: 'Bert Bral', doorlooptijd: 1 });
    // Ingetrokken door de aanvrager.
    expect(rij('s6')).toMatchObject({ status: 'Ingetrokken', antwoord: 'Geen antwoord', beslistOp: '2026-09-19', door: 'Anna Aerts', doorlooptijd: 0 });
  });

  it('een open aanvraag telt door tot de peildatum', () => {
    expect(rij('s5')).toMatchObject({ status: 'Bij collega', antwoord: 'Wacht', beslistOp: null, door: null, doorlooptijd: 3 });
    expect(alle().peildatum).toBe(VANDAAG);
  });

  it('een handmatige wissel: geen collega-akkoord nodig, geen doorlooptijd, en teruggedraaid door de planning', () => {
    expect(rij('s3')).toMatchObject({ soort: 'Handmatig', status: 'Teruggedraaid', antwoord: 'Niet nodig', beslistOp: '2026-09-14', door: 'Petra Planner', doorlooptijd: null });
  });

  it('filters: status, soort en chauffeur', () => {
    const met = (keuzes: Record<string, string>, chauffeur?: string) =>
      bouwRuilaanvragen(bron, { ...filters('2026-08-01', '2026-09-30'), keuzes: { status: 'alle', soort: 'alle', ...keuzes }, chauffeur }, VANDAAG).rijen.map((r) => r.id);
    expect(met({ status: 'teruggedraaid' })).toEqual(['s3']);
    expect(met({ status: 'bij-collega' })).toEqual(['s5']);
    expect(met({ soort: 'handmatig' })).toEqual(['s3']);
    expect(met({ soort: 'overname' })).toEqual(['s2']);
    expect(met({}, '12')).toEqual(['s3']);
  });

  it('zonder log (niets af te leiden) gokt het rapport niet wie weigerde', () => {
    const zonderLog = bouwRuilaanvragen({ ...bron, logPerRuil: {} }, filters(...SEPTEMBER), VANDAAG).rijen.find((r) => r.id === 's4')!;
    expect(zonderLog).toMatchObject({ status: 'Geweigerd', door: 'Niet geregistreerd', beslistOp: '2026-09-16' });
  });

  it('het gemiddelde van de doorlooptijd slaat rijen zonder doorlooptijd over', () => {
    const def = rapportVan('ruilaanvragen')!;
    const uit = bouwRuilaanvragen(bron, filters(...SEPTEMBER), VANDAAG);
    // s2 = 0, s4 = 1, s5 = 3 (open), s6 = 0; s3 (handmatig) telt niet mee.
    expect(totalenVoor(def, uit.rijen).doorlooptijd).toBe(1);
  });

  it('periode vóór de eerste aanvraag: geen rijen, het bereik zegt vanaf wanneer', () => {
    const voor = bouwRuilaanvragen(bron, filters('2026-01-01', '2026-06-30'), VANDAAG);
    expect(voor.rijen).toEqual([]);
    expect(voor.bereik).toEqual({ van: '2026-08-30', tot: '2026-10-21' });
  });
});
