// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BEKEKEN_BIJGEHOUDEN_SINDS, RUIL_BEKEKEN_ACTIE, RUIL_LOG_ACTIES, persoonsVerloop, verloopUitLog, type RuilLogRegel, type RuilVoorVerloop, type VerloopRegel } from './ruilVerloop';
import { HANDMATIGE_WISSEL_PREFIX } from './schemas/constanten';

// Zone-loze momenten: de afleiding geeft de strings door en sorteert ze als
// tekst. Ze rekent op één plek met een datum (is de ruil aangevraagd nadat
// "bekeken" werd bijgehouden), en die testmomenten liggen dagen van de grens.
// De uitkomst is dus dezelfde onder TZ=Europe/Brussels en TZ=UTC.
const T = {
  aangevraagd: '2026-09-10T08:00:00',
  geaccepteerd: '2026-09-10T09:30:00',
  beslist: '2026-09-11T07:15:00',
  afgehandeld: '2026-09-12T16:45:00',
  bevestigd: '2026-09-11T12:02:00',
};

const regel = (action: string, createdAt: string, actorRole: string | null, details = '', actorName = 'Naam'): RuilLogRegel =>
  ({ action, createdAt, actorRole, actorName, details });

const aangevraagd = regel('Dienstruil aangevraagd', T.aangevraagd, 'chauffeur', 'Sofie bood een dienst aan voor ruil.', 'Sofie Aanvrager');
const geaccepteerd = regel('Dienstruil geaccepteerd', T.geaccepteerd, 'chauffeur', 'Sofie, dienstruil (pending → accepted).', 'Pieter Collega');
const overgang = (action: string, van: string, naar: string, rol: string | null, op = T.beslist, naam = 'Jarno Planner') =>
  regel(action, op, rol, `Sofie, dienstruil (${van} → ${naar}). dienst 2101 op 14/09/2026: 1 rij(en) doorgevoerd`, naam);

const ruil = (over: Partial<RuilVoorVerloop> = {}, log: RuilLogRegel[] | null = [aangevraagd], staf = true): RuilVoorVerloop => ({
  status: 'pending',
  requesterId: 'u-sofie',
  targetDriverId: 'u-pieter',
  createdAt: T.aangevraagd,
  swapType: 'ruil',
  shiftDate: '2026-09-14',
  shiftLine: '2101',
  returnDate: '2026-09-16',
  returnCode: '2202',
  ...(log ? { verloop: verloopUitLog(log, { metStafNaam: staf }) } : {}),
  ...over,
});

const per = (regels: VerloopRegel[]) => Object.fromEntries(regels.map((r) => [r.rol, r])) as Record<VerloopRegel['rol'], VerloopRegel>;

describe('verloopUitLog', () => {
  it('kent elke log-actie die de server voor een ruil schrijft', () => {
    // De ruilroutes wonen sinds 21-09 in api/_lib/ruilRoutes.ts (voorheen
    // api/index.ts); de gedeelde ruilregels in ruilRegels.ts.
    const bron = ['../api/_lib/ruilRoutes.ts', '../api/_lib/ruilRegels.ts']
      .map((pad) => readFileSync(path.resolve(__dirname, pad), 'utf8'))
      .join('\n');
    for (const actie of Object.keys(RUIL_LOG_ACTIES)) {
      expect(bron, `api/_lib/ruilRoutes.ts logt "${actie}" niet meer`).toContain(`"${actie}"`);
    }
    // En omgekeerd: elke "Dienstruil …"-actie van een statuswissel is gekend.
    const gelogd = [...bron.matchAll(/"(Dienstruil (?:aangevraagd|geaccepteerd|goedgekeurd|afgewezen|geannuleerd|voltooid))"/g)].map((m) => m[1]);
    for (const actie of new Set(gelogd)) expect(RUIL_LOG_ACTIES[actie]).toBeTruthy();
  });

  it('leidt uit de rol af wie weigerde: niet-staf = de collega, staf = de planner', () => {
    const doorCollega = verloopUitLog([overgang('Dienstruil afgewezen', 'pending', 'rejected', 'chauffeur')], { metStafNaam: true });
    expect(doorCollega).toEqual([{ soort: 'geweigerd', op: T.beslist, door: 'collega', van: 'pending' }]);
    for (const rol of ['planner', 'admin']) {
      const [stap] = verloopUitLog([overgang('Dienstruil afgewezen', 'pending', 'rejected', rol)], { metStafNaam: true });
      expect(stap.door).toBe('planner');
      expect(stap.naam).toBe('Jarno Planner');
    }
    // Een technieker is geen staf: als aangezochte collega is hij "de collega".
    expect(verloopUitLog([overgang('Dienstruil afgewezen', 'pending', 'rejected', 'technieker')], { metStafNaam: true })[0].door).toBe('collega');
  });

  it('zonder rol op de logregel: alleen wat de overgang zelf bewijst, nooit een gok', () => {
    const zonderRol = (van: string) => verloopUitLog([overgang('Dienstruil afgewezen', van, 'rejected', null)], { metStafNaam: true })[0].door;
    expect(zonderRol('accepted')).toBe('planner'); // na het akkoord kan alleen de planner nog afwijzen
    expect(zonderRol('pending')).toBeNull();
    const annuleer = (van: string) => verloopUitLog([overgang('Dienstruil geannuleerd', van, 'cancelled', null)], { metStafNaam: true })[0].door;
    expect(annuleer('approved')).toBe('planner');
    expect(annuleer('pending')).toBeNull();
  });

  it('intrekken door een chauffeur = de aanvrager, annuleren door staf = de planner', () => {
    expect(verloopUitLog([overgang('Dienstruil geannuleerd', 'pending', 'cancelled', 'chauffeur')], { metStafNaam: true })[0].door).toBe('aanvrager');
    expect(verloopUitLog([overgang('Dienstruil geannuleerd', 'approved', 'cancelled', 'admin')], { metStafNaam: true })[0].door).toBe('planner');
  });

  it('privacy: een chauffeur krijgt nooit de naam van de planner, en nooit namen van chauffeurs of de vrije logtekst', () => {
    const log = [aangevraagd, geaccepteerd, overgang('Dienstruil goedgekeurd', 'accepted', 'approved', 'admin')];
    const voorChauffeur = verloopUitLog(log, { metStafNaam: false });
    expect(JSON.stringify(voorChauffeur)).not.toMatch(/Jarno|Sofie|Pieter|rij\(en\)/);
    expect(voorChauffeur.every((s) => !('naam' in s))).toBe(true);
    const voorStaf = verloopUitLog(log, { metStafNaam: true });
    expect(voorStaf.find((s) => s.soort === 'goedgekeurd')?.naam).toBe('Jarno Planner');
    // Ook staf krijgt geen chauffeursnamen uit het log: die lopen via het id.
    expect(JSON.stringify(voorStaf)).not.toMatch(/Sofie|Pieter|rij\(en\)/);
  });

  it('sorteert oudste eerst en slaat onbekende acties en regels zonder moment over', () => {
    const stappen = verloopUitLog([
      overgang('Dienstruil goedgekeurd', 'accepted', 'approved', 'admin'),
      regel('Dienstruil verwijderd', T.afgehandeld, 'admin'),
      regel('Dienstruil geaccepteerd', '', 'chauffeur'),
      geaccepteerd,
      aangevraagd,
    ], { metStafNaam: false });
    expect(stappen.map((s) => s.soort)).toEqual(['aangevraagd', 'geaccepteerd', 'goedgekeurd']);
  });
});

describe('persoonsVerloop, 1-op-1 ruil', () => {
  it('wacht op de collega: de collega is aan zet, de planner nog niet', () => {
    const r = per(persoonsVerloop(ruil()));
    expect(r.aanvrager).toMatchObject({ status: 'Aangevraagd', toon: 'neutraal', aanZet: false, op: T.aangevraagd, userId: 'u-sofie' });
    expect(r.collega).toMatchObject({ status: 'Wacht op antwoord', toon: 'neutraal', aanZet: true, userId: 'u-pieter', rolLabel: 'Collega' });
    expect(r.collega.op).toBeUndefined();
    expect(r.planner).toMatchObject({ status: 'Wacht op collega', aanZet: false });
  });

  it('toont wat elk krijgt, één keer per persoon', () => {
    const r = per(persoonsVerloop(ruil()));
    expect(r.aanvrager.krijgt).toEqual({ code: '2202', datum: '2026-09-16' });
    expect(r.collega.krijgt).toEqual({ code: '2101', datum: '2026-09-14' });
    expect(r.planner.krijgt).toBeUndefined();
    expect(per(persoonsVerloop(ruil({ returnCode: 'vrij' }))).aanvrager.krijgt?.code).toBe('vrij');
  });

  it('een ruil die niet doorging belooft niets meer: wat elk kreeg wordt "zou krijgen"', () => {
    for (const status of ['rejected', 'cancelled']) {
      const r = per(persoonsVerloop(ruil({ status }, [])));
      expect(r.aanvrager.krijgt).toMatchObject({ code: '2202', vervallen: true });
      expect(r.collega.krijgt).toMatchObject({ code: '2101', vervallen: true });
    }
    for (const status of ['pending', 'accepted', 'approved', 'completed']) {
      expect(per(persoonsVerloop(ruil({ status }, []))).collega.krijgt?.vervallen).toBeUndefined();
    }
  });

  it('geaccepteerd: moment van het akkoord, de planner is aan zet', () => {
    const r = per(persoonsVerloop(ruil({ status: 'accepted' }, [aangevraagd, geaccepteerd])));
    expect(r.collega).toMatchObject({ status: 'Geaccepteerd', toon: 'succes', aanZet: false, op: T.geaccepteerd });
    expect(r.planner).toMatchObject({ status: 'Te beoordelen', toon: 'neutraal', aanZet: true });
  });

  it('goedgekeurd: moment en (voor staf) de naam van de planner, bevestiging van de collega erbij', () => {
    const log = [aangevraagd, geaccepteerd, overgang('Dienstruil goedgekeurd', 'accepted', 'approved', 'planner')];
    const staf = per(persoonsVerloop(ruil({ status: 'approved', decidedAt: T.beslist }, log, true)));
    expect(staf.planner).toMatchObject({ status: 'Goedgekeurd', toon: 'succes', op: T.beslist, naam: 'Jarno Planner', aanZet: false });
    expect(staf.collega).toMatchObject({ status: 'Geaccepteerd', op: T.geaccepteerd, extra: { label: 'Wissel nog niet bevestigd' } });
    const chauffeur = per(persoonsVerloop(ruil({ status: 'approved', decidedAt: T.beslist, targetSeenAt: T.bevestigd }, log, false)));
    expect(chauffeur.planner.naam).toBeUndefined();
    expect(chauffeur.collega.extra).toEqual({ label: 'Wissel bevestigd', op: T.bevestigd });
  });

  it('rechtstreeks goedgekeurd door een admin: de collega heeft nooit geantwoord, en dat staat er ook', () => {
    const log = [aangevraagd, overgang('Dienstruil goedgekeurd', 'pending', 'approved', 'admin')];
    const r = per(persoonsVerloop(ruil({ status: 'approved', decidedAt: T.beslist }, log)));
    expect(r.collega).toMatchObject({ status: 'Antwoord niet afgewacht', toon: 'neutraal' });
    expect(r.planner.status).toBe('Goedgekeurd');
  });

  it('afgehandeld: de goedkeuring blijft het moment, het afhandelen komt erbij', () => {
    const log = [aangevraagd, geaccepteerd, overgang('Dienstruil goedgekeurd', 'accepted', 'approved', 'admin'), overgang('Dienstruil voltooid', 'approved', 'completed', 'admin', T.afgehandeld)];
    const r = per(persoonsVerloop(ruil({ status: 'completed', decidedAt: T.beslist }, log)));
    expect(r.planner).toMatchObject({ status: 'Goedgekeurd', op: T.beslist, extra: { label: 'Afgehandeld', op: T.afgehandeld } });
    expect(r.collega.extra).toBeUndefined(); // niet bevestigd en al afgehandeld: geen open vraag meer
  });

  it('geweigerd door de collega', () => {
    const r = per(persoonsVerloop(ruil({ status: 'rejected', decidedAt: T.beslist }, [aangevraagd, overgang('Dienstruil afgewezen', 'pending', 'rejected', 'chauffeur')])));
    expect(r.collega).toMatchObject({ status: 'Geweigerd', toon: 'danger', op: T.beslist });
    expect(r.planner).toMatchObject({ status: 'Niet meer nodig', toon: 'neutraal' });
    expect(r.onbekend).toBeUndefined();
  });

  it('geweigerd door de planner, na het akkoord van de collega', () => {
    const r = per(persoonsVerloop(ruil({ status: 'rejected', decidedAt: T.beslist }, [aangevraagd, geaccepteerd, overgang('Dienstruil afgewezen', 'accepted', 'rejected', 'planner')])));
    expect(r.collega).toMatchObject({ status: 'Geaccepteerd', toon: 'succes', op: T.geaccepteerd });
    expect(r.planner).toMatchObject({ status: 'Geweigerd', toon: 'danger', op: T.beslist, naam: 'Jarno Planner' });
  });

  it('geweigerd door de planner terwijl de collega nog niet antwoordde', () => {
    const r = per(persoonsVerloop(ruil({ status: 'rejected', decidedAt: T.beslist }, [aangevraagd, overgang('Dienstruil afgewezen', 'pending', 'rejected', 'admin')])));
    expect(r.collega).toMatchObject({ status: 'Geen antwoord gegeven', toon: 'neutraal' });
    expect(r.planner.status).toBe('Geweigerd');
  });

  it('geweigerd zonder logregel: "Geweigerd" zonder afzender, niemand krijgt de schuld', () => {
    for (const log of [[], null] as Array<RuilLogRegel[] | null>) {
      const regels = persoonsVerloop(ruil({ status: 'rejected', decidedAt: T.beslist }, log));
      const r = per(regels);
      expect(regels).toHaveLength(4);
      expect(r.onbekend).toMatchObject({ status: 'Geweigerd', toon: 'danger', op: T.beslist, rolLabel: 'Niet geregistreerd door wie' });
      expect(r.collega.toon).toBe('neutraal');
      expect(r.planner.toon).toBe('neutraal');
      expect(r.collega.status).toBe('Antwoord niet geregistreerd');
    }
  });

  it('ingetrokken door de aanvrager', () => {
    const r = per(persoonsVerloop(ruil({ status: 'cancelled', decidedAt: T.beslist }, [aangevraagd, geaccepteerd, overgang('Dienstruil geannuleerd', 'accepted', 'cancelled', 'chauffeur')])));
    expect(r.aanvrager).toMatchObject({ status: 'Ingetrokken', op: T.beslist, extra: { label: 'Aangevraagd', op: T.aangevraagd } });
    expect(r.collega.status).toBe('Geaccepteerd');
    expect(r.planner.status).toBe('Niet meer nodig');
  });

  it('geannuleerd door de planner na een goedkeuring', () => {
    const log = [aangevraagd, overgang('Dienstruil goedgekeurd', 'pending', 'approved', 'admin'), overgang('Dienstruil geannuleerd', 'approved', 'cancelled', 'admin', T.afgehandeld)];
    const r = per(persoonsVerloop(ruil({ status: 'cancelled', decidedAt: T.afgehandeld }, log)));
    expect(r.aanvrager.status).toBe('Aangevraagd');
    expect(r.planner).toMatchObject({ status: 'Geannuleerd', toon: 'neutraal', op: T.afgehandeld, extra: { label: 'Eerder goedgekeurd', op: T.beslist } });
    expect(r.collega.status).toBe('Antwoord niet afgewacht');
  });

  it('geannuleerd zonder logregel: niet geregistreerd door wie', () => {
    const r = per(persoonsVerloop(ruil({ status: 'cancelled', decidedAt: T.beslist }, [])));
    expect(r.onbekend).toMatchObject({ status: 'Geannuleerd', toon: 'neutraal', op: T.beslist });
    expect(r.aanvrager.status).toBe('Aangevraagd');
  });

  it('ontbrekend verloop (log niet geladen): elke status geeft nog steeds een leesbaar blok', () => {
    for (const status of ['pending', 'accepted', 'approved', 'completed', 'rejected', 'cancelled']) {
      const regels = persoonsVerloop(ruil({ status, decidedAt: T.beslist }, null));
      expect(regels.length).toBeGreaterThanOrEqual(3);
      for (const r of regels) {
        expect(r.status).toBeTruthy();
        expect(r.rolLabel).toBeTruthy();
      }
      expect(regels.filter((r) => r.aanZet).length).toBe(status === 'pending' || status === 'accepted' ? 1 : 0);
    }
    const goedgekeurd = per(persoonsVerloop(ruil({ status: 'approved', decidedAt: T.beslist }, null)));
    expect(goedgekeurd.planner).toMatchObject({ status: 'Goedgekeurd', op: T.beslist });
    expect(goedgekeurd.collega.status).toBe('Antwoord niet geregistreerd');
    // Geaccepteerd zonder logregel: de status zelf bewijst het akkoord, het moment ontbreekt.
    const akkoord = per(persoonsVerloop(ruil({ status: 'accepted' }, null)));
    expect(akkoord.collega).toMatchObject({ status: 'Geaccepteerd', toon: 'succes' });
    expect(akkoord.collega.op).toBeUndefined();
  });

  it('een ruil zonder aangezochte collega heeft geen collega-regel', () => {
    const regels = persoonsVerloop(ruil({ targetDriverId: undefined }));
    expect(regels.map((r) => r.rol)).toEqual(['aanvrager', 'planner']);
  });
});

describe('persoonsVerloop, heeft de collega de aanvraag al bekeken', () => {
  // Ruim ná BEKEKEN_BIJGEHOUDEN_SINDS, en zone-loos: onder TZ=UTC en
  // TZ=Europe/Brussels vallen deze momenten aan dezelfde kant van de grens.
  const N = {
    aangevraagd: '2026-10-05T08:00:00',
    bekeken: '2026-10-05T08:40:00',
    bekekenOpnieuw: '2026-10-05T11:10:00',
    geantwoord: '2026-10-05T12:00:00',
  };
  const nieuwAangevraagd = regel('Dienstruil aangevraagd', N.aangevraagd, 'chauffeur', 'Sofie bood een dienst aan voor ruil.', 'Sofie Aanvrager');
  const bekeken = (op = N.bekeken) => regel(RUIL_BEKEKEN_ACTIE, op, 'chauffeur', 'Pieter Collega bekeek de aanvraag voor dienst 2101 op 14/10/2026.', 'Pieter Collega');
  const nieuweRuil = (over: Partial<RuilVoorVerloop> = {}, log: RuilLogRegel[] | null = [nieuwAangevraagd]) =>
    ruil({ createdAt: N.aangevraagd, ...over }, log);

  it('de logregel wordt een stap van de collega, zonder naam of vrije tekst', () => {
    expect(verloopUitLog([bekeken()], { metStafNaam: true })).toEqual([{ soort: 'bekeken', op: N.bekeken, door: 'collega' }]);
  });

  it('nog geen antwoord en nog niet bekeken: dat staat er, de collega blijft aan zet', () => {
    const r = per(persoonsVerloop(nieuweRuil(), { kijkerId: 'u-sofie' }));
    expect(r.collega).toMatchObject({ status: 'Nog niet bekeken', toon: 'neutraal', aanZet: true });
    expect(r.collega.op).toBeUndefined();
    expect(r.planner).toMatchObject({ status: 'Wacht op collega', aanZet: false });
  });

  it('bekeken vóór het antwoord: "Bekeken, nog geen antwoord" met het moment, voor de aanvrager én voor staf', () => {
    for (const kijkerId of ['u-sofie', 'u-planner', undefined]) {
      const r = per(persoonsVerloop(nieuweRuil({}, [nieuwAangevraagd, bekeken()]), { kijkerId }));
      expect(r.collega).toMatchObject({ status: 'Bekeken, nog geen antwoord', toon: 'neutraal', aanZet: true, op: N.bekeken });
    }
  });

  it('de collega zelf leest bij zijn eigen regel geen "bekeken": hij moet gewoon nog antwoorden', () => {
    for (const log of [[nieuwAangevraagd], [nieuwAangevraagd, bekeken()]]) {
      const r = per(persoonsVerloop(nieuweRuil({}, log), { kijkerId: 'u-pieter' }));
      expect(r.collega).toMatchObject({ status: 'Wacht op antwoord', aanZet: true });
      expect(r.collega.op).toBeUndefined();
    }
  });

  it('dubbele regels (race tussen twee toestellen): het eerste moment telt', () => {
    const r = per(persoonsVerloop(nieuweRuil({}, [bekeken(N.bekekenOpnieuw), nieuwAangevraagd, bekeken()]), { kijkerId: 'u-sofie' }));
    expect(r.collega).toMatchObject({ status: 'Bekeken, nog geen antwoord', op: N.bekeken });
  });

  it('na een antwoord telt alleen het antwoord', () => {
    const akkoord = regel('Dienstruil geaccepteerd', N.geantwoord, 'chauffeur', 'Sofie, dienstruil (pending → accepted).', 'Pieter Collega');
    const na = per(persoonsVerloop(nieuweRuil({ status: 'accepted' }, [nieuwAangevraagd, bekeken(), akkoord]), { kijkerId: 'u-sofie' }));
    expect(na.collega).toMatchObject({ status: 'Geaccepteerd', toon: 'succes', op: N.geantwoord });
    const weiger = overgang('Dienstruil afgewezen', 'pending', 'rejected', 'chauffeur', N.geantwoord);
    const geweigerd = per(persoonsVerloop(nieuweRuil({ status: 'rejected' }, [nieuwAangevraagd, bekeken(), weiger]), { kijkerId: 'u-sofie' }));
    expect(geweigerd.collega).toMatchObject({ status: 'Geweigerd', toon: 'danger', op: N.geantwoord });
    // Een admin keurde rechtstreeks goed: bekeken of niet, er kwam geen antwoord.
    const direct = overgang('Dienstruil goedgekeurd', 'pending', 'approved', 'admin', N.geantwoord);
    const goedgekeurd = per(persoonsVerloop(nieuweRuil({ status: 'approved' }, [nieuwAangevraagd, bekeken(), direct]), { kijkerId: 'u-sofie' }));
    expect(goedgekeurd.collega.status).toBe('Antwoord niet afgewacht');
    expect(goedgekeurd.planner).toMatchObject({ status: 'Goedgekeurd', toon: 'succes' });
  });

  it('een bekeken-regel is geen antwoord: alleen die regel bij een beslechte ruil blijft "niet geregistreerd"', () => {
    const r = per(persoonsVerloop(nieuweRuil({ status: 'approved' }, [bekeken()])));
    expect(r.collega.status).toBe('Antwoord niet geregistreerd');
  });

  it('oude ruil zonder regel: we weten het niet, dus gewoon "Wacht op antwoord"', () => {
    // Aangevraagd vóór de registratie liep (T.aangevraagd = 10/09/2026).
    expect(Date.parse(T.aangevraagd)).toBeLessThan(Date.parse(BEKEKEN_BIJGEHOUDEN_SINDS));
    const oud = per(persoonsVerloop(ruil(), { kijkerId: 'u-sofie' }));
    expect(oud.collega).toMatchObject({ status: 'Wacht op antwoord', aanZet: true });
    // Zonder (leesbaar) aanmaakmoment evenmin een bewering.
    for (const createdAt of [undefined, '', 'geen datum']) {
      expect(per(persoonsVerloop(nieuweRuil({ createdAt }), { kijkerId: 'u-sofie' })).collega.status).toBe('Wacht op antwoord');
    }
    // Log niet geladen (geen `verloop`): de ruil is van na de grens, maar zonder
    // log valt er niets te beweren over bekeken of niet.
    expect(per(persoonsVerloop(nieuweRuil({}, null), { kijkerId: 'u-sofie' })).collega.status).toBe('Wacht op antwoord');
  });

  it('een oude ruil die de collega nu pas opent krijgt wél "Bekeken"', () => {
    const r = per(persoonsVerloop(ruil({}, [aangevraagd, bekeken()]), { kijkerId: 'u-sofie' }));
    expect(r.collega).toMatchObject({ status: 'Bekeken, nog geen antwoord', op: N.bekeken });
  });

  it('de grens zelf: met tijdzone in het moment (zoals de database ze levert) is ze scherp', () => {
    const net = (createdAt: string) => per(persoonsVerloop(nieuweRuil({ createdAt }), { kijkerId: 'u-sofie' })).collega.status;
    expect(net('2026-09-21T21:59:59.000+00:00')).toBe('Wacht op antwoord');
    expect(net('2026-09-21T22:00:00.000+00:00')).toBe('Nog niet bekeken');
    expect(net('2026-09-22T00:00:00+02:00')).toBe('Nog niet bekeken');
  });

  it('handmatige wissel door de planning: geen aanvraag, dus ook geen "bekeken"', () => {
    const r = per(persoonsVerloop(nieuweRuil({ status: 'approved', reason: `${HANDMATIGE_WISSEL_PREFIX} ziekte` }, [])));
    expect(JSON.stringify(r)).not.toMatch(/bekeken/i);
  });
});

describe('persoonsVerloop, overname', () => {
  const overname = (over: Partial<RuilVoorVerloop>, log: RuilLogRegel[]) =>
    per(persoonsVerloop(ruil({ swapType: 'overname', returnDate: undefined, returnCode: undefined, ...over }, log)));

  it('heeft wél een akkoordstap: de collega neemt over en moet antwoorden; de aanvrager krijgt niets terug', () => {
    const r = overname({}, [aangevraagd]);
    expect(r.collega).toMatchObject({ rolLabel: 'Collega', status: 'Wacht op antwoord', aanZet: true, krijgt: { code: '2101', datum: '2026-09-14', overname: true } });
    expect(r.aanvrager.krijgt).toBeUndefined();
  });

  it('volgt daarna dezelfde stappen als een ruil', () => {
    expect(overname({ status: 'accepted' }, [aangevraagd, geaccepteerd]).planner).toMatchObject({ status: 'Te beoordelen', aanZet: true });
    expect(overname({ status: 'rejected', decidedAt: T.beslist }, [aangevraagd, overgang('Dienstruil afgewezen', 'pending', 'rejected', 'chauffeur')]).collega.status).toBe('Geweigerd');
    expect(overname({ status: 'approved', decidedAt: T.beslist }, [aangevraagd, geaccepteerd, overgang('Dienstruil goedgekeurd', 'accepted', 'approved', 'admin')]).planner.status).toBe('Goedgekeurd');
  });
});

describe('persoonsVerloop, handmatige wissel door de planning', () => {
  const reason = `${HANDMATIGE_WISSEL_PREFIX}Jarno Planner, ziekte`;
  const ingevoerd = regel('Dienst handmatig overgezet', T.beslist, 'admin', 'Sofie → Pieter, dienst 2101 op 2026-09-14.', 'Jarno Planner');

  it('geen akkoordstap: niemand "wacht op de collega", de planner voerde in', () => {
    const regels = persoonsVerloop(ruil({ status: 'approved', swapType: 'overname', reason, createdAt: T.beslist, decidedAt: T.beslist, returnDate: undefined, returnCode: undefined }, [ingevoerd]));
    expect(regels.map((r) => r.rol)).toEqual(['planner', 'aanvrager', 'collega']);
    const r = per(regels);
    expect(r.planner).toMatchObject({ status: 'Ingevoerd door de planner', toon: 'succes', op: T.beslist, naam: 'Jarno Planner' });
    expect(r.aanvrager).toMatchObject({ status: 'Geen akkoord nodig', rolLabel: 'Gaf de dienst af', aanZet: false });
    expect(r.collega).toMatchObject({ status: 'Nog niet bevestigd', rolLabel: 'Rijdt de dienst', aanZet: true });
    expect(JSON.stringify(regels)).not.toMatch(/Wacht op|Aangevraagd|Geaccepteerd/);
  });

  it('bevestigd door de nieuwe rijder, en de naam van de planner blijft weg bij een chauffeur', () => {
    const r = per(persoonsVerloop(ruil({ status: 'approved', swapType: 'overname', reason, createdAt: T.beslist, targetSeenAt: T.bevestigd }, [ingevoerd], false)));
    expect(r.collega).toMatchObject({ status: 'Bevestigd', toon: 'succes', op: T.bevestigd, aanZet: false });
    expect(r.planner.naam).toBeUndefined();
  });

  it('1-op-1 op dezelfde dag: beide chauffeurs, elk met wat hij krijgt', () => {
    const r = per(persoonsVerloop(ruil({ status: 'completed', reason, createdAt: T.beslist, returnDate: '2026-09-14' }, [regel('Diensten handmatig gewisseld', T.beslist, 'admin')])));
    expect(r.aanvrager).toMatchObject({ rolLabel: 'Chauffeur', krijgt: { code: '2202', datum: '2026-09-14' } });
    expect(r.collega).toMatchObject({ rolLabel: 'Chauffeur', status: 'Geen akkoord nodig', aanZet: false });
    expect(r.planner.extra).toMatchObject({ label: 'Afgehandeld' });
  });

  it('teruggedraaid', () => {
    const r = per(persoonsVerloop(ruil({ status: 'cancelled', swapType: 'overname', reason, createdAt: T.beslist, decidedAt: T.afgehandeld }, [ingevoerd, overgang('Dienstruil geannuleerd', 'approved', 'cancelled', 'admin', T.afgehandeld)])));
    expect(r.planner).toMatchObject({ status: 'Teruggedraaid', op: T.afgehandeld, extra: { label: 'Ingevoerd', op: T.beslist } });
    expect(r.collega).toMatchObject({ status: 'Geen akkoord nodig', aanZet: false });
  });

  it('zonder logregel valt het moment terug op het aanmaakmoment van de wissel', () => {
    const r = per(persoonsVerloop(ruil({ status: 'approved', swapType: 'overname', reason, createdAt: T.beslist }, null)));
    expect(r.planner).toMatchObject({ status: 'Ingevoerd door de planner', op: T.beslist });
  });
});
