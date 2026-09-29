// @vitest-environment node
/**
 * Rollabels, inventaris (controle-ronde 29-09, nummer 20). Legt vast hoe het
 * portaal een rol VANDAAG noemt, vóór de centralisatie: dezelfde rol heet op
 * drie manieren. Deze test beschrijft de stand, hij keurt hem niet goed; de
 * volgende commit vervangt hem door de bewaking van de ene bron.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROL_LABEL } from './types';
import { ROL_LABELS, ROLLEN } from '../shared/schemas/constanten';

const ROOT = path.resolve(__dirname, '..');
const bron = (pad: string) => fs.readFileSync(path.join(ROOT, pad), 'utf8');
const regelsMet = (pad: string, re: RegExp) => bron(pad).split('\n').filter((r) => re.test(r)).length;

describe('rollabels: de stand vóór de centralisatie', () => {
  it('variant 1, src/types.ts (ROL_LABEL): Instellingen en de ontvangerslijst van Mail versturen', () => {
    expect(ROL_LABEL).toEqual({ chauffeur: 'Chauffeur', technieker: 'Technieker', planner: 'Planner', admin: 'Beheerder' });
  });

  it('variant 2, shared/schemas/constanten.ts (ROL_LABELS): profielmenu, Contacten, de rolkeuze in Gebruikers en de personeelsrapporten', () => {
    expect(ROL_LABELS).toEqual({ chauffeur: 'Chauffeur', technieker: 'Technieker', planner: 'Planning', admin: 'Beheer' });
  });

  it('de twee tabellen spreken elkaar tegen bij planner en admin', () => {
    expect(ROLLEN.filter((r) => ROL_LABEL[r] !== ROL_LABELS[r])).toEqual(['planner', 'admin']);
  });

  it('variant 3, de rauwe rolwaarde: met CSS capitalize in Gebruikers en de historiek, kaal in het activiteitenlog', () => {
    // Gebruikers: de rolregel in tabelrij en kaart, en de knoppen van het rolfilter.
    expect(regelsMet('src/views/admin/ManageUsersView.tsx', /capitalize/)).toBe(3);
    expect(bron('src/views/admin/ManageUsersView.tsx')).toContain("u.role === 'chauffeur' && u.ookTechnieker ? 'chauffeur + technieker' : u.role");
    expect(bron('src/views/admin/ManageUsersView.tsx')).toContain('(${viewingChangeLogUser.role})');
    expect(bron('src/views/admin/UserHistoryModal.tsx')).toContain('<span className="capitalize">{user.role}');
    // Activiteit en de wijzigingsgeschiedenis van een record tonen "admin" zoals het in de log staat.
    expect(regelsMet('src/views/admin/ActivityLogView.tsx', /\{e\.actorRole\}/)).toBe(2);
    expect(bron('src/components/EntityHistoryModal.tsx')).toContain('{entry.actorName} · {entry.actorRole}');
  });

  it('een vierde tabel in het printblad van de dienstwissels, met de rolwaarde in kleine letters', () => {
    expect(bron('src/views/PrintDienstwisselsView.tsx')).toContain("{ chauffeur: 'chauffeur', planner: 'planner', admin: 'admin', technieker: 'technieker' }");
  });

  it('het rolfilter in Gebruikers kent geen technieker', () => {
    expect(bron('src/views/admin/ManageUsersView.tsx')).toContain("(['all', 'chauffeur', 'planner', 'admin'] as const)");
  });

  it('handgeschreven rolnamen in het designsysteem-scherm', () => {
    const ds = bron('src/views/admin/DesignsysteemView.tsx');
    expect(ds).toContain('<Badge tone="slate">Admin</Badge>');
    expect(ds).toContain('<option value="admin">Beheerder</option>');
  });
});
