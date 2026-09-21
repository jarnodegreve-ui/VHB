// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bouwVerlofPerType, bouwVerlofaanvragen, bouwVerlofbezetting } from '../api/_lib/rapporten/verlof';
import { dagVanTijdstip, weekdagKort, type VerlofRij } from '../api/_lib/rapporten/gedeeld';
import { berekenTotalen, csvRijen, metKolommen, sorteerRijen } from '../shared/rapporten/opmaak';
import { rapportVan } from '../shared/rapporten/register';
import { bereikToestand } from '../shared/rapporten/periode';
import { VERLOF_STATUS_LABEL, VERLOF_TYPE_LABEL } from '../shared/rapporten/definities/verlof';
import { verlofBalans } from '../shared/verlofSaldo';
import { bezettingPerDag } from '../shared/verlofbezettingPerDag';
import { limietVoorDag, parseVerlofLimieten } from '../shared/schemas/verlofLimieten';

/**
 * De verlofrapporten op vaste cijfers. De dagen zijn met de hand nageteld op
 * de kalender van 2026: maandag tot en met zaterdag telt, zondag niet, een
 * wettelijke feestdag niet (21/07, 15/08, 01/01) en een extra vrije dag van de
 * beheerder ook niet. Zone-loze ISO-dagen, dus dezelfde uitkomst onder
 * TZ=Europe/Brussels en TZ=UTC; de twee tijdstippen met een zone rekenen
 * uitdrukkelijk naar Belgische tijd.
 */
const USERS = [
  { id: '10', name: 'Bert Buschauffeur', role: 'chauffeur', isActive: true, section: 'Reguliere diensten' },
  { id: '11', name: 'Tom Technieker', role: 'technieker', isActive: true, section: 'Garage' },
  { id: '12', name: 'Carla Vertrokken', role: 'chauffeur', isActive: false },
  { id: '13', name: 'Fien Flexi', role: 'chauffeur', isActive: true, section: 'Flexi' },
  { id: '14', name: 'Dirk Deeltijds', role: 'chauffeur', isActive: true },
];

const rij = (id: string, userId: string, startDate: string, endDate: string, type: string, status: string, rest: Partial<VerlofRij> = {}): VerlofRij =>
  ({ id, userId, startDate, endDate, type, status, createdAt: '2026-06-01T08:00:00Z', ...rest });

const LEAVE: VerlofRij[] = [
  // ma 10 t/m zo 16/08: ma-vr = 5; za 15/08 is een feestdag, zondag telt nooit.
  // Aangevraagd op 30/06 om 22:30 UTC = 01/07 in België.
  rij('a1', '10', '2026-08-10', '2026-08-16', 'betaald_verlof', 'approved', { createdAt: '2026-06-30T22:30:00Z', decidedAt: '2026-07-02T08:00:00Z' }),
  rij('a2', '14', '2026-08-12', '2026-08-13', 'betaald_verlof', 'approved', { decidedAt: '2026-06-03T08:00:00Z' }),
  rij('a3', '13', '2026-08-12', '2026-08-14', 'betaald_verlof', 'approved'),
  rij('a4', '11', '2026-08-13', '2026-08-13', 'klein_verlet', 'approved'),
  rij('a5', '12', '2026-08-13', '2026-08-13', 'betaald_verlof', 'approved'),
  // vr 28/08 t/m wo 02/09 over de maandgrens: vr, za, (zo), ma, di, wo = 5. Nog niet beslist.
  rij('a6', '10', '2026-08-28', '2026-09-02', 'betaald_verlof', 'pending', { decidedAt: '2026-06-09T08:00:00Z' }),
  rij('a7', '14', '2026-09-01', '2026-09-01', 'klein_verlet', 'rejected', { comment: ' Verhuis ', decidedAt: '2026-06-04T08:00:00Z' }),
  // Verwijderd account; ma 20 t/m wo 22/07 met de nationale feestdag ertussen = 2.
  rij('a8', '999', '2026-07-20', '2026-07-22', 'betaald_verlof', 'cancelled'),
  // Een type dat het portaal niet meer kent (één oude rij in productie heet 'vakantie').
  rij('a9', '14', '2026-05-18', '2026-05-22', 'vakantie', 'approved'),
  // Over de jaargrens: di-do = 3 in 2026; in 2027 valt nieuwjaar weg, za 02/01 telt, zo niet = 1.
  rij('a10', '10', '2026-12-29', '2027-01-03', 'betaald_verlof', 'approved'),
  // Ziekte staat in dezelfde tabel en hoort in geen enkel verlofrapport.
  rij('z1', '10', '2026-08-12', '2026-08-12', 'ziekte', 'approved'),
];

const GEEN_EXTRA: ReadonlySet<string> = new Set();
const AUGUSTUS = { van: '2026-08-01', tot: '2026-08-31' };
const alle = { type: 'alle', status: 'alle' };

describe('Verlofaanvragen (vaste cijfers)', () => {
  const def = rapportVan('verlofaanvragen')!;
  const bron = { users: USERS, leave: LEAVE, extraFeestdagen: GEEN_EXTRA };

  it('augustus: elke aanvraag die de periode raakt, zonder ziekte', () => {
    const { rijen, bereik } = bouwVerlofaanvragen(bron, { ...AUGUSTUS, keuzes: alle });
    expect(rijen).toEqual([
      { id: 'a1', naam: 'Bert Buschauffeur', type: 'Betaald verlof', van: '2026-08-10', tot: '2026-08-16', dagen: 5, status: 'Goedgekeurd', aangevraagdOp: '2026-07-01', beslistOp: '2026-07-02', opmerking: null },
      { id: 'a2', naam: 'Dirk Deeltijds', type: 'Betaald verlof', van: '2026-08-12', tot: '2026-08-13', dagen: 2, status: 'Goedgekeurd', aangevraagdOp: '2026-06-01', beslistOp: '2026-06-03', opmerking: null },
      { id: 'a3', naam: 'Fien Flexi', type: 'Betaald verlof', van: '2026-08-12', tot: '2026-08-14', dagen: 3, status: 'Goedgekeurd', aangevraagdOp: '2026-06-01', beslistOp: null, opmerking: null },
      { id: 'a4', naam: 'Tom Technieker', type: 'Klein verlet', van: '2026-08-13', tot: '2026-08-13', dagen: 1, status: 'Goedgekeurd', aangevraagdOp: '2026-06-01', beslistOp: null, opmerking: null },
      { id: 'a5', naam: 'Carla Vertrokken (uit dienst)', type: 'Betaald verlof', van: '2026-08-13', tot: '2026-08-13', dagen: 1, status: 'Goedgekeurd', aangevraagdOp: '2026-06-01', beslistOp: null, opmerking: null },
      // Overlap telt: begint in augustus, loopt door in september. In behandeling = nog niet beslist.
      { id: 'a6', naam: 'Bert Buschauffeur', type: 'Betaald verlof', van: '2026-08-28', tot: '2026-09-02', dagen: 5, status: 'In behandeling', aangevraagdOp: '2026-06-01', beslistOp: null, opmerking: null },
    ]);
    expect(berekenTotalen(def, rijen)).toEqual({ dagen: 17 });
    expect(bereik).toEqual({ van: '2026-05-18', tot: '2027-01-03' });
  });

  it('periodegrenzen: de eerste en de laatste dag van een aanvraag tellen als overlap', () => {
    const ids = (van: string, tot: string) => bouwVerlofaanvragen(bron, { van, tot, keuzes: alle }).rijen.map((r) => r.id);
    expect(ids('2026-09-02', '2026-09-30')).toEqual(['a6']);
    expect(ids('2026-09-03', '2026-09-30')).toEqual([]);
    expect(ids('2026-08-01', '2026-08-10')).toEqual(['a1']);
    expect(ids('2026-08-01', '2026-08-09')).toEqual([]);
  });

  it('filters op medewerker, type en status; een verwijderd account en een onbekend type blijven staan', () => {
    const jaar = { van: '2026-01-01', tot: '2026-12-31' };
    const ids = (f: { chauffeur?: string; type?: string; status?: string }) =>
      bouwVerlofaanvragen(bron, { ...jaar, chauffeur: f.chauffeur, keuzes: { type: f.type ?? 'alle', status: f.status ?? 'alle' } }).rijen.map((r) => r.id);
    expect(ids({ chauffeur: '10' })).toEqual(['a1', 'a6', 'a10']);
    expect(ids({ type: 'klein_verlet' })).toEqual(['a4', 'a7']);
    expect(ids({ status: 'pending' })).toEqual(['a6']);
    expect(ids({ status: 'rejected', type: 'klein_verlet' })).toEqual(['a7']);
    expect(ids({ status: 'cancelled' })).toEqual(['a8']);
    expect(ids({ type: 'klein_verlet', status: 'cancelled' })).toEqual([]);

    const rijen = bouwVerlofaanvragen(bron, { ...jaar, keuzes: alle }).rijen;
    expect(rijen.find((r) => r.id === 'a8')).toMatchObject({ naam: 'Onbekend (999)', dagen: 2, status: 'Geannuleerd' });
    expect(rijen.find((r) => r.id === 'a9')).toMatchObject({ type: 'vakantie', dagen: 5 });
    expect(rijen.find((r) => r.id === 'a7')).toMatchObject({ status: 'Afgewezen', opmerking: 'Verhuis', beslistOp: '2026-06-04' });
  });

  it('een extra vrije dag van de beheerder telt niet als verlofdag', () => {
    const { rijen } = bouwVerlofaanvragen({ ...bron, extraFeestdagen: new Set(['2026-08-12']) }, { ...AUGUSTUS, keuzes: alle });
    expect(rijen.map((r) => [r.id, r.dagen])).toEqual([['a1', 4], ['a2', 1], ['a3', 2], ['a4', 1], ['a5', 1], ['a6', 5]]);
  });

  it('lege periode binnen het bereik, en een periode vóór de eerste gegevens', () => {
    const juni = { van: '2026-06-01', tot: '2026-06-30' };
    const leeg = bouwVerlofaanvragen(bron, { ...juni, keuzes: alle });
    expect(leeg.rijen).toEqual([]);
    expect(bereikToestand(juni, leeg.bereik)).toBe('binnen');
    const vroeger = { van: '2025-01-01', tot: '2025-12-31' };
    expect(bereikToestand(vroeger, bouwVerlofaanvragen(bron, { ...vroeger, keuzes: alle }).bereik)).toBe('buiten');
    expect(bouwVerlofaanvragen({ ...bron, leave: LEAVE.filter((l) => l.type === 'ziekte') }, { ...juni, keuzes: alle })).toEqual({ rijen: [], bereik: null });
  });

  it('de keuzelijsten bieden "alle" plus elk type en elke status', () => {
    const keuzes = def.filters.flatMap((f) => (f.soort === 'keuze' ? [[f.id, f.opties.map((o) => o.waarde)]] : []));
    expect(keuzes).toEqual([
      ['type', ['alle', 'betaald_verlof', 'klein_verlet']],
      ['status', ['alle', 'approved', 'pending', 'rejected', 'cancelled']],
    ]);
  });
});

describe('Verlofbezetting per dag (vaste cijfers)', () => {
  // Standaard 2, maar vanaf 14/08 maar 1 (een uitzonderingsperiode zoals in de instellingen).
  const limieten = parseVerlofLimieten({ standaard: 2, periodes: [{ id: 'p1', naam: 'Krap', van: '2026-08-14', tot: '2026-08-31', max: 1 }] });
  const bron = { users: USERS, leave: LEAVE, limietVoor: (dag: string) => limietVoorDag(limieten, dag) };
  const WEEK = { van: '2026-08-10', tot: '2026-08-16' };

  it('één rij per dag; een flexi en een technieker staan bij de namen maar tellen niet in de limiet', () => {
    const { rijen, bereik } = bouwVerlofbezetting(bron, { ...WEEK, keuzes: {}, vinkjes: { bovenLimiet: false } });
    expect(rijen).toEqual([
      { id: '2026-08-10', datum: '2026-08-10', dag: 'ma', afwezig: 1, limiet: 2, bovenLimiet: false, namen: 'Bert Buschauffeur' },
      { id: '2026-08-11', datum: '2026-08-11', dag: 'di', afwezig: 1, limiet: 2, bovenLimiet: false, namen: 'Bert Buschauffeur' },
      // Precies op de limiet is niet erboven; de ziekmelding van Bert telt nergens.
      { id: '2026-08-12', datum: '2026-08-12', dag: 'wo', afwezig: 2, limiet: 2, bovenLimiet: false, namen: 'Bert Buschauffeur, Dirk Deeltijds, Fien Flexi (flexi, telt niet mee)' },
      { id: '2026-08-13', datum: '2026-08-13', dag: 'do', afwezig: 3, limiet: 2, bovenLimiet: true, namen: 'Bert Buschauffeur, Carla Vertrokken (uit dienst), Dirk Deeltijds, Fien Flexi (flexi, telt niet mee), Tom Technieker (technieker, telt niet mee)' },
      { id: '2026-08-14', datum: '2026-08-14', dag: 'vr', afwezig: 1, limiet: 1, bovenLimiet: false, namen: 'Bert Buschauffeur, Fien Flexi (flexi, telt niet mee)' },
      // Feestdag en zondag binnen een aanvraag tellen in de bezetting, zoals in de verlofkalender.
      { id: '2026-08-15', datum: '2026-08-15', dag: 'za', afwezig: 1, limiet: 1, bovenLimiet: false, namen: 'Bert Buschauffeur' },
      { id: '2026-08-16', datum: '2026-08-16', dag: 'zo', afwezig: 1, limiet: 1, bovenLimiet: false, namen: 'Bert Buschauffeur' },
    ]);
    expect(bereik).toEqual({ van: '2026-05-18', tot: '2027-01-03' });
  });

  it('het vinkje "alleen boven de limiet" houdt alleen de overschrijdingen over', () => {
    const { rijen } = bouwVerlofbezetting(bron, { ...WEEK, keuzes: {}, vinkjes: { bovenLimiet: true } });
    expect(rijen.map((r) => r.datum)).toEqual(['2026-08-13']);
  });

  it('wachtend, afgewezen en geannuleerd verlof bezet niets; een dag zonder verlof is een rij met 0', () => {
    const { rijen } = bouwVerlofbezetting(bron, { van: '2026-08-28', tot: '2026-09-01', keuzes: {} });
    expect(rijen.map((r) => [r.datum, r.afwezig, r.namen])).toEqual([
      ['2026-08-28', 0, null], ['2026-08-29', 0, null], ['2026-08-30', 0, null], ['2026-08-31', 0, null], ['2026-09-01', 0, null],
    ]);
  });

  it('telt exact zoals GET /api/leave/bezetting (dezelfde kern), ook over de zomertijdgrens', () => {
    const dagen = bezettingPerDag({ leave: LEAVE, users: USERS, van: '2026-08-12', tot: '2026-08-13', limietVoor: bron.limietVoor });
    expect(dagen.map(({ datum, aantal, limiet }) => ({ datum, aantal, limiet }))).toEqual([
      { datum: '2026-08-12', aantal: 2, limiet: 2 },
      { datum: '2026-08-13', aantal: 3, limiet: 2 },
    ]);
    // 28/03 t/m 30/03/2026: drie dagen, ook al is 29/03 in Brussel maar 23 uur lang.
    expect(bezettingPerDag({ leave: [], users: [], van: '2026-03-28', tot: '2026-03-30', limietVoor: () => 2 }).map((d) => d.datum)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    // 25/10 duurt 25 uur.
    expect(bezettingPerDag({ leave: [], users: [], van: '2026-10-24', tot: '2026-10-26', limietVoor: () => 2 })).toHaveLength(3);
  });

  it('de weekdag sorteert op de datum', () => {
    expect(rapportVan('verlofbezetting')!.kolommen.find((k) => k.id === 'dag')).toMatchObject({ sorteerOp: 'datum' });
  });
});

describe('Verlof per type per maand (vaste cijfers)', () => {
  const def = rapportVan('verlof-per-type')!;
  const bron = { leave: LEAVE, extraFeestdagen: GEEN_EXTRA };

  it('2026: één kolom per type dat voorkomt (bekende types eerst), twaalf maanden en een totaalrij', () => {
    const { rijen, kolommen, bereik } = bouwVerlofPerType(bron, { jaar: 2026, keuzes: {} });
    expect(kolommen?.map((k) => [k.id, k.titel, k.kort])).toEqual([
      ['maand', 'Maand', undefined],
      ['type_betaald_verlof', 'Betaald verlof', 'Betaald'],
      ['type_klein_verlet', 'Klein verlet', 'Kl. verlet'],
      ['type_vakantie', 'vakantie', undefined],
      ['totaal', 'Totaal', undefined],
    ]);
    const gevuld = rijen.filter((r) => r.totaal !== 0);
    expect(rijen).toHaveLength(12);
    expect(gevuld).toEqual([
      { id: '2026-05', maand: 'Mei', maandSleutel: '2026-05', type_betaald_verlof: 0, type_klein_verlet: 0, type_vakantie: 5, totaal: 5 },
      // Bert 5 + Dirk 2 + Fien 3 + Carla 1; de aanvraag in behandeling (28/08) telt niet.
      { id: '2026-08', maand: 'Augustus', maandSleutel: '2026-08', type_betaald_verlof: 11, type_klein_verlet: 1, type_vakantie: 0, totaal: 12 },
      { id: '2026-12', maand: 'December', maandSleutel: '2026-12', type_betaald_verlof: 3, type_klein_verlet: 0, type_vakantie: 0, totaal: 3 },
    ]);
    expect(berekenTotalen(metKolommen(def, kolommen), rijen)).toEqual({ type_betaald_verlof: 14, type_klein_verlet: 1, type_vakantie: 5, totaal: 20 });
    expect(bereik).toEqual({ van: '2026-05-18', tot: '2027-01-03' });
  });

  it('de som van de maanden is wat Verlofsaldo "Opgenomen" noemt', () => {
    const { rijen, kolommen } = bouwVerlofPerType(bron, { jaar: 2026, keuzes: {} });
    const opgenomen = USERS.reduce((som, u) => som + verlofBalans(LEAVE, u.id, 2026, undefined, GEEN_EXTRA).betaaldGebruikt, 0);
    expect(opgenomen).toBe(14);
    expect(berekenTotalen(metKolommen(def, kolommen), rijen).type_betaald_verlof).toBe(opgenomen);
  });

  it('een aanvraag over de jaargrens telt in elk jaar haar eigen dagen; 2027 kent maar één type', () => {
    const { rijen, kolommen } = bouwVerlofPerType(bron, { jaar: 2027, keuzes: {} });
    expect(kolommen?.map((k) => k.id)).toEqual(['maand', 'type_betaald_verlof', 'totaal']);
    expect(rijen[0]).toEqual({ id: '2027-01', maand: 'Januari', maandSleutel: '2027-01', type_betaald_verlof: 1, totaal: 1 });
    expect(rijen.slice(1).every((r) => r.totaal === 0)).toBe(true);
  });

  it('een jaar zonder verlof: alleen de vaste kolommen, en het bereik zegt "buiten"', () => {
    const { rijen, kolommen, bereik } = bouwVerlofPerType(bron, { jaar: 2024, keuzes: {} });
    expect(kolommen?.map((k) => k.id)).toEqual(['maand', 'totaal']);
    expect(rijen.every((r) => r.totaal === 0)).toBe(true);
    expect(bereikToestand({ van: '2024-01-01', tot: '2024-12-31' }, bereik)).toBe('buiten');
  });

  it('de meegeleverde kolommen sturen de sortering en de CSV', () => {
    const { rijen, kolommen } = bouwVerlofPerType(bron, { jaar: 2026, keuzes: {} });
    const eff = metKolommen(def, kolommen);
    // Maand sorteert op '2026-01' … '2026-12', niet alfabetisch (April, Augustus, …).
    expect(sorteerRijen(eff, rijen, 'maand', 'asc').map((r) => r.maand).slice(0, 3)).toEqual(['Januari', 'Februari', 'Maart']);
    expect(sorteerRijen(eff, rijen, 'maand', 'desc')[0].maand).toBe('December');
    expect(sorteerRijen(eff, rijen, 'type_betaald_verlof', 'desc')[0].maand).toBe('Augustus');
    const csv = csvRijen(eff, rijen, berekenTotalen(eff, rijen));
    expect(csv[0]).toEqual(['Maand', 'Betaald verlof', 'Klein verlet', 'vakantie', 'Totaal']);
    expect(csv[csv.length - 1]).toEqual(['Totaal', '14', '1', '5', '20']);
    // Zonder meegeleverde kolommen is het gewoon de definitie zelf.
    expect(metKolommen(def, undefined)).toBe(def);
    expect(metKolommen(def, [])).toBe(def);
  });
});

describe('gedeelde stukken', () => {
  it('een tijdstip wordt de kalenderdag in België, welke tijdzone de server ook heeft', () => {
    expect(dagVanTijdstip('2026-06-30T22:30:00Z')).toBe('2026-07-01'); // zomertijd, +2
    expect(dagVanTijdstip('2026-12-31T23:30:00.000Z')).toBe('2027-01-01'); // wintertijd, +1
    expect(dagVanTijdstip('2026-12-31T22:30:00+00:00')).toBe('2026-12-31');
    // Zonder zone is het al een kalenderdag.
    expect(dagVanTijdstip('2026-09-17T23:59:00')).toBe('2026-09-17');
    expect(dagVanTijdstip('2026-09-17')).toBe('2026-09-17');
    expect(dagVanTijdstip('rommel')).toBeNull();
    expect(dagVanTijdstip(undefined)).toBeNull();
  });

  it('weekdag op de cijfers van de datum', () => {
    expect(['2026-08-10', '2026-08-15', '2026-08-16', '2026-03-29'].map(weekdagKort)).toEqual(['ma', 'za', 'zo', 'zo']);
  });

  it('de labels lopen gelijk met de rest van het portaal', async () => {
    const { LEAVE_TYPE_LABEL } = await import('../api/helpers');
    expect({ ...VERLOF_TYPE_LABEL, ziekte: 'Ziekte' }).toEqual(LEAVE_TYPE_LABEL);
    expect(VERLOF_STATUS_LABEL).toEqual({ approved: 'Goedgekeurd', pending: 'In behandeling', rejected: 'Afgewezen', cancelled: 'Geannuleerd' });
  });
});
