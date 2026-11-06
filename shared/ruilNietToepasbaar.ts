/**
 * Een goedgekeurde ruil die een import of heropbouw niet opnieuw kon
 * doorvoeren, met de reden erbij: bij wie de dienst in de Excel wél staat.
 *
 * Aanleiding (06-11): een handmatige wissel (Bianca → Roeland, dienst 2101)
 * werd twee minuten later overschreven door een Excel-import waarin die
 * dienst bij een derde chauffeur stond. De replay vond geen rijen bij de
 * gever en geen bij de ontvanger, telde stil mee in "(7 niet toepasbaar)" en
 * de ruil bleef "Goedgekeurd" terwijl de planning iets anders zei. Sindsdien
 * noemt het voorbeeld én het log per ruil wie, welke dienst, welke dag en
 * bij wie de dienst dan wél staat, zodat de planner het vóór het bevestigen
 * ziet. Waarschuwing, geen blokkade (keuze Jarno 06-11).
 */
export type RuilNietToepasbaar = {
  id: string;
  /** Naam van de gever (aanvrager van de ruil). */
  van: string;
  /** Naam van de ontvanger. */
  naar: string;
  /** Het dienstnummer dat na de import bij de verkeerde persoon staat. */
  dienst: string;
  /** ISO-datum van die dienst. */
  dag: string;
  /** 'aangeboden': de aangeboden dienst hoort bij de ontvanger te staan;
   *  'terug': de terugdienst van een 1-op-1-ruil hoort bij de gever. */
  been: "aangeboden" | "terug";
  /** Bij wie de dienst na de opbouw (Excel plus de andere ruilen) staat; leeg = bij niemand. */
  dienstBij: string[];
  /** Ingevoerd door de planner (handmatige wissel) in plaats van aangevraagd. */
  handmatig: boolean;
};

/** Eén zin per ruil, dezelfde in het log en in het importvoorbeeld. De
 *  datumopmaak komt van de aanroeper (server en client hebben elk de hunne). */
export const beschrijfRuilNietToepasbaar = (r: RuilNietToepasbaar, dmj: (iso: string) => string): string => {
  const kop = r.been === "terug"
    ? `${r.naar} naar ${r.van}, terugdienst ${r.dienst} op ${dmj(r.dag)}`
    : `${r.van} naar ${r.naar}, dienst ${r.dienst} op ${dmj(r.dag)}`;
  const wie = r.been === "terug" ? r.van : r.naar;
  return r.dienstBij.length > 0
    ? `${kop}: komt bij ${r.dienstBij.join(" en ")} te staan, niet bij ${wie}`
    : `${kop}: komt bij niemand te staan, niet bij ${wie}`;
};
