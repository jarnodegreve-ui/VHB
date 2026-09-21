// Rapporten stap 3 (21-09): vaste antwoorden van GET /api/rapporten/<id> voor
// één voertuigrapport en één personeelsrapport, plus twee rapporten waarvan de
// tabel vandaag leeg is. Vaste cijfers en een vaste peildatum, zodat de
// e2e-spec en de visuele regressie stabiel blijven. De rekenkern zelf is
// getest in src/rapportVoertuigen.test.ts en src/rapportPersoneel.test.ts;
// hier staat alleen wat het scherm nodig heeft.

const PEILDATUM = '2026-09-21';
const GEGENEREERD = '2026-09-21T08:30:00.000Z';

// id, busnr, nummerplaat, merk, type, aandrijving, categorie, zitplaatsen, in dienst, leeftijd, status
const WAGENPARK = [
  ['v23', '013 023', '1-VPZ-070', 'MAN', 'Lijnbus', 'Diesel', 'Bus', 50, '2019-01-23', 7.7, 'Actief'],
  ['v26', '613 026', '2-CWF-068', "MAN LION'S CITY 12E", 'Lijnbus', 'Elektrisch', 'Bus', 40, '2022-12-20', 3.8, 'Actief'],
  ['v27', '613 027', '2-DKM-415', "MAN LION'S CITY 18E", 'Lijnbus', 'Elektrisch', 'Bus', 50, '2023-08-01', 3.1, 'Actief'],
  ['v40', '613 040', '2-HBA-112', 'VDL', 'Lijnbus', 'Elektrisch', 'Bus', 54, '2025-04-18', 1.4, 'Actief'],
  ['v98', 'Reserve 98', '1-XYZ-098', 'VDL', 'Lijnbus', 'Diesel', 'Bus', null, '2023-08-29', 3.1, 'Reserve'],
  ['v401', 'EEK001', '2-EEK-001', 'Feniksbus Iveco 70C18', 'Schoolbus', 'Diesel', 'Bus', 38, '2023-02-14', 3.6, 'Actief'],
  ['v5', 'Jumpy', '1-JMP-005', 'Citroën', 'Privévoertuig', 'Ander', 'Privéwagen', null, '2009-04-06', 17.5, 'Actief'],
  ['v0', 'Oud 01', '1-OUD-001', 'MAN', 'Lijnbus', 'Diesel', 'Bus', 45, '2005-01-03', 21.7, 'Uit dienst'],
];
const STATUS_WAARDE = { Actief: 'actief', Reserve: 'reserve', 'Uit dienst': 'uit_dienst' };
const CATEGORIE_WAARDE = { Bus: 'bus', Bedrijfswagen: 'bedrijfswagen', Privéwagen: 'privewagen' };
const AANDRIJVING_WAARDE = { Elektrisch: 'elektrisch', Diesel: 'diesel', Hybride: 'hybride', Ander: 'ander' };

const wagenparkOverzicht = (q) => {
  const status = q.get('status') || 'in_dienst';
  const categorie = q.get('categorie') || 'alle';
  const aandrijving = q.get('aandrijving') || 'alle';
  const rijen = WAGENPARK
    .map(([id, busnr, nummerplaat, merk, type, aandr, cat, zitplaatsen, inDienst, leeftijd, st]) => ({ id, busnr, nummerplaat, merk, type, aandrijving: aandr, categorie: cat, zitplaatsen, inDienst, leeftijd, status: st }))
    .filter((r) => (status === 'in_dienst' ? r.status !== 'Uit dienst' : status === 'alle' || STATUS_WAARDE[r.status] === status))
    .filter((r) => categorie === 'alle' || CATEGORIE_WAARDE[r.categorie] === categorie)
    .filter((r) => aandrijving === 'alle' || AANDRIJVING_WAARDE[r.aandrijving] === aandrijving);
  const leeftijden = rijen.map((r) => r.leeftijd);
  return {
    rijen,
    totalen: {
      zitplaatsen: rijen.reduce((n, r) => n + (r.zitplaatsen ?? 0), 0),
      ...(leeftijden.length ? { leeftijd: leeftijden.reduce((n, l) => n + l, 0) / leeftijden.length } : {}),
    },
    bereik: { van: '2005-01-03', tot: PEILDATUM },
    peildatum: PEILDATUM,
    gegenereerdOp: GEGENEREERD,
  };
};

// id, naam, personeelsnr, geldig tot, resterende dagen, status, bijgewerkt op
const MEDISCH = [
  ['60', 'Annelies Verstraete', 'VHB-000060', '2026-09-14', -7, 'Vervallen', '2021-09-14'],
  ['43', 'Alex Du Priez', 'VHB-000043', '2026-09-24', 3, 'Binnenkort', '2021-09-24'],
  ['61', 'Bart Claeys', 'VHB-000061', '2026-11-30', 70, 'Binnenkort', '2025-12-01'],
  ['44', 'Diether Van Haute', 'VHB-000044', '2027-05-02', 223, 'In orde', '2026-05-04'],
  ['42', 'Test Chauffeur', 'VHB-000042', '2031-06-14', 1727, 'In orde', '2026-06-15'],
  ['62', 'Carine De Smet', 'VHB-000062', null, null, 'Geen datum', null],
];

const medischeSchiftingen = (q) => {
  const termijn = q.get('termijn') || 'alles';
  const chauffeur = q.get('chauffeur') || '';
  const rijen = MEDISCH
    .map(([id, naam, personeelsnr, geldigTot, resterend, status, bijgewerktOp]) => ({ id, naam, personeelsnr, geldigTot, resterend, status, bijgewerktOp }))
    .filter((r) => !chauffeur || r.id === chauffeur)
    .filter((r) => termijn === 'alles' || r.resterend === null || r.resterend <= Number(termijn));
  return { rijen, totalen: {}, bereik: { van: '2026-09-14', tot: '2031-06-14' }, peildatum: PEILDATUM, gegenereerdOp: GEGENEREERD };
};

/** Een tabel die vandaag leeg is: geen rijen en geen bereik ("nog niets geregistreerd"). */
const legeBron = (metPeildatum) => ({ rijen: [], totalen: {}, bereik: null, ...(metPeildatum ? { peildatum: PEILDATUM } : {}), gegenereerdOp: GEGENEREERD });

/** Het antwoord voor dit rapport, of null als dit bestand het niet kent (dan zoekt audit-fixtures verder). */
export function rapportFixture(id, query) {
  switch (id) {
    case 'wagenpark-overzicht': return wagenparkOverzicht(query);
    case 'medische-schiftingen': return medischeSchiftingen(query);
    case 'vervaldata-voertuigen': return legeBron(true);
    case 'uitgevoerde-werken': return legeBron(false);
    default: return null;
  }
}
