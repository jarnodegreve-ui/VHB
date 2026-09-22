/**
 * De melding na "Dienstoverzicht opslaan". De server werkt de planning zelf
 * bij wanneer de diensten inhoudelijk wijzigden en meldt in `planning` wat er
 * gebeurde (api/_lib/planningHeropbouw.ts). De save zelf is op dit punt altijd
 * geslaagd: een heropbouw die niet doorging is dus nooit een rode fout over
 * het opslaan, maar ook nooit een stille of valse succesmelding.
 */
export type PlanningNaDienstoverzicht = {
  status?: string;
  reden?: string;
  melding?: string;
  gewijzigdeChauffeurs?: number;
  meldingUitgesteld?: boolean;
  meldingNaMinuten?: number;
} | null | undefined;

export type DienstoverzichtToast = {
  tekst: string;
  toon: 'success' | 'info' | 'error';
  /** true = de planner moet zelf naar "Planning opnieuw opbouwen". */
  naarRoosters: boolean;
};

const OPGESLAGEN = 'Dienstoverzicht opgeslagen.';

export const dienstoverzichtToast = (planning: PlanningNaDienstoverzicht): DienstoverzichtToast => {
  const status = planning?.status;
  if (status === 'bijgewerkt') {
    const aantal = Number(planning?.gewijzigdeChauffeurs) || 0;
    if (aantal === 0) return { tekst: `${OPGESLAGEN} Planning bijgewerkt, voor geen enkele chauffeur wijzigt het rooster.`, toon: 'success', naarRoosters: false };
    const wie = aantal === 1 ? 'het rooster van 1 chauffeur wijzigde' : `het rooster van ${aantal} chauffeurs wijzigde`;
    const minuten = Number(planning?.meldingNaMinuten) || 10;
    const wanneer = planning?.meldingUitgesteld
      ? `${aantal === 1 ? 'Hij of zij krijgt' : 'Zij krijgen'} één melding zodra je ${minuten} minuten niets meer wijzigt.`
      : `${aantal === 1 ? 'Hij of zij kreeg' : 'Zij kregen'} een melding.`;
    return { tekst: `${OPGESLAGEN} Planning bijgewerkt: ${wie}. ${wanneer}`, toon: 'success', naarRoosters: false };
  }
  if (status === 'ongewijzigd') {
    return { tekst: `${OPGESLAGEN} De planning hoefde niet te wijzigen.`, toon: 'success', naarRoosters: false };
  }
  // Geen matrix: er bestaat nog geen planning om bij te werken, dus ook geen
  // omweg via Beheer planning.
  if (status === 'overgeslagen' && planning?.reden === 'geen-matrix') {
    return { tekst: OPGESLAGEN, toon: 'success', naarRoosters: false };
  }
  if (status === 'geblokkeerd' || status === 'overgeslagen' || status === 'bezet' || status === 'mislukt') {
    const reden = String(planning?.melding ?? '').trim() || 'de reden is onbekend. Bouw de planning zelf opnieuw op in Beheer planning.';
    return {
      tekst: `${OPGESLAGEN} Planning niet automatisch bijgewerkt: ${reden}`,
      // Alleen een technische fout is een fout van de app; een vangrail die
      // zijn werk doet hoort niet in de foutenlog.
      toon: status === 'mislukt' ? 'error' : 'info',
      naarRoosters: true,
    };
  }
  // 'niet-nodig' (no-op-save) of een oudere server zonder planning-veld.
  return { tekst: OPGESLAGEN, toon: 'success', naarRoosters: false };
};
