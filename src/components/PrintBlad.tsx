import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Printer } from 'lucide-react';
import type { RapportDefinitie, RapportRij } from '../../shared/rapporten/types';
import { formatWaarde, heeftTotaalrij, isRechts, sorteerRijen } from '../../shared/rapporten/opmaak';
import { BrandLogo } from './BrandLogo';
import { Button } from './primitives';

/**
 * Hét printblad van het portaal (rapporten, 20-09): één opmaak voor alles wat
 * via de browser naar papier of PDF gaat. Geen PDF op de server: de
 * printdialoog van de browser maakt hem, dus er laadt geen zware bibliotheek
 * in de functie en het blad is wat je op het scherm ziet.
 *
 * Wat het blad zelf regelt:
 *  - kop met het VHB-logo, de titel en de gekozen filters in woorden, en
 *    "Afgedrukt op dd/mm/jjjj uu:mm door <naam>";
 *  - `@page` A4 staand of liggend met marges, paginateller rechtsonder
 *    (`@bottom-right`: werkt in Chrome en Edge, Safari negeert het, aanvaard);
 *  - altijd het lichte thema, ook als de app op donker staat: `.dark` gaat van
 *    `<html>` zolang het blad open is (zelfde recept als het loginscherm);
 *  - `print-color-adjust: exact` zodat de lijnen en het logo blijven staan,
 *    en een opmaak die ook in zwart-wit leest: lijnen en gewicht, geen kleur
 *    die betekenis draagt;
 *  - de titel van het tabblad, want die wordt de bestandsnaam van de PDF.
 *
 * `PrintTabel` (hieronder) zet een rapport uit het register erin: herhaalde
 * tabelkop op elke pagina, totaalrij onderaan, en bij nul rijen de zin "Geen
 * gegevens voor deze periode" (een leeg blad is soms net het bewijsstuk).
 *
 * De opmaak staat als CSS in dit bestand (punten en millimeters zijn de maat
 * van papier, niet de schermladder); kleuren komen uit de tokens.
 */

const tijdstip = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Tekst veilig in een CSS-string (de paginavoet staat in `content: "…"`). */
const cssTekst = (s: string): string => s.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ');

const bladCss = (richting: 'staand' | 'liggend', voet: string) => `
  .printblad { background: var(--color-surface-white, white); color: var(--color-slate-900); min-height: 100vh; font-family: var(--font-sans); }
  .printblad-vel { margin: 0 auto; padding: 2rem 1.25rem 3rem; max-width: ${richting === 'liggend' ? '297mm' : '210mm'}; }
  .printblad-balk { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1.5rem; }
  .printblad-balk p { margin: 0; font-size: 13px; color: var(--color-slate-500); }
  .printblad-kop { display: flex; align-items: flex-start; justify-content: space-between; gap: 8mm; padding-bottom: 4mm; border-bottom: 1.5pt solid var(--color-slate-900); }
  .printblad-logo { width: 38mm; height: auto; flex: none; }
  .printblad-titel { margin: 0; font-family: var(--font-display); font-weight: 800; font-size: 17pt; line-height: 1.15; letter-spacing: -0.01em; text-align: right; }
  .printblad-filters { margin: 1.5mm 0 0; font-size: 9.5pt; line-height: 1.4; text-align: right; color: var(--color-slate-700); }
  .printblad-meta { margin: 2.5mm 0 0; font-size: 8pt; color: var(--color-slate-500); }
  .printblad-opmerking { margin: 4mm 0 0; padding: 2mm 3mm; border-left: 2pt solid var(--color-slate-900); font-size: 9pt; line-height: 1.4; }
  .printblad-leeg { margin: 22mm 0; text-align: center; font-size: 10.5pt; color: var(--color-slate-600); }
  .printblad-tabelkader { overflow-x: auto; }
  .printblad-tabel { width: 100%; margin-top: 5mm; border-collapse: collapse; font-size: 9pt; line-height: 1.3; font-variant-numeric: tabular-nums; }
  .printblad-tabel thead { display: table-header-group; }
  .printblad-tabel th { padding: 1.6mm 2mm; border-bottom: 0.75pt solid var(--color-slate-900); font-size: 7.5pt; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; text-align: left; vertical-align: bottom; color: var(--color-slate-700); }
  .printblad-tabel td { padding: 1.5mm 2mm; border-bottom: 0.4pt solid var(--color-slate-300); vertical-align: top; }
  .printblad-tabel .rechts { text-align: right; white-space: nowrap; }
  .printblad-tabel tr { break-inside: avoid; page-break-inside: avoid; }
  .printblad-tabel tr.totaal td { border-top: 0.75pt solid var(--color-slate-900); border-bottom: 1.5pt solid var(--color-slate-900); font-weight: 700; }
  @media print {
    @page {
      size: A4 ${richting === 'liggend' ? 'landscape' : 'portrait'};
      margin: 14mm 14mm 16mm;
      @bottom-left { content: "${cssTekst(voet)}"; font: 8pt sans-serif; color: gray; }
      @bottom-right { content: "Pagina " counter(page) " van " counter(pages); font: 8pt sans-serif; color: gray; }
    }
    html, body { background: white !important; }
    .printblad { min-height: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .printblad-vel { max-width: none; padding: 0; }
    .printblad-balk { display: none !important; }
    .printblad-tabelkader { overflow: visible; }
  }
`;

export function PrintBlad({ titel, filters, door, richting = 'staand', tabbladTitel, opmerking, klaar = true, children }: {
  titel: string;
  /** De gekozen filters in woorden, één per stuk ("Jaar 2026", "Medewerker: alle"). */
  filters: readonly string[];
  /** Naam van wie afdrukt. */
  door: string;
  richting?: 'staand' | 'liggend';
  /** Titel van het tabblad = voorgestelde bestandsnaam van de PDF. */
  tabbladTitel?: string;
  /** Regel boven de inhoud, bv. dat de gegevens pas vanaf een datum beginnen. */
  opmerking?: ReactNode;
  /** Pas afdrukken als de inhoud er staat (de printdialoog opent dan vanzelf). */
  klaar?: boolean;
  children: ReactNode;
}) {
  const [nu] = useState(() => new Date());
  const afgedrukt = `Afgedrukt op ${tijdstip(nu)} door ${door}`;

  // Altijd licht: staf werkt standaard in het donkere thema, papier niet.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const wasDark = html.classList.contains('dark');
    html.classList.remove('dark');
    return () => { if (wasDark) html.classList.add('dark'); };
  }, []);

  useEffect(() => {
    if (!tabbladTitel) return;
    const vorige = document.title;
    document.title = tabbladTitel;
    return () => { document.title = vorige; };
  }, [tabbladTitel]);

  useEffect(() => {
    if (!klaar) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [klaar]);

  const css = useMemo(() => bladCss(richting, `VHB · ${titel}`), [richting, titel]);

  return (
    <div className="printblad">
      <style>{css}</style>
      <div className="printblad-vel">
        <div className="printblad-balk">
          <p>Voorbeeld van het blad. Kies in het printvenster “Opslaan als PDF” voor een bestand.</p>
          <Button variant="primary" icon={<Printer size={16} />} onClick={() => window.print()}>Afdrukken</Button>
        </div>
        <header className="printblad-kop">
          <BrandLogo tone="licht" variant="horizontaal" className="printblad-logo" />
          <div>
            <h1 className="printblad-titel">{titel}</h1>
            {filters.length > 0 && <p className="printblad-filters">{filters.join(' · ')}</p>}
          </div>
        </header>
        <p className="printblad-meta">{afgedrukt}</p>
        {opmerking ? <p className="printblad-opmerking">{opmerking}</p> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * Een rapport uit het register op het blad: alle rijen (geen paginering), in
 * de standaardsortering van de definitie, met de totaalrij als laatste rij
 * van de tabel (bewust geen `<tfoot>`: die herhaalt de browser op elke pagina).
 */
export function PrintTabel({ def, rijen, totalen, leegTekst = 'Geen gegevens voor deze periode.' }: {
  def: RapportDefinitie;
  rijen: readonly RapportRij[];
  totalen?: Record<string, number> | null;
  leegTekst?: string;
}) {
  const gesorteerd = useMemo(() => sorteerRijen(def, rijen, def.sortering.kolom, def.sortering.richting), [def, rijen]);
  if (gesorteerd.length === 0) return <p className="printblad-leeg">{leegTekst}</p>;
  return (
    // Het kader schuift alleen op een smal scherm (voorbeeld op de telefoon); op papier staat het uit.
    <div className="printblad-tabelkader">
    <table className="printblad-tabel">
      <thead>
        <tr>{def.kolommen.map((k) => <th key={k.id} className={isRechts(k) ? 'rechts' : undefined}>{k.titel}</th>)}</tr>
      </thead>
      <tbody>
        {gesorteerd.map((rij) => (
          <tr key={rij.id}>
            {def.kolommen.map((k) => <td key={k.id} className={isRechts(k) ? 'rechts' : undefined}>{formatWaarde(k, rij[k.id])}</td>)}
          </tr>
        ))}
        {totalen && heeftTotaalrij(def) && (
          <tr className="totaal">
            {def.kolommen.map((k, i) => (
              <td key={k.id} className={isRechts(k) ? 'rechts' : undefined}>
                {k.id in totalen ? formatWaarde(k, totalen[k.id]) : i === 0 ? `Totaal (${gesorteerd.length})` : ''}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
    </div>
  );
}
