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

/**
 * Kaart uitgezet op vraag van Jarno (13-09): het overzicht met nieuwigheden
 * verschijnt nergens meer. De items blijven bestaan voor de changelog
 * (`npm run changelog`); zet op true om de kaart weer te tonen.
 */
export const WAT_IS_NIEUW_TONEN = false;

export const WAT_IS_NIEUW: WatIsNieuwItem[] = [
  {
    id: '2026-09-17',
    titel: 'Werkvoorraad op één scherm',
    regels: {
      staf: [
        'Nieuw scherm Werkvoorraad (Beheer › Planning): alles wat op een beslissing wacht, oudste eerst, met een filter per soort.',
        'Het Open taken-paneel op het dashboard en het menu in de topbar linken er nu naartoe in plaats van “+N niet getoond”.',
      ],
    },
    bekijk: { staf: 'werkvoorraad' },
  },
  {
    id: '2026-09-16',
    titel: 'Dienstwissel 1-op-1, verloftelling en defect melden',
    regels: {
      chauffeur: [
        'Bij “Defect melden” staan alleen nog bussen en bedrijfswagens in de keuzelijst.',
      ],
      staf: [
        'Maandplanning: een handmatige dienstwissel kan nu ook tussen twee chauffeurs die die dag allebei rijden, ze wisselen dan hun diensten 1-op-1.',
        'Wie een dienst afstaat aan een collega op TA (of een andere code) wordt vrij, de code van de collega verhuist niet mee.',
        'Verloflimiet: flexi-jobs tellen niet meer mee in de bezetting per dag.',
      ],
    },
    bekijk: { staf: 'bezetting' },
  },
  {
    id: '2026-09-15',
    titel: 'Techniek: categorieën en papieren gele boek',
    regels: {
      chauffeur: [
        'Bij “Defect melden” toont de keuzelijst alleen nog het busnummer zoals het op de bus staat.',
      ],
      staf: [
        'Voertuigen hebben een categorie (bus, bedrijfswagen, privéwagen) met een filter in de lijst en een veld op de fiche.',
        'Gele boek › Afdrukken: het huidige overzicht (open of alles) als printblad voor de ISO-map.',
      ],
    },
    bekijk: { staf: 'voertuigen' },
  },
  {
    id: '2026-09-14',
    titel: 'Dagafsluiting en looncontrole',
    regels: {
      staf: [
        'Beheer › Dagafsluiting: open een dag (de planning van die dag wordt gekopieerd, met ruilen en verlof), pas aan wie werkelijk wat reed, vul overminuten, premie en kwaliteitsvlaggen in en sluit de dag af. Dit vervangt het dagelijks intikken in Access.',
        'Beheer › Looncontrole: maandraster met de stand per dag, de controle vóór de Easypay-export (open dagen, ontbrekende matricules of codes) en de CSV-download; tabbladen voor de looncodes (dienstnummer → Easypay) en de matricules.',
        'Beheer › Dienstopbouw: importeer de ET-export van De Lijn (ritdelen per dienst en dagtype), zie de controles (gaten, overlap, snelheid), activeer een versie, bekijk per dienst de ritdelen, het ritblad uit data en de loonparameters, en leid de tiktijden en looncomponenten af naar de looncodes.',
      ],
    },
    bekijk: { staf: 'dagafsluiting' },
  },
  {
    id: '2026-09-13',
    titel: 'Techniek: gele boek, voertuigen en werkprestaties',
    regels: {
      chauffeur: [
        'Iets mis met de bus? Op Mijn dag en het dashboard staat “Defect melden”: kies de bus, de soort en beschrijf het, en de garage ziet het meteen in het gele boek.',
      ],
      staf: [
        'Nieuwe sectie Techniek: het gele boek (open defecten per bus, ouderdom, afhandelen), Voertuigen (het wagenpark met keuring SBAT, brandblussers en tachograaf) en Werkprestaties (wat de garage per dag aan welke bus deed, met rapport per bus en per technieker).',
        'Techniekers krijgen dezelfde schermen in hun menu; vervaldata van voertuigen komen in de dagelijkse digest en als melding op 60/30/7/0 dagen.',
      ],
    },
    bekijk: { staf: 'defecten' },
  },
  {
    id: '2026-09-09',
    titel: 'Laadpalen: maandrapport, historiek en sessies',
    regels: {
      staf: [
        'Laadpalen heeft vier tabbladen: Live (wat er nu aan de lader hangt), Maand (verbruik, kwartierpiek en laadsessies per dag en per laadpunt, ook voor een vrije periode), Historiek (alle maanden naast elkaar, jaartotalen, laadpunt per maand) en Sessies (elke laadsessie met duur, vermogen en batterijstand).',
        'Excel-export van een maand of periode (Overzicht · Per dag · Per laadpunt · Sessies) en van de hele historiek; CSV per tabel.',
        'Klik op een dag voor de kwartiercurve en de sessies van die dag. Dagpieken blijven voortaan permanent bewaard, zodat de maandpiek van elke maand terug te vinden is.',
      ],
    },
    bekijk: { staf: 'ocpi-monitoring' },
  },
  {
    id: '2026-09-08',
    titel: 'Beveiliging op één plek',
    regels: {
      chauffeur: [
        'Instellingen › Beveiliging: zie je laatste aanmeldingen en zet “Gedeeld toestel” aan op de tablet in het lokaal, dan meldt het portaal je na een half uur stilte vanzelf af.',
      ],
      staf: [
        'Twee-stapsverificatie: planners en beheerders melden zich aan met wachtwoord én een code uit een authenticator-app. Instellen via Instellingen › Beveiliging.',
        'Laatste aanmeldingen en “Gedeeld toestel” (automatisch afmelden na een half uur) staan in dezelfde sectie.',
        'Onderhoudsmodus (beheerder): zet in Instellingen › Beheer een banner aan voor iedereen en pauzeer desgewenst alle wijzigingen, bijvoorbeeld tijdens een migratie.',
        'Foutschermen tonen nu een korte referentie; in Systeemstatus › Fouten staat dezelfde code bij de foutgroep, zodat je een melding van een chauffeur meteen terugvindt.',
      ],
    },
    bekijk: { chauffeur: 'instellingen', staf: 'instellingen' },
  },
  {
    id: '2026-09-07',
    titel: 'Uit dienst in één handeling',
    regels: {
      staf: [
        'Gebruikersbeheer: “Uit dienst” in het rijmenu deactiveert het account, trekt alle toestellen in en stopt de pushmeldingen in één keer (admin).',
      ],
    },
  },
  {
    id: '2026-09-06',
    titel: 'Meldingen, offline en je eigen dashboard',
    regels: {
      chauffeur: [
        'Meldingen: alles wat de planning je stuurde, beslissing, ruil, update, staat achter de bel bovenaan, ook zonder pushmeldingen.',
        'Mijn dag en je ritblad werken nu ook zonder bereik: je ziet de laatst geladen gegevens en het opgeslagen blad.',
        'Dashboard aanpassen: verberg tegels of zet ze in je eigen volgorde via het menu rechtsboven.',
      ],
      staf: [
        'Meldingen: verlofaanvragen, ruilen en ziekmeldingen staan achter de bel bovenaan, ook zonder pushmeldingen.',
        'Chauffeurs zien Mijn dag en hun ritblad ook zonder bereik.',
        'Dashboard aanpassen: tegels verbergen of herschikken via het menu bovenaan de cockpit.',
      ],
    },
    bekijk: { chauffeur: 'meldingen', staf: 'meldingen' },
  },
  {
    id: '2026-09-05',
    titel: 'Mijn dag en ritblad',
    regels: {
      chauffeur: [
        'Ritblad van vandaag opent meteen jouw blad: de pagina van je dienstnummer, met zoom.',
        'Mijn dag: één balk van start tot einde met je pauzes en de tijd van nu.',
        'Op het dashboard zie je in de Vandaag-tegel hoelang je nog moet.',
      ],
      staf: [
        'Mijn dag en de Vandaag-tegel tonen de dienst als één balk met pauzes en de tijd van nu.',
        'Ritblad van vandaag opent voor chauffeurs meteen de pagina van hun dienstnummer.',
      ],
    },
    bekijk: { chauffeur: 'mijn-dag' },
  },
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
        'Lijst en detail naast elkaar op een breed scherm.',
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
