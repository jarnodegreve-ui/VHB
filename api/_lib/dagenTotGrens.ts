/**
 * Welke dagen telt een overzicht van de planning mee? Alleen de dagen tot en
 * met de grens van de planning: de laatste matrixdag met minstens één dienst
 * (Jarno 22-11, regel in api/_lib/planningGrens.ts; `getPlanningMatrixGrenzen
 * ().laatste`, dezelfde dag als het Rooster en de Maandplanning). Alles op de
 * dagen ná de grens telt niet meer mee tot een import ze vult (Jarno 24-11),
 * niet alleen wat de cel-waarheid er nog overlegt (goedgekeurd verlof, ziekte,
 * ruilen) maar ook wat de Excel zelf op die dagen zet: verlof (bv), vrij of
 * rust, opleiding of ander werk met "Telt als dienst" waarvan de categorie
 * geen dienst is, en een dienst zonder geldige uren (die heeft geen
 * planningrijen en verlegt de grens dus niet). De dekking ziet er elke
 * verwachte dienst als open. Bekende grens: een voorbije maand valt hier
 * alleen onder als `planning` korter is dan de matrix maar niet leeg; bij een
 * lege planning is de grens de laatste matrixrij (planningGrens.ts).
 *
 * Eén regel voor de tellingen die gelijk moeten blijven: het Overzicht-venster
 * van de Maandplanning (GET /api/month-planning?format=summary), het tweede
 * tabblad van de Excel-terugexport (format=xlsx), het rapport Overzicht per
 * chauffeur (`maandoverzichtVan`) en het rapport Openstaande diensten. Het
 * bord zelf (dates, cells) en het eerste Excel-tabblad kappen niet: het scherm
 * dempt de kolommen na de grens zelf (`naImport` in src/lib/maandplanning.ts,
 * dezelfde vergelijking), het tabblad is de cel-waarheid om terug te importeren.
 *
 * Geen grens (geen matrix) of geen geldige dag: niets valt erna, het gedrag
 * van vóór 24-11.
 */
import { isIsoDag } from "../../shared/rapporten/periode.js";

/** Ligt deze dag ná de grens van de planning? */
export const naGrens = (dag: string, laatste: string | null | undefined): boolean => isIsoDag(laatste) && dag > laatste;

/** De dagen tot en met de grens, in hun eigen volgorde. */
export const dagenTotGrens = (dates: readonly string[], laatste: string | null | undefined): string[] =>
  dates.filter((dag) => !naGrens(dag, laatste));
