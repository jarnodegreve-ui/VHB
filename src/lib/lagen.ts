import { useEffect, useRef } from 'react';
import { vergrendelScroll } from './scrollSlot';

/**
 * De lagenstapel van het portaal (polish P2a, 24-09): één bron voor alles wat
 * boven de pagina ligt (Modal, SlideOver, Sheet, mobiele zijbalk, menu's,
 * datumkiezer, popovers). Regel (Jarno 24-09): Escape, de terugknop, het
 * kruisje, de achtergrond en Annuleren sluiten precies één laag, de bovenste.
 *
 * Wat hier samenkomt:
 * - **Stapel in openvolgorde.** Escape sluit alleen de bovenste laag die op
 *   Escape reageert (één globale luisteraar), dus een bevestiging boven een
 *   zijpaneel klapt niet samen met dat paneel dicht.
 * - **Historiek.** Een laag met `historie` krijgt een eigen entry: de
 *   terugknop of swipe-back sluit hem i.p.v. de app te verlaten. Een popstate
 *   sluit precies de lagen waarvan de entry verdween (van boven naar onder);
 *   een laag met onbewaarde invoer mag weigeren (`sluit` geeft false), dan
 *   komt zijn entry terug op de URL van vóór de terugstap.
 * - **Gebundeld opruimen.** Sluit een laag in code (knop, Escape, opslaan),
 *   dan moet zijn entry weg. Sluiten er meerdere in dezelfde taak ("Niet
 *   bewaren": vraag én formulier; verwijderen vanuit een paneel: bevestiging
 *   én paneel), dan gaan hun entries samen weg met één `history.go(-n)`.
 *   Vroeger deed elke laag zelf een uitgestelde back(), zag de tweede nog de
 *   entry van de eerste bovenaan en liet de zijne staan: een dode terugstap.
 * - **Overname.** Opent een laag in dezelfde commit als een andere sluit
 *   (menu-item dat een modal opent), dan neemt hij de entry van de gesloten
 *   laag over (replaceState) i.p.v. er een tweede bovenop te zetten.
 * - **Scroll-lock.** `scrollSlot` koppelt de laag aan het ene lock-mechanisme
 *   (src/lib/scrollSlot.ts), op dezelfde levensloop als de laag.
 *
 * De router roept `verwerkOverlayPop(e)` als eerste popstate-luisteraar aan
 * (src/app/router.ts), zodat een weigering of een URL-correctie klaar is
 * vóór hij de URL leest; luisteraarvolgorde op Window verschilt per browser.
 */

type Sluit = () => void | boolean;

type Laag = {
  id: string;
  sluit: { current: Sluit };
  escape: boolean;
  soort: string;
  /** History-state van zijn entry (null = laag zonder historie). */
  staat: Record<string, unknown> | null;
};

/** Een entry van ons in de browserhistoriek, onderaan eerst. */
type Entry = { id: string; nr: number; urlOnder: string; levend: boolean; ouder?: string };

let teller = 0;
/** Per pagina-lading anders, zie het id in useLaag. */
const SESSIE = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let laatsteNr = 0;
/** Volgnummer in history.state: ook over een herlaad heen oplopend. */
const volgNr = () => { laatsteNr = Math.max(Date.now() * 1000, laatsteNr + 1); return laatsteNr; };

const stapel: Laag[] = [];
const entries: Entry[] = [];
/** Lopende eigen traversal (`history.go(-n)`) die nog moet aankomen. */
let onderweg: { ids: Set<string>; urlBijSluiten: string; urlOnder: string } | null = null;
let opruimTimer: ReturnType<typeof setTimeout> | null = null;
/** Wat er moet gebeuren zodra het opruimen klaar is (zie `naOpruimen`). */
const daarna: Array<() => void> = [];
/** Laatst bekende URL: de plek waar een weigerende laag zijn entry terugzet. */
let urlNu = '';
let laatsteEvent: Event | null = null;
let luistert = false;

const hier = () => window.location.pathname + window.location.search + window.location.hash;
const isLevend = (id: string) => stapel.some((l) => l.id === id);

/** De router (en elke andere schrijver van de URL) meldt hier een nieuwe URL. */
export function meldUrl() {
  if (typeof window !== 'undefined') urlNu = hier();
}

/** Is `id` de bovenste laag, eventueel alleen onder de lagen van één soort? */
export function isBovensteLaag(id: string, soort?: string) {
  for (let i = stapel.length - 1; i >= 0; i--) {
    if (soort && stapel[i].soort !== soort) continue;
    return stapel[i].id === id;
  }
  return false;
}

/** De router nam de entry van laag `id` over voor een nieuwe pagina: die
 *  entry is niet meer van ons en hoeft niet opgeruimd te worden. */
export function vergeetLaagEntry(id: string) {
  const i = entries.findIndex((e) => e.id === id);
  if (i !== -1) entries.splice(i, 1);
}

/** Voor tests en diagnose: de soorten van de open lagen, onderaan eerst. */
export const openLagen = (): string[] => stapel.map((l) => l.soort);

/**
 * Voer `fn` uit zodra de historiek na het sluiten van lagen weer schoon is
 * (na de gebundelde `history.go(-n)`), of meteen in de volgende taak als er
 * niets op te ruimen valt. Voor een actie die de pagina verlaat nadat een
 * vraag en zijn formulier dichtgingen, zodat er geen wees achterblijft.
 */
export function naOpruimen(fn: () => void) {
  daarna.push(fn);
  // Eén taak later plannen: de lagen die door dezelfde actie sluiten, moeten
  // eerst hun opruiming aanmelden (React-commit en effect-opruiming).
  setTimeout(planOpruimen, 0);
}

function draaiDaarna() {
  for (const fn of daarna.splice(0)) fn();
}

function planOpruimen() {
  if (opruimTimer !== null || typeof window === 'undefined') return;
  // Een taak uitgesteld: een laag die in dezelfde commit opent, neemt eerst
  // de entry van de gesloten laag over.
  opruimTimer = setTimeout(ruimOp, 0);
}

function ruimOp() {
  opruimTimer = null;
  if (typeof window === 'undefined') return;
  if (onderweg) return; // na aankomst opnieuw
  const top = (window.history.state as { vhbOverlay?: unknown } | null)?.vhbOverlay;
  const i = entries.findIndex((e) => e.id === top);
  if (i === -1) {
    // De bovenste entry is niet (meer) van ons: een schermwissel verving hem.
    // Wat eronder ligt kunnen we niet bereiken zonder die pagina te verlaten.
    for (let j = entries.length - 1; j >= 0; j--) if (!entries[j].levend) entries.splice(j, 1);
    draaiDaarna();
    return;
  }
  let n = 0;
  while (i - n >= 0 && !entries[i - n].levend) n++;
  if (n === 0) { draaiDaarna(); return; }
  const weg = entries.slice(i - n + 1, i + 1);
  let urlOnder = weg[0].urlOnder;
  // Het record van een koude start is gesloten (de URL staat al op de lijst):
  // de recordstap eronder gaat mee, anders bleef er een tweede lijst staan.
  if (weg[0].ouder && hier() === weg[0].ouder) { n++; urlOnder = weg[0].ouder; }
  onderweg = { ids: new Set(weg.map((e) => e.id)), urlBijSluiten: hier(), urlOnder };
  zorgVoorLuisteraars();
  window.history.go(-n);
}

/** Popstate verwerken: eigen traversal afronden, of de lagen sluiten waarvan
 *  de entry verdween. Idempotent per event (router én eigen luisteraar). */
export function verwerkOverlayPop(e?: Event) {
  if (typeof window === 'undefined') return;
  if (e) {
    if (e === laatsteEvent) return;
    laatsteEvent = e;
  }
  const urlVoorPop = urlNu;
  const staat = window.history.state as { vhbOverlay?: unknown; vhbLaagNr?: unknown } | null;
  if (onderweg) {
    const o = onderweg;
    onderweg = null;
    for (let j = entries.length - 1; j >= 0; j--) if (o.ids.has(entries[j].id)) entries.splice(j, 1);
    // Een recordselectie verving de lijst-URL vóór het paneel opende: na de
    // terugstap staat die oude detail-URL weer bovenaan. Zet de URL van het
    // moment van sluiten terug, zodat een gesloten paneel niet heropent.
    if (o.urlBijSluiten !== o.urlOnder && hier() === o.urlOnder) {
      window.history.replaceState(window.history.state, '', o.urlBijSluiten);
    }
    meldUrl();
    // Een terugknop die tegelijk met onze stap kwam, kan de browser in één
    // traversal samenvoegen: staan er nog levende entries boven de plek waar
    // we landden, dan verwerken we die hieronder als een gewone terugstap.
    const nrNu = typeof staat?.vhbOverlay === 'string' && typeof staat.vhbLaagNr === 'number' ? staat.vhbLaagNr : -1;
    if (!entries.some((x) => x.levend && x.nr > nrNu)) {
      // Intussen nog iets gesloten? Dan opnieuw; anders is het klaar.
      if (entries.some((x) => !x.levend)) planOpruimen();
      else draaiDaarna();
      return;
    }
  }
  const nr = typeof staat?.vhbOverlay === 'string' && typeof staat.vhbLaagNr === 'number' ? staat.vhbLaagNr : -1;
  // Entries boven de plek waar we nu staan zijn weg (terug, of meerdere
  // stappen tegelijk); van boven naar onder verwerken.
  const weg = entries.filter((x) => x.nr > nr).reverse();
  for (let j = entries.length - 1; j >= 0; j--) if (entries[j].nr > nr) entries.splice(j, 1);
  // Alleen entries van net gesloten lagen weg, nog vóór ons opruimen liep
  // (een terugknop binnen dezelfde taak als het sluiten): die terugstap was
  // voor de gebruiker onzichtbaar. Hij geldt dan voor de volgende laag.
  if (weg.length > 0 && weg.every((x) => !x.levend) && opruimTimer !== null) {
    meldUrl();
    window.history.back();
    return;
  }
  const lagen = weg.filter((x) => x.levend).map((x) => stapel.find((l) => l.id === x.id)).filter((l): l is Laag => !!l);
  for (let k = 0; k < lagen.length; k++) {
    const laag = lagen[k];
    if (laag.sluit.current() !== false) continue;
    // Weigering (onbewaarde invoer): deze laag en de lagen eronder die ook
    // hun entry kwijt waren, blijven open. Hun entries komen terug, op de
    // URL van vóór de terugstap, zodat ook de router geen wissel ziet.
    const blijven = lagen.slice(k).reverse();
    for (const b of blijven) {
      const oud = weg.find((x) => x.id === b.id)!;
      const s = { ...b.staat, vhbLaagNr: volgNr() };
      b.staat = s;
      window.history.pushState(s, '', urlVoorPop || hier());
      entries.push({ ...oud, nr: s.vhbLaagNr as number, levend: true });
    }
    break;
  }
  meldUrl();
}

function opEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
  for (let i = stapel.length - 1; i >= 0; i--) {
    const laag = stapel[i];
    if (!laag.escape) continue;
    e.preventDefault();
    laag.sluit.current();
    return;
  }
}

function zorgVoorLuisteraars() {
  if (luistert || typeof window === 'undefined') return;
  luistert = true;
  window.addEventListener('popstate', (e) => verwerkOverlayPop(e));
  window.addEventListener('keydown', opEscape);
}

export type LaagOpties = {
  open: boolean;
  /** Sluit de laag; false = weigert (onbewaarde invoer, lopende actie). */
  sluit: Sluit;
  /** Eigen history-entry: de terugknop sluit deze laag (standaard aan). */
  historie?: boolean;
  /** Escape sluit deze laag als hij bovenaan ligt (standaard aan). */
  escape?: boolean;
  /** Soort, voor `isBovensteLaag(id, soort)` (focus-trap van dialogen). */
  soort?: string;
  /** Eigenaar van de scroll-lock zolang de laag open is (src/lib/scrollSlot.ts). */
  scrollSlot?: string;
};

/**
 * Laat een laag meedoen met de stapel. Geeft `isBovenste(soort?)` terug.
 */
export function useLaag({ open, sluit, historie = true, escape = true, soort = 'laag', scrollSlot }: LaagOpties) {
  const sluitRef = useRef<Sluit>(sluit);
  sluitRef.current = sluit;
  const idRef = useRef('');

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    zorgVoorLuisteraars();
    // Uniek over een herlaad heen: de history-state overleeft een herlaad,
    // de teller niet. Met alleen de teller kreeg het heropende paneel het id
    // van zijn eigen oude entry, zag die als levend i.p.v. als wees en zette
    // er een tweede entry bovenop (dode terugstap na herladen).
    const id = `overlay-${SESSIE}-${++teller}`;
    idRef.current = id;
    const laag: Laag = { id, sluit: sluitRef, escape, soort, staat: null };
    stapel.push(laag);
    if (historie) {
      const vorige = window.history.state;
      const basis: Record<string, unknown> = vorige && typeof vorige === 'object' ? vorige : {};
      const bovenste = basis.vhbOverlay;
      // Wees-entry van een net gesloten laag (zelfde commit, of van vóór een
      // herlaad): overnemen, tenzij onze eigen terugstap er al naartoe loopt.
      const wees = typeof bovenste === 'string' && !isLevend(bovenste) && !(onderweg?.ids.has(bovenste));
      const bekend = wees ? entries.findIndex((x) => x.id === bovenste) : -1;
      const urlOnder = wees
        ? (bekend !== -1 ? entries[bekend].urlOnder : typeof basis.vhbOverlayTerug === 'string' ? basis.vhbOverlayTerug : hier())
        : hier();
      const staat: Record<string, unknown> = { ...basis, vhbOverlay: id, vhbLaagNr: volgNr(), vhbOverlayTerug: urlOnder };
      // Het merkteken van de recordstap hoort bij die entry, niet bij de onze.
      delete staat.vhbOuderStap;
      laag.staat = staat;
            // Ligt eronder de recordstap van een koude start (router.ts,
      // zetOuderStap), dan onthouden we de lijst eronder: sluit deze laag
      // terwijl de URL al op de lijst staat, dan gaat die stap mee weg.
      const ouder = !wees && basis.vhbOuderStap === true && typeof basis.vhbOverlayTerug === 'string' ? basis.vhbOverlayTerug : undefined;
      const entry: Entry = { id, nr: staat.vhbLaagNr as number, urlOnder, levend: true, ouder };
      if (wees) {
        window.history.replaceState(staat, '');
        if (bekend !== -1) entries[bekend] = entry;
        else entries.push(entry);
      } else {
        window.history.pushState(staat, '');
        entries.push(entry);
      }
      meldUrl();
    }
    const vrijgeven = scrollSlot ? vergrendelScroll(scrollSlot) : null;
    return () => {
      vrijgeven?.();
      const i = stapel.indexOf(laag);
      if (i !== -1) stapel.splice(i, 1);
      const entry = entries.find((x) => x.id === id);
      // Entry nog in de historiek (programmatisch gesloten): opruimen.
      if (entry) {
        entry.levend = false;
        planOpruimen();
      }
    };
    // Opties horen bij het openen; wisselen terwijl de laag open is telt niet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { isBovenste: (s?: string) => isBovensteLaag(idRef.current, s) };
}

/**
 * Oude vorm (tranche 1): een laag met history-entry, zonder eigen Escape.
 * Blijft voor aanroepers en tests die alleen de terugknop nodig hebben.
 */
export function useHistoryDismiss(open: boolean, onClose: () => void | boolean) {
  useLaag({ open, sluit: onClose, historie: true, escape: false });
}
