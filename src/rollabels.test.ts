// @vitest-environment node
/**
 * Rollabels (controle-ronde 29-09, nummer 20). Een rol heet op één manier en
 * dat staat op één plek: shared/rollen.ts. De inventaris van vóór de
 * centralisatie (drie varianten, een vierde tabel in een printblad, een
 * rolfilter zonder technieker) stond hier in de vorige commit; dit is wat
 * ervoor in de plaats kwam, plus de bewaking dat het zo blijft.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROL_LABEL as ROL_LABEL_VIA_TYPES } from './types';
import { ROL_LABEL } from '../shared/rollen';
import * as constanten from '../shared/schemas/constanten';

const ROOT = path.resolve(__dirname, '..');
const bron = (pad: string) => fs.readFileSync(path.join(ROOT, pad), 'utf8');

const loop = (dir: string, uit: string[] = []): string[] => {
  for (const naam of fs.readdirSync(dir)) {
    const p = path.join(dir, naam);
    if (fs.statSync(p).isDirectory()) loop(p, uit);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !/\.d\.ts$/.test(p)) uit.push(p);
  }
  return uit;
};
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
/** Commentaar weg, regelnummers blijven kloppen. */
const zonderCommentaar = (tekst: string) => tekst
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, voor: string) => voor + ' '.repeat(m.length - voor.length));

const SRC = loop(path.join(ROOT, 'src'));
const ALLES = [...SRC, ...loop(path.join(ROOT, 'shared')), ...loop(path.join(ROOT, 'api'))];

describe('rollabels: één bron', () => {
  it('src/types.ts verwijst door naar shared/rollen.ts (zelfde object, geen kopie)', () => {
    expect(ROL_LABEL_VIA_TYPES).toBe(ROL_LABEL);
  });

  it('de tweede tabel (ROL_LABELS in shared/schemas/constanten.ts, "Planning" en "Beheer") is weg', () => {
    expect(Object.keys(constanten)).not.toContain('ROL_LABELS');
    const gebruikers = ALLES.filter((p) => /\bROL_LABELS\b/.test(zonderCommentaar(fs.readFileSync(p, 'utf8')))).map(rel);
    expect(gebruikers).toEqual([]);
  });

  it('geen tweede labeltabel: een object dat rollen op tekst afbeeldt staat alleen in shared/rollen.ts', () => {
    // Twee of meer rolsleutels met een tekst als waarde in hetzelfde bestand.
    // Toegestaan: de bron zelf, en de personeelsrapporten, die hun woorden
    // houden tot er over de CSV-export beslist is (open punt, zie daar).
    const TOEGESTAAN = ['shared/rollen.ts', 'shared/rapporten/definities/personeel.ts'];
    const fouten: string[] = [];
    for (const p of ALLES) {
      if (TOEGESTAAN.includes(rel(p))) continue;
      const sleutels = new Set([...zonderCommentaar(fs.readFileSync(p, 'utf8')).matchAll(/(?<![\w.'"-])(chauffeur|technieker|planner|admin)\s*:\s*['"`]/g)].map((m) => m[1]));
      if (sleutels.size >= 2) fouten.push(`${rel(p)}: ${[...sleutels].join(', ')}`);
    }
    expect(fouten, 'gebruik ROL_LABEL, rolLabel of rolRegel uit shared/rollen.ts').toEqual([]);
  });

  it('de uitzondering van de personeelsrapporten bestaat nog: haal haar uit de lijst hierboven zodra ze weg is', () => {
    expect(bron('shared/rapporten/definities/personeel.ts')).toContain('ROL_IN_RAPPORT');
  });
});

describe('rollabels: geen rauwe rolwaarde in beeld', () => {
  const ROLWOORD = /\b(?:role|actorRole|uitgevoerdDoorRol|roleFilter|rolRegel|rolLabel|ROL_LABEL|ROL_FILTER)\b/;

  it('geen CSS capitalize op een rolwaarde (een hoofdletter maakt van "admin" geen label)', () => {
    // Zelfde regel, of binnen drie regels (een prop op een component, zoals
    // `itemClassName="capitalize"` boven de opties van het rolfilter).
    const fouten: string[] = [];
    for (const p of SRC) {
      const regels = zonderCommentaar(fs.readFileSync(p, 'utf8')).split('\n');
      regels.forEach((regel, i) => {
        if (!/\bcapitalize\b/.test(regel)) return;
        const buurt = regels.slice(Math.max(0, i - 3), i + 4).join('\n');
        if (ROLWOORD.test(buurt)) fouten.push(`${rel(p)}:${i + 1}`);
      });
    }
    expect(fouten, 'toon rolLabel(rol) of rolRegel(persoon) uit shared/rollen.ts').toEqual([]);
  });

  it('geen rolwaarde rechtstreeks in JSX of in een tekstsjabloon', () => {
    // Geen portaalrol, of bewust de rauwe waarde:
    const TOEGESTAAN = [
      'src/views/admin/OcpiCard.tsx', // OCPI-rol van een endpoint (SENDER/RECEIVER)
      'src/views/admin/DebugView.tsx', // diagnose: toont wat de server letterlijk gaf
    ];
    const fouten: string[] = [];
    for (const p of SRC) {
      if (TOEGESTAAN.includes(rel(p))) continue;
      zonderCommentaar(fs.readFileSync(p, 'utf8')).split('\n').forEach((regel, i) => {
        const inJsx = /(?<![=\w])\{\s*[\w.?!]+\.(?:role|actorRole|uitgevoerdDoorRol)\s*\}/.test(regel);
        const inSjabloon = /\$\{\s*[\w.?!]+\.(?:role|actorRole|uitgevoerdDoorRol)\s*\}/.test(regel);
        if (inJsx || inSjabloon) fouten.push(`${rel(p)}:${i + 1}`);
      });
    }
    expect(fouten, 'toon rolLabel(rol) of rolRegel(persoon) uit shared/rollen.ts').toEqual([]);
  });

  it('geen handgeschreven "Admin" of "Beheerder" als losse tekst', () => {
    const fouten: string[] = [];
    for (const p of SRC) {
      zonderCommentaar(fs.readFileSync(p, 'utf8')).split('\n').forEach((regel, i) => {
        if (/(['"`>])\s*(?:Admin|Beheerder)\s*(['"`<])/.test(regel)) fouten.push(`${rel(p)}:${i + 1}`);
      });
    }
    expect(fouten, 'gebruik ROL_LABEL.admin uit shared/rollen.ts').toEqual([]);
  });
});

describe('rollabels: Gebruikers', () => {
  const gebruikers = bron('src/views/admin/ManageUsersView.tsx');

  it('het rolfilter komt uit de bron, met technieker erbij', () => {
    expect(gebruikers).toContain('opties={ROL_FILTER}');
    expect(gebruikers).toContain('pastBijRolFilter(u, roleFilter)');
    expect(gebruikers).not.toMatch(/\['all', 'chauffeur'/);
  });

  it('de rolkeuze in het formulier gebruikt de rolwaarde als waarde en het label als tekst', () => {
    expect(gebruikers.match(/<option key=\{r\} value=\{r\}>\{ROL_LABEL\[r\]\}<\/option>/g)).toHaveLength(2);
  });
});

describe('rollabels: wat bewust de rolwaarde houdt', () => {
  it('de CSV-export van het activiteitenlog schrijft de rolwaarde, niet het label', () => {
    expect(bron('src/views/admin/ActivityLogView.tsx')).toContain('e.actorName, e.actorRole, e.details]');
  });
});
