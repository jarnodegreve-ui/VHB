/**
 * "Wat is nieuw": één dismissbare kaart op het dashboard na een release, met
 * twee à drie regels per rol. Chauffeurs ontdekten nieuwe schermen (Mijn dag,
 * Instellingen) anders niet — de app ziet er na een update gewoon hetzelfde
 * uit. Nieuwste item bovenaan; `id` = releasedatum (ISO) en tevens de
 * volgorde. Weggeklikt = id in localStorage; alles ouder dan dat id blijft
 * dan ook weg (één kaart tegelijk, nooit een stapel).
 */
export type WatIsNieuwItem = {
  id: string;
  titel: string;
  /** Regels per doelgroep; een rol zonder regels krijgt de kaart niet. */
  regels: { chauffeur?: string[]; staf?: string[] };
  /** Optionele "Bekijk"-knop naar een scherm (view-naam uit routes.tsx). */
  bekijk?: { chauffeur?: string; staf?: string };
};

export const WAT_IS_NIEUW: WatIsNieuwItem[] = [
  {
    id: '2026-09-04',
    titel: 'Nieuw in het portaal',
    regels: {
      chauffeur: [
        'Mijn dag: je tijdlijn van vandaag met ritblad en omleidingen, in de onderste balk.',
        'Instellingen: thema, meldingen en agenda-koppeling op één plek.',
        'De terugknop van je telefoon sluit nu eerst het open venster.',
      ],
      staf: [
        'Beheertabellen: zoeken, sorteren, bulkacties en kolomvoorkeuren.',
        'Lijst en detail naast elkaar op een breed scherm; ⌘K zoekt ook personen en acties.',
        'Verwijderen kan je zes seconden ongedaan maken vanuit de melding.',
      ],
    },
    bekijk: { chauffeur: 'mijn-dag', staf: 'instellingen' },
  },
];

const SLEUTEL = 'vhb-wat-is-nieuw-gezien';

export type NieuwsRol = 'chauffeur' | 'staf';

export function nieuwsRolVan(rol: string): NieuwsRol {
  return rol === 'driver' || rol === 'chauffeur' ? 'chauffeur' : 'staf';
}

/** Het nieuwste ongeziene item met regels voor deze rol, of null. */
export function ongezienNieuws(rol: NieuwsRol, gezienId: string | null, items = WAT_IS_NIEUW): WatIsNieuwItem | null {
  const item = items.find((i) => (i.regels[rol]?.length ?? 0) > 0);
  if (!item) return null;
  if (gezienId && item.id <= gezienId) return null;
  return item;
}

export function gezienNieuwsId(): string | null {
  try {
    return window.localStorage.getItem(SLEUTEL);
  } catch {
    return null;
  }
}

export function markeerNieuwsGezien(id: string): void {
  try {
    window.localStorage.setItem(SLEUTEL, id);
  } catch {
    /* privémodus: dan zie je de kaart een volgende keer opnieuw — geen ramp */
  }
}
