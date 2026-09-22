import { describe, expect, it } from 'vitest';
import { dienstoverzichtToast } from './dienstoverzichtToast';

describe('dienstoverzichtToast', () => {
  it('zegt hoeveel chauffeurs een gewijzigd rooster hebben en wanneer ze het horen', () => {
    const t = dienstoverzichtToast({ status: 'bijgewerkt', gewijzigdeChauffeurs: 12, meldingUitgesteld: true, meldingNaMinuten: 10 });
    expect(t.toon).toBe('success');
    expect(t.naarRoosters).toBe(false);
    expect(t.tekst).toBe('Dienstoverzicht opgeslagen. Planning bijgewerkt: het rooster van 12 chauffeurs wijzigde. Zij krijgen één melding zodra je 10 minuten niets meer wijzigt.');
  });

  it('enkelvoud bij één chauffeur', () => {
    const t = dienstoverzichtToast({ status: 'bijgewerkt', gewijzigdeChauffeurs: 1, meldingUitgesteld: true, meldingNaMinuten: 10 });
    expect(t.tekst).toContain('het rooster van 1 chauffeur wijzigde. Hij of zij krijgt één melding');
  });

  it('een geblokkeerde heropbouw is geen succesmelding en geen fout van het opslaan', () => {
    const t = dienstoverzichtToast({ status: 'geblokkeerd', melding: 'er zijn onbekende codes. Bouw opnieuw op in Beheer planning.' });
    expect(t.toon).toBe('info');
    expect(t.naarRoosters).toBe(true);
    expect(t.tekst).toBe('Dienstoverzicht opgeslagen. Planning niet automatisch bijgewerkt: er zijn onbekende codes. Bouw opnieuw op in Beheer planning.');
  });

  it('een technische fout is rood, maar zegt nog altijd dat het dienstoverzicht opgeslagen is', () => {
    const t = dienstoverzichtToast({ status: 'mislukt', melding: 'er ging iets mis.' });
    expect(t.toon).toBe('error');
    expect(t.naarRoosters).toBe(true);
    expect(t.tekst.startsWith('Dienstoverzicht opgeslagen. Planning niet automatisch bijgewerkt:')).toBe(true);
  });

  it('een gewiste planning stuurt naar Beheer planning, een ontbrekende matrix niet', () => {
    expect(dienstoverzichtToast({ status: 'overgeslagen', reden: 'lege-planning', melding: 'de actieve planning is leeg.' }).naarRoosters).toBe(true);
    expect(dienstoverzichtToast({ status: 'overgeslagen', reden: 'geen-matrix', melding: 'x' })).toEqual({ tekst: 'Dienstoverzicht opgeslagen.', toon: 'success', naarRoosters: false });
  });

  it('no-op-save, ongewijzigde planning en een antwoord zonder planning-veld', () => {
    expect(dienstoverzichtToast({ status: 'niet-nodig' }).tekst).toBe('Dienstoverzicht opgeslagen.');
    expect(dienstoverzichtToast({ status: 'ongewijzigd' }).tekst).toBe('Dienstoverzicht opgeslagen. De planning hoefde niet te wijzigen.');
    expect(dienstoverzichtToast(undefined)).toEqual({ tekst: 'Dienstoverzicht opgeslagen.', toon: 'success', naarRoosters: false });
  });

  it('geen em dash als zinsscheiding in welke melding ook', () => {
    const statussen = ['bijgewerkt', 'ongewijzigd', 'overgeslagen', 'geblokkeerd', 'bezet', 'mislukt', 'niet-nodig'];
    for (const status of statussen) expect(dienstoverzichtToast({ status, gewijzigdeChauffeurs: 3, melding: 'reden.' }).tekst).not.toContain(' — ');
  });
});
