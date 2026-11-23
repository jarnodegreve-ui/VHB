import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KpiTegelSkelet, ViewLoader } from '../components/ui';
import { ALLE_VIEWS, routeVan, sectieLabel } from './routes';
import { MijnDagSkelet, skeletVoor } from './skeletten';

const html = (el: React.ReactNode) => renderToStaticMarkup(<>{el}</>);
/** Wat een mens leest: de tekst zonder de opmaak. */
const tekst = (h: string) => h.replace(/<[^>]+>/g, '').trim();
/** De regels van het tekstblok in de kop (eyebrow, titel, beschrijving). */
const kopRegels = (h: string) => {
  const blok = h.slice(h.indexOf('<header'), h.indexOf('</header>'));
  return (blok.match(/class="(text-micro|text-page-title[^"]*|[^"]*flex h-[^"]* items-center[^"]*)"/g) ?? []).length;
};

describe('skeletVoor, één skelet per scherm', () => {
  const schermen = ALLE_VIEWS.filter((v) => v !== 'mijn-dag');

  it('Mijn dag heeft zijn eigen skelet, hetzelfde in de schil en in het scherm', () => {
    const eigen = html(<MijnDagSkelet />);
    expect(eigen).toContain('aria-label="Mijn dag wordt geladen"');
    expect(html(skeletVoor('mijn-dag'))).toBe(eigen);
    expect(html(skeletVoor('mijn-dag', true))).toBe(eigen);
    expect(tekst(eigen)).toBe('');
  });

  it('vanaf de terugval staat de echte titel uit de routetabel in de kop', () => {
    for (const view of schermen) {
      const h = html(skeletVoor(view));
      expect(h, view).toContain(`>${routeVan(view).label}</h1>`);
      const eyebrow = sectieLabel(view);
      if (eyebrow) expect(h, view).toContain(`<p class="text-micro">${eyebrow}</p>`);
      else expect(h, view).not.toContain('text-micro');
    }
  });

  it('in de schil van de app (rol onbekend) draagt geen enkel skelet tekst, en de kop heeft evenveel regels', () => {
    for (const view of schermen) {
      const schil = html(skeletVoor(view, true));
      expect(tekst(schil), view).toBe('');
      expect(schil, view).not.toContain('<h1');
      expect(schil, view).not.toContain('text-micro');
      // Zelfde opbouw: een eyebrow blijft een regel, de titel blijft een regel.
      expect(kopRegels(schil), view).toBe(kopRegels(html(skeletVoor(view))));
      // Onder de kop is het hetzelfde skelet als vanaf de terugval.
      const naKop = (h: string) => h.slice(h.indexOf('</header>'));
      expect(naKop(schil), view).toBe(naKop(html(skeletVoor(view))));
    }
    // De telling zelf: alleen een titel, eyebrow + titel, eyebrow + titel + beschrijving.
    expect(kopRegels(html(skeletVoor('documenten', true)))).toBe(1);
    expect(kopRegels(html(skeletVoor('beheer-roosters', true)))).toBe(2);
    expect(kopRegels(html(skeletVoor('ziekte', true)))).toBe(3);
  });

  it('zonder de prop tekent ViewLoader exact wat het tekende', () => {
    expect(html(<ViewLoader view="verlof" beschrijving kopAlsSkelet={false} />)).toBe(html(<ViewLoader view="verlof" beschrijving />));
    // Zonder scherm (losse terugval in een view) blijft de titel een skeletregel, zoals altijd.
    expect(tekst(html(<ViewLoader />))).toBe('');
  });

  it('de KPI-skelettegel draagt de klassen van een OpsStat en de rasterklassen van de tegel die hij vervangt', () => {
    const tegel = html(<KpiTegelSkelet className="md:col-span-3 xl:col-span-1 col-span-2" />);
    expect(tegel).toContain('class="kpi-tegel surface-card rounded-3xl p-4 md:col-span-3 xl:col-span-1 col-span-2"');
    for (const deel of ['kpi-kop', 'kpi-getal', 'kpi-sub']) expect(tegel).toContain(deel);
    // De KPI-rij van ViewLoader tekent dezelfde tegel (één bron).
    expect(html(<ViewLoader view="ziekte" kpis={1} />)).toContain(html(<KpiTegelSkelet />));
  });
});
