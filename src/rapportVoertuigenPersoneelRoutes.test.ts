// @vitest-environment node
/**
 * De rapporten van voertuigen en personeel door de échte route: de echte
 * `requireRole`, de echte zod-filters uit de definitie en de echte laders, met
 * alleen de opslag vervangen door vaste gegevens. Bewaakt de rolafscherming
 * (alleen planner en admin), de filtervalidatie (onbekende keuze = 400, en de
 * lader wordt dan niet aangeroepen), de peildatum in het antwoord, en dat een
 * lege tabel een eerlijk `bereik: null` geeft.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const gelezen = { medewerkers: 0, voertuigen: 0 };

vi.mock('../api/middleware.js', async (origineel) => {
  const echt = await origineel<typeof import('../api/middleware')>();
  return {
    ...echt,
    // Alleen wie aangemeld is wisselt: de rol komt uit een header, de rolcontrole zelf is de echte.
    authenticate: (req: express.Request & { appUser?: unknown }, _res: express.Response, next: express.NextFunction) => {
      const rol = req.header('x-test-rol');
      if (rol) req.appUser = { id: '1', name: 'Test', role: rol };
      next();
    },
  };
});
vi.mock('../api/storage.js', async (origineel) => ({
  ...(await origineel<typeof import('../api/storage')>()),
  getUserExpiries: async () => [
    { userId: '10', soort: 'medische_schifting', validUntil: '2020-01-01', updatedAt: null, updatedBy: null },
  ],
}));
vi.mock('../api/_lib/rapporten/personeelBron.js', () => ({
  getRapportMedewerkers: async () => {
    gelezen.medewerkers += 1;
    return [
      { id: '10', name: 'Bert Buschauffeur', role: 'chauffeur', employeeId: 'VHB-10', section: 'Reguliere', startDate: '2019-01-23', isActive: true, showInContacts: true },
      { id: '11', name: 'Dirk Nacht', role: 'chauffeur', employeeId: 'VHB-11', section: 'Nacht', isActive: true, showInContacts: false },
      { id: '1', name: 'Annelies Admin', role: 'admin', isActive: true, showInContacts: true },
    ];
  },
}));
vi.mock('../api/_lib/techniekStorage.js', () => ({
  getVehicles: async () => {
    gelezen.voertuigen += 1;
    return [
      { id: 'v1', busnr: '013 023', kortNr: 23, nummerplaat: '1-VPZ-070', merk: 'MAN', type: 'lijnbus', categorie: 'bus', aandrijving: 'diesel', status: 'actief', inDienst: '2019-01-23', zitplaatsen: 50 },
      { id: 'v6', busnr: 'Oud 01', kortNr: null, merk: 'MAN', type: 'lijnbus', categorie: 'bus', aandrijving: 'diesel', status: 'uit_dienst', inDienst: '2005-01-01', zitplaatsen: 45 },
    ];
  },
  getVehicleExpiries: async () => [],
  getDefecten: async () => [],
  getWerkprestaties: async () => [],
}));

let server: Server;
let basis = '';

beforeAll(async () => {
  const { mountRapportRoutes } = await import('../api/_lib/rapportRoutes');
  const app = express();
  mountRapportRoutes(app);
  await new Promise<void>((klaar) => { server = app.listen(0, '127.0.0.1', () => klaar()); });
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((klaar) => server.close(() => klaar()));
});

const haal = async (pad: string, rol?: string) => {
  const res = await fetch(`${basis}${pad}`, { headers: rol ? { 'x-test-rol': rol } : {} });
  return { status: res.status, json: await res.json() };
};

const ALLE = [
  'wagenpark-overzicht', 'wagenpark-leeftijd', 'wagenpark-technisch', 'wagenpark-samenvatting', 'vervaldata-voertuigen',
  'contactlijst', 'actieve-medewerkers', 'medische-schiftingen', 'vakbekwaamheden',
];
const MET_PERIODE = ['defecten', 'uitgevoerde-werken'];
const PERIODE = '?van=2026-09-01&tot=2026-09-30';

describe('rolafscherming: alleen planner en admin', () => {
  it('zonder sessie 401, chauffeur en technieker 403, en de bron wordt niet gelezen', async () => {
    gelezen.medewerkers = 0;
    gelezen.voertuigen = 0;
    for (const id of [...ALLE, ...MET_PERIODE]) {
      const q = MET_PERIODE.includes(id) ? PERIODE : '';
      expect((await haal(`/api/rapporten/${id}${q}`)).status, id).toBe(401);
      expect((await haal(`/api/rapporten/${id}${q}`, 'chauffeur')).status, id).toBe(403);
      expect((await haal(`/api/rapporten/${id}${q}`, 'technieker')).status, id).toBe(403);
    }
    expect(gelezen).toEqual({ medewerkers: 0, voertuigen: 0 });
  });

  it('planner en admin krijgen elk rapport', async () => {
    for (const id of [...ALLE, ...MET_PERIODE]) {
      const q = MET_PERIODE.includes(id) ? PERIODE : '';
      expect((await haal(`/api/rapporten/${id}${q}`, 'planner')).status, id).toBe(200);
      expect((await haal(`/api/rapporten/${id}${q}`, 'admin')).status, id).toBe(200);
    }
  });
});

describe('filtervalidatie', () => {
  it('een onbekende keuze is 400 met de fout bij het veld, en bereikt de lader niet', async () => {
    gelezen.voertuigen = 0;
    gelezen.medewerkers = 0;
    const res = await haal('/api/rapporten/wagenpark-overzicht?status=gesloopt', 'planner');
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'Ongeldige invoer', veldfouten: { status: 'Ongeldige keuze' } });
    expect((await haal('/api/rapporten/medische-schiftingen?termijn=45', 'planner')).json.veldfouten).toEqual({ termijn: 'Ongeldige keuze' });
    expect((await haal('/api/rapporten/contactlijst?rol=directeur', 'admin')).status).toBe(400);
    expect((await haal('/api/rapporten/wagenpark-leeftijd?groep=kleur', 'admin')).status).toBe(400);
    expect((await haal('/api/rapporten/defecten?van=2026-09-01&tot=2026-09-30&werktype=X', 'admin')).status).toBe(400);
    expect(gelezen).toEqual({ medewerkers: 0, voertuigen: 0 });
  });

  it('een rapport met een periode eist ze, ook hier hooguit 366 dagen', async () => {
    expect((await haal('/api/rapporten/defecten', 'planner')).status).toBe(400);
    expect((await haal('/api/rapporten/uitgevoerde-werken?van=2025-01-01&tot=2026-09-30', 'planner')).json.veldfouten).toEqual({ tot: 'Kies een periode van hoogstens 366 dagen' });
  });
});

describe('antwoord', () => {
  it('wagenpark: uit dienst standaard weg, totalen van de route, en de peildatum van de server', async () => {
    const res = await haal('/api/rapporten/wagenpark-overzicht', 'planner');
    expect(res.json.rijen.map((r: { busnr: string }) => r.busnr)).toEqual(['013 023']);
    expect(res.json.totalen.zitplaatsen).toBe(50);
    expect(res.json.peildatum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await haal('/api/rapporten/wagenpark-overzicht?status=alle', 'planner')).json.rijen).toHaveLength(2);
    // Technische gegevens rekent niet tegenover vandaag: geen peildatum.
    expect((await haal('/api/rapporten/wagenpark-technisch', 'planner')).json.peildatum).toBeUndefined();
  });

  it('lege tabellen (vervaldata voertuigen, gele boek, werken): bereik null, geen verzonnen rijen', async () => {
    for (const pad of ['/api/rapporten/vervaldata-voertuigen', `/api/rapporten/defecten${PERIODE}`, `/api/rapporten/uitgevoerde-werken${PERIODE}`]) {
      const res = await haal(pad, 'admin');
      expect(res.json.rijen, pad).toEqual([]);
      expect(res.json.bereik, pad).toBeNull();
    }
  });

  it('medische schiftingen en vakbekwaamheden delen één lader met een vaste soort', async () => {
    const medisch = await haal('/api/rapporten/medische-schiftingen', 'planner');
    expect(medisch.json.rijen.map((r: { naam: string; status: string }) => [r.naam, r.status])).toEqual([['Bert Buschauffeur', 'Vervallen'], ['Dirk Nacht', 'Geen datum']]);
    expect(medisch.json.bereik).toEqual({ van: '2020-01-01', tot: '2020-01-01' });
    // Van code 95 staat er nog niets: een lege bron, ook al zijn er chauffeurs.
    const code95 = await haal('/api/rapporten/vakbekwaamheden', 'planner');
    expect(code95.json.bereik).toBeNull();
  });

  it('contactlijst: iedereen die actief is, met de markering van de gedeelde lijst', async () => {
    const res = await haal('/api/rapporten/contactlijst?rol=chauffeur', 'admin');
    expect(res.json.rijen.map((r: { naam: string; gedeeld: boolean }) => [r.naam, r.gedeeld])).toEqual([['Bert Buschauffeur', true], ['Dirk Nacht', false]]);
  });
});
