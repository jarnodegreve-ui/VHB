/**
 * Verloop van een dienstruil per persoon: wie vroeg aan, wat antwoordde de
 * collega, wat besliste de planner (Jarno 20-09: "toon per chauffeur wie er al
 * geaccepteerd of geweigerd heeft").
 *
 * Twee pure stappen, gedeeld door server en client, zonder zod of React:
 *
 *  1. `verloopUitLog`  (server): logregels van één ruil → compacte stappen.
 *     De bron is het activiteitenlog (`entity_type = 'swap'`), want de
 *     swaps-tabel kent maar één `decidedAt` en zegt niet WIE weigerde. De rol
 *     van de actor beslist dat: een niet-stafrol die afwijst is de collega,
 *     een stafrol de planner. Logregels van ruilen verlopen nooit (de
 *     nachtcron slaat ze over), dus dit werkt ook voor oude ruilen.
 *  2. `persoonsVerloop` (client): ruil + stappen → twee à drie regels, één
 *     per persoon, met status, toon, moment en wie aan zet is. Werkt ook
 *     zonder stappen (log niet geladen): dan alleen wat de ruil zelf zegt, en
 *     nooit een gok over wie weigerde.
 */
import { HANDMATIGE_WISSEL_PREFIX } from './schemas/constanten.js';

export type RuilVerloopDoor = 'aanvrager' | 'collega' | 'planner';

export type RuilVerloopSoort =
  | 'aangevraagd'
  | 'geaccepteerd'
  | 'goedgekeurd'
  | 'geweigerd'
  | 'geannuleerd'
  | 'afgehandeld'
  | 'bevestigd'
  | 'ingevoerd';

export interface RuilVerloopStap {
  soort: RuilVerloopSoort;
  /** ISO-moment van de logregel. */
  op: string;
  /** Wie de stap zette; null = niet af te leiden (logregel zonder rol). */
  door: RuilVerloopDoor | null;
  /** Status vóór de stap, uit de logregel ("pending → approved"). */
  van?: string;
  /** Naam van de stafmedewerker. Alleen voor staf: een chauffeur krijgt
   *  "de planner", geen naam. */
  naam?: string;
}

/** De log-acties waaruit het verloop wordt afgeleid. De letterlijke teksten
 *  staan ook in api/index.ts (`beslisRuilIntern`, de array-route, de handmatige
 *  wissel en de gezien-bevestiging); `shared/ruilVerloop.test.ts` faalt als
 *  ze uit elkaar lopen. */
export const RUIL_LOG_ACTIES: Record<string, RuilVerloopSoort> = {
  'Dienstruil aangevraagd': 'aangevraagd',
  'Dienstruil geaccepteerd': 'geaccepteerd',
  'Dienstruil goedgekeurd': 'goedgekeurd',
  'Dienstruil afgewezen': 'geweigerd',
  'Dienstruil geannuleerd': 'geannuleerd',
  'Dienstruil voltooid': 'afgehandeld',
  'Dienstwissel bevestigd': 'bevestigd',
  'Diensten handmatig gewisseld': 'ingevoerd',
  'Dienst handmatig overgezet': 'ingevoerd',
};

export interface RuilLogRegel {
  createdAt: string;
  action: string;
  actorRole?: string | null;
  actorName?: string | null;
  details?: string | null;
}

const isStafRol = (rol: unknown) => rol === 'planner' || rol === 'admin';

/** "(pending → rejected)" uit de details van een statuswissel. */
const vorigeStatusUit = (details: unknown): string | undefined => {
  const m = /\(([a-z]+) → [a-z]+\)/.exec(String(details ?? ''));
  return m ? m[1] : undefined;
};

const doorVoor = (soort: RuilVerloopSoort, regel: RuilLogRegel, van: string | undefined): RuilVerloopDoor | null => {
  const rol = regel.actorRole ? String(regel.actorRole) : '';
  switch (soort) {
    case 'aangevraagd':
      return 'aanvrager';
    case 'geaccepteerd':
    case 'bevestigd':
      // Alleen de aangezochte collega kan accepteren of bevestigen (server).
      return 'collega';
    case 'goedgekeurd':
    case 'afgehandeld':
    case 'ingevoerd':
      return 'planner';
    case 'geweigerd':
      if (rol) return isStafRol(rol) ? 'planner' : 'collega';
      // Geen rol op de regel: een geaccepteerde ruil kan alleen de planner
      // nog afwijzen; vanuit 'pending' kan het allebei, dus dan geen gok.
      return van === 'accepted' || van === 'approved' ? 'planner' : null;
    case 'geannuleerd':
      if (rol) return isStafRol(rol) ? 'planner' : 'aanvrager';
      // Een doorgevoerde ruil terugdraaien kan alleen de planning.
      return van === 'approved' ? 'planner' : null;
  }
};

/**
 * Logregels van ÉÉN ruil → stappen, oudste eerst. `metStafNaam` alleen voor
 * staf: de naam van de planner hoort niet bij een chauffeur terecht te komen.
 * Namen van chauffeurs gaan nooit mee, de client kent hen via hun id.
 */
export function verloopUitLog(regels: readonly RuilLogRegel[], opties: { metStafNaam: boolean }): RuilVerloopStap[] {
  const stappen: RuilVerloopStap[] = [];
  for (const regel of regels) {
    const soort = RUIL_LOG_ACTIES[String(regel.action ?? '')];
    if (!soort || !regel.createdAt) continue;
    const van = vorigeStatusUit(regel.details);
    const door = doorVoor(soort, regel, van);
    const naam = opties.metStafNaam && door === 'planner' && isStafRol(regel.actorRole) ? String(regel.actorName ?? '').trim() : '';
    stappen.push({
      soort,
      op: String(regel.createdAt),
      door,
      ...(van ? { van } : {}),
      ...(naam ? { naam } : {}),
    });
  }
  return stappen.sort((a, b) => a.op.localeCompare(b.op));
}

// ---------------------------------------------------------------------------
// Per persoon
// ---------------------------------------------------------------------------

export type VerloopToon = 'succes' | 'danger' | 'neutraal';

export interface VerloopRegel {
  /** 'onbekend' = een eindstap waarvan niet geregistreerd is wie hem zette. */
  rol: 'aanvrager' | 'collega' | 'planner' | 'onbekend';
  /** Gebruiker achter de regel (aanvrager/collega). */
  userId?: string;
  /** Naam van de planner, alleen aanwezig voor staf. */
  naam?: string;
  /** Rol in deze ruil, in woorden. Bij de planner: wat hij in deze ruil doet
   *  ("Beoordeelt de ruil"), want "Planner" is al zijn naam zolang
   *  de kijker geen staf is. */
  rolLabel: string;
  status: string;
  toon: VerloopToon;
  /** Deze persoon moet nu iets doen. */
  aanZet: boolean;
  /** ISO-moment van de status. */
  op?: string;
  /** Wat deze persoon door de ruil krijgt: dienstnummer of 'vrij', met de dag.
   *  `vervallen` = de ruil ging niet door (geweigerd, ingetrokken, geannuleerd):
   *  dan is het wat hij gekregen zóu hebben. */
  krijgt?: { code: string; datum: string; overname?: boolean; vervallen?: boolean };
  /** Tweede feit bij dezelfde persoon (bevestigd, afgehandeld, eerder goedgekeurd). */
  extra?: { label: string; op?: string };
}

export interface RuilVoorVerloop {
  status: string;
  requesterId: string;
  targetDriverId?: string | null;
  createdAt?: string;
  decidedAt?: string;
  reason?: string;
  swapType?: string;
  shiftDate?: string;
  shiftLine?: string;
  returnDate?: string;
  returnCode?: string;
  targetSeenAt?: string;
  verloop?: RuilVerloopStap[];
}

export const isHandmatigeRuil = (swap: { reason?: unknown } | null | undefined): boolean =>
  String(swap?.reason ?? '').startsWith(HANDMATIGE_WISSEL_PREFIX);

const DOORGEVOERD = new Set(['approved', 'completed']);

export function persoonsVerloop(swap: RuilVoorVerloop): VerloopRegel[] {
  const stappen = Array.isArray(swap.verloop) ? swap.verloop : [];
  const laatste = (soort: RuilVerloopSoort) => {
    for (let i = stappen.length - 1; i >= 0; i--) if (stappen[i].soort === soort) return stappen[i];
    return undefined;
  };
  const status = String(swap.status);
  const overname = swap.swapType === 'overname';
  const handmatig = isHandmatigeRuil(swap);
  const collegaId = swap.targetDriverId ? String(swap.targetDriverId) : undefined;

  const geaccepteerd = laatste('geaccepteerd');
  const goedgekeurd = laatste('goedgekeurd');
  const geweigerd = laatste('geweigerd');
  const geannuleerd = laatste('geannuleerd');
  const afgehandeld = laatste('afgehandeld');
  const ingevoerd = laatste('ingevoerd');

  // Wat elk krijgt. Overname: alleen de collega krijgt iets.
  const vervallen = status === 'rejected' || status === 'cancelled' ? { vervallen: true } : {};
  const krijgtAanvrager = !overname && swap.returnCode && swap.returnDate
    ? { code: String(swap.returnCode), datum: String(swap.returnDate), ...vervallen }
    : undefined;
  const krijgtCollega = swap.shiftLine && swap.shiftDate
    ? { code: String(swap.shiftLine), datum: String(swap.shiftDate), ...(overname ? { overname: true } : {}), ...vervallen }
    : undefined;

  // Bevestiging van de nieuwe rijder ná de doorvoer (targetSeenAt). Dit is
  // géén "aanvraag gezien": dat moment wordt nergens bijgehouden.
  const bevestiging = (): VerloopRegel['extra'] => {
    if (!DOORGEVOERD.has(status)) return undefined;
    if (swap.targetSeenAt) return { label: 'Wissel bevestigd', op: String(swap.targetSeenAt) };
    return status === 'approved' ? { label: 'Wissel nog niet bevestigd' } : undefined;
  };

  // --- Handmatige wissel door de planning: geen aanvraag, geen akkoordstap.
  if (handmatig) {
    const ingevoerdOp = ingevoerd?.op ?? swap.createdAt;
    const teruggedraaid = status === 'cancelled' || status === 'rejected';
    const planner: VerloopRegel = teruggedraaid
      ? {
          rol: 'planner', rolLabel: 'Rechtstreeks in de planning gezet', naam: geannuleerd?.naam ?? geweigerd?.naam ?? ingevoerd?.naam,
          status: 'Teruggedraaid', toon: 'neutraal', aanZet: false,
          op: geannuleerd?.op ?? geweigerd?.op ?? swap.decidedAt,
          extra: ingevoerdOp ? { label: 'Ingevoerd', op: ingevoerdOp } : undefined,
        }
      : {
          rol: 'planner', rolLabel: 'Rechtstreeks in de planning gezet', naam: ingevoerd?.naam,
          status: 'Ingevoerd door de planner', toon: 'succes', aanZet: false, op: ingevoerdOp,
          extra: status === 'completed' ? { label: 'Afgehandeld', op: afgehandeld?.op } : undefined,
        };
    const bev = teruggedraaid ? undefined : bevestiging();
    return [
      planner,
      {
        rol: 'aanvrager', userId: String(swap.requesterId), rolLabel: overname ? 'Gaf de dienst af' : 'Chauffeur',
        status: 'Geen akkoord nodig', toon: 'neutraal', aanZet: false, krijgt: krijgtAanvrager,
      },
      {
        rol: 'collega', userId: collegaId, rolLabel: overname ? 'Rijdt de dienst' : 'Chauffeur',
        ...(swap.targetSeenAt && !teruggedraaid
          ? { status: 'Bevestigd', toon: 'succes' as const, aanZet: false, op: String(swap.targetSeenAt) }
          : { status: bev ? 'Nog niet bevestigd' : 'Geen akkoord nodig', toon: 'neutraal' as const, aanZet: !!bev }),
        krijgt: krijgtCollega,
      },
    ];
  }

  // --- Aanvrager
  const ingetrokken = status === 'cancelled' && geannuleerd?.door === 'aanvrager';
  const aanvrager: VerloopRegel = ingetrokken
    ? {
        rol: 'aanvrager', userId: String(swap.requesterId), rolLabel: 'Aanvrager',
        status: 'Ingetrokken', toon: 'neutraal', aanZet: false, op: geannuleerd!.op,
        extra: swap.createdAt ? { label: 'Aangevraagd', op: swap.createdAt } : undefined,
        krijgt: krijgtAanvrager,
      }
    : {
        rol: 'aanvrager', userId: String(swap.requesterId), rolLabel: 'Aanvrager',
        status: 'Aangevraagd', toon: 'neutraal', aanZet: false,
        op: swap.createdAt ?? laatste('aangevraagd')?.op, krijgt: krijgtAanvrager,
      };

  // --- Collega
  const collegaBasis = { rol: 'collega' as const, userId: collegaId, rolLabel: 'Collega', krijgt: krijgtCollega };
  const akkoord = (): Pick<VerloopRegel, 'status' | 'toon' | 'aanZet' | 'op'> =>
    ({ status: 'Geaccepteerd', toon: 'succes', aanZet: false, op: geaccepteerd?.op });
  const geenAntwoord = (tekst: string): Pick<VerloopRegel, 'status' | 'toon' | 'aanZet'> =>
    ({ status: tekst, toon: 'neutraal', aanZet: false });
  let collega: VerloopRegel;
  if (status === 'pending') {
    collega = { ...collegaBasis, status: 'Wacht op antwoord', toon: 'neutraal', aanZet: true };
  } else if (status === 'accepted') {
    collega = { ...collegaBasis, ...akkoord() };
  } else if (status === 'rejected' && geweigerd?.door === 'collega') {
    collega = { ...collegaBasis, status: 'Geweigerd', toon: 'danger', aanZet: false, op: geweigerd.op };
  } else if (geaccepteerd) {
    collega = { ...collegaBasis, ...akkoord() };
  } else if (goedgekeurd?.van === 'pending') {
    // Een admin keurde rechtstreeks goed, zonder het antwoord af te wachten.
    collega = { ...collegaBasis, ...geenAntwoord('Antwoord niet afgewacht') };
  } else if (stappen.length === 0 || (status === 'rejected' && !geweigerd?.door)) {
    collega = { ...collegaBasis, ...geenAntwoord('Antwoord niet geregistreerd') };
  } else {
    collega = { ...collegaBasis, ...geenAntwoord('Geen antwoord gegeven') };
  }
  if (DOORGEVOERD.has(status)) collega.extra = bevestiging();

  // --- Planner
  const plannerBasis = { rol: 'planner' as const, rolLabel: 'Beoordeelt de ruil' };
  let planner: VerloopRegel;
  let onbekend: VerloopRegel | undefined;
  if (status === 'pending') {
    planner = { ...plannerBasis, status: 'Wacht op collega', toon: 'neutraal', aanZet: false };
  } else if (status === 'accepted') {
    planner = { ...plannerBasis, status: 'Te beoordelen', toon: 'neutraal', aanZet: true };
  } else if (DOORGEVOERD.has(status)) {
    planner = {
      ...plannerBasis, naam: goedgekeurd?.naam, status: 'Goedgekeurd', toon: 'succes', aanZet: false,
      op: goedgekeurd?.op ?? swap.decidedAt,
      extra: status === 'completed' ? { label: 'Afgehandeld', op: afgehandeld?.op } : undefined,
    };
  } else if (status === 'rejected') {
    if (geweigerd?.door === 'planner') {
      planner = { ...plannerBasis, naam: geweigerd.naam, status: 'Geweigerd', toon: 'danger', aanZet: false, op: geweigerd.op };
    } else if (geweigerd?.door === 'collega') {
      planner = { ...plannerBasis, status: 'Niet meer nodig', toon: 'neutraal', aanZet: false };
    } else {
      planner = { ...plannerBasis, status: 'Geen beoordeling geregistreerd', toon: 'neutraal', aanZet: false };
      onbekend = {
        rol: 'onbekend', rolLabel: 'Niet geregistreerd door wie', status: 'Geweigerd', toon: 'danger', aanZet: false,
        op: geweigerd?.op ?? swap.decidedAt,
      };
    }
  } else if (geannuleerd?.door === 'planner') {
    planner = {
      ...plannerBasis, naam: geannuleerd.naam, status: 'Geannuleerd', toon: 'neutraal', aanZet: false, op: geannuleerd.op,
      extra: goedgekeurd ? { label: 'Eerder goedgekeurd', op: goedgekeurd.op } : undefined,
    };
  } else if (ingetrokken) {
    planner = { ...plannerBasis, status: 'Niet meer nodig', toon: 'neutraal', aanZet: false };
  } else {
    planner = { ...plannerBasis, status: 'Geen beoordeling geregistreerd', toon: 'neutraal', aanZet: false };
    onbekend = {
      rol: 'onbekend', rolLabel: 'Niet geregistreerd door wie', status: 'Geannuleerd', toon: 'neutraal', aanZet: false,
      op: geannuleerd?.op ?? swap.decidedAt,
    };
  }

  // Een ruil zonder aangezochte collega (oude open verzoeken) heeft geen
  // collega-regel: er is niemand om op te wachten.
  const regels = collegaId ? [aanvrager, collega, planner] : [aanvrager, planner];
  return onbekend ? [...regels, onbekend] : regels;
}
