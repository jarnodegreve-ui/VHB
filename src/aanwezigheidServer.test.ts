import { describe, it, expect, beforeEach } from 'vitest';
import { HARTSLAG_MS, SESSIE_GAT_MS, hoortBijSessie, magSchrijven, vergeetHartslagen } from '../api/_lib/aanwezigheid';

/**
 * De twee beslissingen die bepalen hoeveel het bijhouden van aanwezigheid het
 * portaal kost, en hoe het beeld eruitziet:
 *
 *  - magSchrijven: de rem. Zonder deze rem zou élk geauthenticeerd verzoek
 *    een schrijfactie worden, en het portaal doet er per zichtbaar tabblad
 *    al één per minuut.
 *  - hoortBijSessie: oprekken of een nieuwe rij. Te streng knipt een dienst
 *    in stukken, te soepel plakt een ochtend- en avonddienst aan elkaar.
 */

beforeEach(() => vergeetHartslagen());

describe('magSchrijven', () => {
  it('laat de eerste keer altijd door', () => {
    expect(magSchrijven('u1', 1_000_000)).toBe(true);
  });

  it('houdt alles binnen het hartslagvenster tegen', () => {
    const nu = 1_000_000;
    expect(magSchrijven('u1', nu)).toBe(true);
    expect(magSchrijven('u1', nu + 1000)).toBe(false);
    expect(magSchrijven('u1', nu + HARTSLAG_MS - 1)).toBe(false);
  });

  it('laat weer door zodra het venster om is', () => {
    const nu = 1_000_000;
    expect(magSchrijven('u1', nu)).toBe(true);
    expect(magSchrijven('u1', nu + HARTSLAG_MS)).toBe(true);
  });

  it('remt per gebruiker, niet globaal', () => {
    const nu = 1_000_000;
    expect(magSchrijven('u1', nu)).toBe(true);
    expect(magSchrijven('u2', nu)).toBe(true);
  });

  it('laat gelijktijdige verzoeken van dezelfde persoon er samen één door', () => {
    // Twee tabbladen die op hetzelfde moment pollen: de eerste registreert,
    // de tweede ziet dat en houdt zijn mond.
    const nu = 1_000_000;
    const uitkomsten = [magSchrijven('u1', nu), magSchrijven('u1', nu), magSchrijven('u1', nu)];
    expect(uitkomsten.filter(Boolean)).toHaveLength(1);
  });
});

describe('hoortBijSessie', () => {
  const nu = Date.parse('2026-09-18T09:00:00Z');
  const geleden = (ms: number) => new Date(nu - ms).toISOString();

  it('rekt de lopende sessie op bij een verse hartslag', () => {
    expect(hoortBijSessie(geleden(3 * 60 * 1000), nu)).toBe(true);
  });

  it('rekt nog op precies op de rand van het sessiegat', () => {
    expect(hoortBijSessie(geleden(SESSIE_GAT_MS), nu)).toBe(true);
  });

  it('begint een nieuwe sessie na een langere stilte', () => {
    expect(hoortBijSessie(geleden(SESSIE_GAT_MS + 1000), nu)).toBe(false);
    expect(hoortBijSessie(geleden(4 * 60 * 60 * 1000), nu)).toBe(false);
  });

  it('begint een nieuwe sessie als er nog nooit iets was', () => {
    expect(hoortBijSessie(null, nu)).toBe(false);
  });

  it('begint een nieuwe sessie bij onleesbare invoer', () => {
    expect(hoortBijSessie('geen-datum', nu)).toBe(false);
  });

  it('overleeft een klok die voorloopt', () => {
    // Twee serverless-instanties kunnen een paar seconden uiteenlopen. Zonder
    // deze regel opent elke scheve klok een nieuwe sessie.
    expect(hoortBijSessie(new Date(nu + 5000).toISOString(), nu)).toBe(true);
  });

  it('houdt een gesplitste dienst uit elkaar', () => {
    // Ochtenddeel om 06:00 afgelopen, avonddeel begint om 16:00: dat hoort
    // twee blokken te worden, geen doorlopende balk van tien uur.
    const ochtendEinde = Date.parse('2026-09-18T06:00:00Z');
    const avondStart = Date.parse('2026-09-18T16:00:00Z');
    expect(hoortBijSessie(new Date(ochtendEinde).toISOString(), avondStart)).toBe(false);
  });
});
