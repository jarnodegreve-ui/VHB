/** Sectiekop in het grid en de daglijst ("Chauffeurs", "Flexi/invallers",
 *  "Vrij / afwezig"): duidelijker dan een micro-label (Jarno 08-09), met
 *  een donkerdere band, vette kop en een gouden accentstreep links.
 *  Gedeeld door het desktopraster (DesktopRaster.tsx) en de dagweergave in
 *  de view; verplaatst uit CapacityView.tsx op 09-10 (stap 1). */
export const SECTIE_KOP = 'text-xs font-bold uppercase tracking-wider text-slate-900';
/** Gouden streepje vóór de sectienaam: klein merkaccent i.p.v. een band. */
export const SECTIE_STREEP = <span className="mr-2.5 inline-block h-3.5 w-1 shrink-0 rounded-full bg-oker-500" aria-hidden="true" />;
// Band-kleur staat in index.css (.mp-sectie, slate-200 die meeflipt in dark
// mode) zodat hij ook op de sticky cel wint; hier alleen de gouden
// accentstreep (Jarno 08-09: donker paste niet bij de rest).
export const SECTIE_BAND = 'mp-sectie';
