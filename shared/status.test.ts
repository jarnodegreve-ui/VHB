import { describe, expect, it } from 'vitest';
import {
  AANVRAAG_STATUS, ACCOUNT_STATUS, COLLEGA_ANTWOORD, DAG_STATUS, DEFECT_STATUS, FOUTGROEP_STATUS,
  OMLEIDING_FASE, RUIL_STATUS, TOESTEL_STATUS, VERVAL_STATUS, VOERTUIG_STATUS,
  statusLabel, statusVan, type StatusDef,
} from './status';

const ALLE: Record<string, Record<string, StatusDef>> = {
  AANVRAAG_STATUS, RUIL_STATUS, COLLEGA_ANTWOORD, TOESTEL_STATUS, VOERTUIG_STATUS, DEFECT_STATUS,
  DAG_STATUS, OMLEIDING_FASE, ACCOUNT_STATUS, FOUTGROEP_STATUS, VERVAL_STATUS,
};

describe('statuswoordenschat', () => {
  it('elke status heeft een Nederlandse tekst met hoofdletter en een toon', () => {
    for (const [naam, map] of Object.entries(ALLE)) {
      for (const [status, d] of Object.entries(map)) {
        expect(d.label, `${naam}.${status}`).toMatch(/^[A-Z]/);
        expect(d.label, `${naam}.${status}`).not.toMatch(/[a-z]{2,}ed$/i); // geen Engels ("approved")
        expect(['neutraal', 'info', 'aandacht', 'waarschuwing', 'gevaar', 'goed']).toContain(d.toon);
      }
    }
  });

  it('planner wijst af, collega weigert: geen "Geweigerd" bij de planner-beslissing', () => {
    expect(AANVRAAG_STATUS.rejected.label).toBe('Afgewezen');
    expect(RUIL_STATUS.rejected.label).toBe('Afgewezen');
    expect(COLLEGA_ANTWOORD.geweigerd.label).toBe('Geweigerd');
  });

  it('completed heet Goedgekeurd, net als approved (Jarno 18-09)', () => {
    expect(AANVRAAG_STATUS.completed.label).toBe('Goedgekeurd');
    expect(AANVRAAG_STATUS.completed.toon).toBe(AANVRAAG_STATUS.approved.toon);
  });

  it('ruil-pending noemt de collega, verlof-pending niet', () => {
    expect(RUIL_STATUS.pending.label).toBe('Wacht op collega');
    expect(AANVRAAG_STATUS.pending.label).toBe('In behandeling');
    expect(RUIL_STATUS.approved).toEqual(AANVRAAG_STATUS.approved);
  });

  it('statusVan valt terug op de ruwe waarde, nooit op een crash', () => {
    expect(statusVan(AANVRAAG_STATUS, 'approved').label).toBe('Goedgekeurd');
    expect(statusVan(AANVRAAG_STATUS, 'gloednieuw')).toEqual({ label: 'gloednieuw', toon: 'neutraal' });
    expect(statusVan(AANVRAAG_STATUS, null).label).toBe('Onbekend');
    expect(statusVan(AANVRAAG_STATUS, undefined).toon).toBe('neutraal');
  });

  it('statusLabel met kleine letter voor midden in een zin', () => {
    expect(statusLabel(AANVRAAG_STATUS, 'rejected', true)).toBe('afgewezen');
    expect(statusLabel(TOESTEL_STATUS, 'pending')).toBe('Wacht op goedkeuring');
  });

  it('toestel- en voertuigtonen zijn per domein één keer vastgelegd', () => {
    expect(TOESTEL_STATUS.revoked.toon).toBe('gevaar');
    expect(VOERTUIG_STATUS.reserve.toon).toBe('aandacht');
    expect(VOERTUIG_STATUS.uit_dienst.toon).toBe('neutraal');
  });
});
