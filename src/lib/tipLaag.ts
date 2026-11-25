/**
 * Tip-laag (ronde 6, punt 10): de uitleg bij een icoonknop in de huisstijl,
 * alleen voor wie met een muis werkt. Lui geladen door App.tsx bij de eerste
 * muisbeweging (`(hover: hover) and (pointer: fine)`); een touch-toestel
 * haalt deze module nooit op. Zolang ze niet geladen is, of als het laden
 * mislukt, houdt elke knop zijn systeemtooltip: IconButton zelf is
 * ongewijzigd (`title={rest.title ?? label}` in primitives.tsx).
 *
 * Welke knoppen: `button[aria-label][title]`, niet uitgeschakeld, met een
 * `title` exact gelijk aan de `aria-label` (IconButton zonder eigen title, en
 * elke knop die hetzelfde patroon volgt). Een eigen title (een reden bij een
 * uitgeschakelde knop) of een uitgeschakelde knop houdt zijn systeemtooltip.
 * De tekst van de tip is de `aria-label`.
 *
 * De systeemtooltip: wijst de muis een knop aan, dan haalt de laag zijn
 * `title` weg; verdwijnt de tip, om welke reden ook, dan zet ze precies die
 * waarde terug, alleen als de knop nog in de DOM staat en op dat moment
 * geen title heeft (een eigen title die React intussen zette, blijft dus
 * staan). Bij toetsenbordfocus blijft de title staan: een systeemtooltip
 * verschijnt niet bij focus.
 *
 * Wanneer: na 300 ms wijzen met de muis (zonder wachttijd van tip naar tip),
 * of meteen als Tab de focus op de knop zet. Focus die een menu, kiezer of
 * venster na Escape aan zijn knop teruggeeft, krijgt geen tip: anders slikte
 * die tip de volgende Escape, die voor de laag eronder bedoeld is. Weg bij:
 * muis eraf, een druk, scroll of wiel, blur, een verborgen tabblad, een laag
 * met Escape die opengaat, en als de knop verdwijnt, verschuift of niet meer
 * aan de regel voldoet (controle elke 250 ms zolang de tip staat). Een
 * wissel van title, naam of `disabled` op de knop zelf ziet de laag meteen
 * (MutationObserver): een title die React terugzet staat er dus nooit naast
 * de tip, en de tip volgt een nieuw label.
 *
 * Eén tip voor de hele app: één element, `position: fixed`, rechtstreeks in
 * de body (geen voorouder die knipt), geplaatst uit het vak van de knop
 * (`plaatsTip`), `pointer-events: none` en `aria-hidden` (de knop draagt de
 * tekst al als naam).
 *
 * Escape en de lagen (tip-escape, 25-11): Escape verbergt een zichtbare tip.
 * Ligt de knop in dezelfde laag als de focus (een icoonknop in een venster),
 * of staan ze allebei in de pagina, dan gaat de Escape niet verder: lagen.ts
 * (luistert op window) laat de open laag staan, een tweede Escape sluit ze.
 * Ligt de knop onder of naast de laag van de focus (de kalenderknop onder een
 * open kalender), dan gaat dezelfde Escape gewoon door en sluit die laag,
 * zoals zonder tip. De laag van een element is zijn dichtstbijzijnde
 * container met de rol van een venster, kiezer of menu (Modal, SlideOver,
 * Sheet, DatePicker, MaandInput, ActieMenu, Popover, AnkerPopover), of met
 * `data-laag` (het inline DetailPaneel, dat geen dialoog is). Gaat er een
 * laag met Escape open (lagen.ts meldt het via `bijLaagOpen`), dan verdwijnt
 * de tip, ook een die nog wacht; de knop waar de muis dan op staat, krijgt
 * pas weer een tip als de muis eraf en er opnieuw op gaat.
 */

import { bijLaagOpen } from './lagen';

const SELECTOR = 'button[aria-label][title]';
/** De container van een laag: venster, kiezer, menu, of het inline DetailPaneel (`data-laag`). */
const LAAG = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-laag]';
/** Wachttijd met de muis voor de tip verschijnt. */
export const WACHT_MS = 300;
/** Ritme van de controle zolang de tip staat (weg, verschoven, nieuw label). */
export const CONTROLE_MS = 250;
/** Afstand tot de schermrand. */
export const MARGE = 8;
/** Afstand tussen knop en tip. */
export const AFSTAND = 6;
/** Zoveel mag de knop bewegen (afronding, een veer die uitloopt) voor hij "verschoven" is. */
const SPELING = 2;

/** Uiterlijk zoals de vroegere Tooltip.tsx: omgekeerde tegel, in licht donker en in donker licht.
 *  Beweging: alleen opacity, in op `--duration-fast` met de standaardcurve `--ease-standard`
 *  (dezelfde tokens als DUR.fast en EASE in motion.ts, hier als klassen; uit de startbundel
 *  importeert deze module alleen `bijLaagOpen` van lagen.ts); reduced motion zet elke transitie
 *  in index.css op nul. Weg is meteen (`hidden`). */
const KLASSEN = 'pointer-events-none fixed z-tip w-max rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-slate-50 elev-2 transition-opacity duration-fast';

type Vak = { left: number; top: number; width: number; height: number };
type Maat = { width: number; height: number };

/**
 * Plaats van de tip (puur): gecentreerd boven de knop, eronder als er boven
 * geen plaats is (past hij nergens, dan aan de ruimste kant), horizontaal
 * binnen `marge` van de rand. Een tip breder dan het venster begint op de marge.
 */
export function plaatsTip(knop: Vak, tip: Maat, venster: Maat, marge = MARGE, afstand = AFSTAND): { left: number; top: number; kant: 'boven' | 'onder' } {
  const onderkant = knop.top + knop.height;
  const ruimteBoven = knop.top - afstand - marge;
  const ruimteOnder = venster.height - onderkant - afstand - marge;
  const kant = tip.height <= ruimteBoven ? 'boven'
    : tip.height <= ruimteOnder ? 'onder'
      : ruimteBoven >= ruimteOnder ? 'boven' : 'onder';
  const top = kant === 'boven' ? knop.top - afstand - tip.height : onderkant + afstand;
  const midden = knop.left + knop.width / 2 - tip.width / 2;
  const left = Math.max(marge, Math.min(midden, venster.width - marge - tip.width));
  return { left: Math.round(left), top: Math.round(top), kant };
}

/** Past de regel op deze knop: niet uitgeschakeld en title exact gelijk aan aria-label. */
export function geschikt(knop: Element | null): knop is HTMLButtonElement {
  if (!(knop instanceof HTMLButtonElement) || knop.disabled) return false;
  const naam = knop.getAttribute('aria-label');
  return !!naam && knop.getAttribute('title') === naam;
}

let gestart = false;
let tip: HTMLDivElement | null = null;
/** De knop van de tip (wachtend of zichtbaar). Een verwijzing, geen zoekopdracht:
 *  zonder title past `closest(SELECTOR)` niet meer op hem. */
let huidig: HTMLButtonElement | null = null;
let bron: 'muis' | 'focus' | null = null;
/** De title die de laag weghaalde (null = ze staat er nog). */
let weggehaald: string | null = null;
let zichtbaar = false;
let toonTimer: ReturnType<typeof setTimeout> | undefined;
let controleTimer: ReturnType<typeof setInterval> | undefined;
/** Vak van de knop bij het plaatsen: verschuift het, dan gaat de tip weg. */
let plek: DOMRect | null = null;
/** Volgt title, naam en `disabled` van de knop zolang hij de tip heeft (wachtend of zichtbaar). */
let waarnemer: MutationObserver | null = null;
const VOLG: MutationObserverInit = { attributes: true, attributeFilter: ['title', 'aria-label', 'disabled'] };
/** Tot wanneer de volgende tip zonder wachttijd verschijnt (van tip naar tip). */
let warmTot = 0;
/** De focus komt van Tab (tussen keydown en keyup): alleen dan een tip bij focus.
 *  Focus die een menu of kiezer na Escape teruggeeft, toont er geen. */
let viaTab = false;
/** De knop waarvan een laag die openging de tip wegnam: zolang de muis erop blijft, geen nieuwe tip. */
let gedoofd: HTMLButtonElement | null = null;

/** De laag waarin een element ligt, of null voor de pagina. */
const laagVan = (el: Element | null) => el?.closest(LAAG) ?? null;

const verschoven = (r: DOMRect) => !plek
  || Math.abs(r.left - plek.left) > SPELING || Math.abs(r.top - plek.top) > SPELING
  || Math.abs(r.width - plek.width) > SPELING || Math.abs(r.height - plek.height) > SPELING;

function haalTitelWeg(knop: HTMLButtonElement) {
  const titel = knop.getAttribute('title');
  if (titel === null) return;
  weggehaald = titel;
  knop.removeAttribute('title');
}

function zetTerug(knop: HTMLButtonElement, titel: string) {
  if (knop.isConnected && !knop.hasAttribute('title')) knop.setAttribute('title', titel);
}

/** Verberg de tip (meteen, zonder uitgang) en zet de title terug. */
export function verbergTip(reden: 'verlaten' | 'anders' = 'anders') {
  if (toonTimer !== undefined) clearTimeout(toonTimer);
  if (controleTimer !== undefined) clearInterval(controleTimer);
  toonTimer = controleTimer = undefined;
  waarnemer?.disconnect();
  if (zichtbaar && reden === 'verlaten') warmTot = performance.now() + WACHT_MS;
  if (tip) {
    tip.hidden = true;
    tip.style.opacity = '0';
  }
  const knop = huidig;
  const titel = weggehaald;
  zichtbaar = false;
  huidig = null;
  bron = null;
  weggehaald = null;
  plek = null;
  if (knop && titel !== null) zetTerug(knop, titel);
}

function maakTip(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = KLASSEN;
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('data-tip-laag', '');
  el.hidden = true;
  el.style.opacity = '0';
  document.body.appendChild(el);
  return el;
}

/** Zet de tip bij de knop; false als de knop geen vak meer heeft. */
function plaats(knop: HTMLButtonElement, el: HTMLDivElement): boolean {
  const r = knop.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const venster = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
  el.style.maxWidth = `${Math.max(0, venster.width - 2 * MARGE)}px`;
  el.style.left = '0px';
  el.style.top = '0px';
  const { left, top } = plaatsTip(r, { width: el.offsetWidth, height: el.offsetHeight }, venster);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  plek = r;
  return true;
}

/**
 * Past de knop nog? Leest de aria-label opnieuw (de tip volgt een nieuw
 * label), haalt een title weg die React intussen terugzette (alleen als ze
 * gelijk is aan de naam) en zegt nee bij: uit de DOM, uitgeschakeld, een
 * eigen title, geen naam meer.
 */
function nogGeschikt(knop: HTMLButtonElement): string | null {
  if (!knop.isConnected || knop.disabled) return null;
  const naam = knop.getAttribute('aria-label');
  if (!naam) return null;
  const titel = knop.getAttribute('title');
  if (titel !== null) {
    if (titel !== naam) return null;
    if (bron === 'muis') haalTitelWeg(knop);
    return naam;
  }
  // Geen title: alleen goed als de laag ze weghaalde en ze bij de naam hoort.
  return weggehaald === naam ? naam : null;
}

function controle() {
  const knop = huidig;
  if (!knop || !tip) return;
  const naam = nogGeschikt(knop);
  if (naam === null) { verbergTip(); return; }
  if (verschoven(knop.getBoundingClientRect())) { verbergTip(); return; }
  if (tip.textContent !== naam) {
    tip.textContent = naam;
    if (!plaats(knop, tip)) verbergTip();
  }
}

function toon() {
  toonTimer = undefined;
  const knop = huidig;
  if (!knop) return;
  const naam = nogGeschikt(knop);
  if (naam === null) { verbergTip(); return; }
  const el = (tip ??= maakTip());
  el.textContent = naam;
  el.style.opacity = '0';
  el.hidden = false;
  // plaats() meet de tip (offsetWidth): de stijl met opacity 0 staat dan vast,
  // zodat de wissel naar 1 hierna als transitie loopt.
  if (!plaats(knop, el)) { verbergTip(); return; }
  zichtbaar = true;
  el.style.opacity = '1';
  controleTimer = setInterval(controle, CONTROLE_MS);
}

/** Een wissel op de knop zelf: zichtbaar = de controle meteen, wachtend = nog geschikt? */
function opWijziging() {
  if (!huidig) return;
  if (zichtbaar) controle();
  else if (nogGeschikt(huidig) === null) verbergTip();
}

function begin(knop: HTMLButtonElement, soort: 'muis' | 'focus') {
  verbergTip();
  huidig = knop;
  bron = soort;
  if (soort === 'muis') haalTitelWeg(knop);
  (waarnemer ??= new MutationObserver(opWijziging)).observe(knop, VOLG);
  if (soort === 'focus' || performance.now() < warmTot) toon();
  else toonTimer = setTimeout(toon, WACHT_MS);
}

function opWijzen(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || !(e.target instanceof Element)) return;
  if (huidig && huidig.contains(e.target)) {
    // De muis komt op een knop die de tip al heeft via het toetsenbord:
    // vanaf nu telt de muis, en de title moet weg.
    if (bron === 'focus') { bron = 'muis'; haalTitelWeg(huidig); }
    return;
  }
  if (gedoofd?.contains(e.target)) return;
  const knop = e.target.closest(SELECTOR);
  if (geschikt(knop)) begin(knop, 'muis');
}

function opVerlaten(e: PointerEvent) {
  if (gedoofd && e.target instanceof Node && gedoofd.contains(e.target)
    && !(e.relatedTarget instanceof Node && gedoofd.contains(e.relatedTarget))) gedoofd = null;
  if (!huidig || bron !== 'muis' || !(e.target instanceof Node) || !huidig.contains(e.target)) return;
  if (e.relatedTarget instanceof Node && huidig.contains(e.relatedTarget)) return;
  verbergTip('verlaten');
}

function opFocus(e: FocusEvent) {
  const doel = e.target;
  if (!viaTab || !(doel instanceof Element) || doel === huidig) return;
  if (geschikt(doel)) begin(doel, 'focus');
}

function opFocusWeg(e: FocusEvent) {
  if (huidig && e.target === huidig) verbergTip();
}

function opScroll() {
  if (!huidig) return;
  // Toetsenbordfocus schuift een knop zelf in beeld: dan volgt de tip hem.
  if (bron === 'focus' && zichtbaar && tip) {
    const r = huidig.getBoundingClientRect();
    if (r.bottom > 0 && r.top < document.documentElement.clientHeight && plaats(huidig, tip)) return;
  }
  verbergTip();
}

function opToets(e: KeyboardEvent) {
  viaTab = e.key === 'Tab';
  if (e.key !== 'Escape' || !zichtbaar || e.isComposing) return;
  // Vóór verbergTip: dat zet `huidig` op null.
  const slik = laagVan(huidig) === laagVan(document.activeElement);
  verbergTip();
  if (!slik) return;
  e.preventDefault();
  e.stopPropagation();
}

/** Er gaat een laag met Escape open (lagen.ts): de tip eronder of ernaast gaat weg. */
function opLaagOpen() {
  if (!huidig) return;
  if (bron === 'muis') gedoofd = huidig;
  verbergTip();
}

const opToetsLos = (e: KeyboardEvent) => { if (e.key === 'Tab') viaTab = false; };
const opDruk = () => { viaTab = false; if (huidig) verbergTip(); };
const weg = () => { if (huidig) verbergTip(); };

const vangst = { capture: true, passive: true } as const;
const LUISTERAARS = [
  ['pointerover', opWijzen, vangst],
  ['pointerout', opVerlaten, vangst],
  ['pointerdown', opDruk, vangst],
  ['wheel', weg, vangst],
  ['scroll', opScroll, vangst],
  ['focusin', opFocus, true],
  ['focusout', opFocusWeg, true],
  ['keydown', opToets, true],
  ['keyup', opToetsLos, true],
  ['visibilitychange', weg, false],
] as const;

/** Start de laag (één keer per pagina) en neemt de knop onder de muis meteen mee. */
export function startTipLaag() {
  if (gestart || typeof document === 'undefined') return;
  gestart = true;
  tip = maakTip();
  for (const [type, fn, opties] of LUISTERAARS) document.addEventListener(type, fn as EventListener, opties);
  window.addEventListener('blur', weg);
  bijLaagOpen(opLaagOpen);
  // De muis kan al op een knop staan terwijl de module laadde.
  const onder = [...document.querySelectorAll(':hover')].at(-1);
  const knop = onder?.closest(SELECTOR) ?? null;
  if (geschikt(knop)) begin(knop, 'muis');
}

/** Alleen voor tests: luisteraars weg, tip weg, alles terug op begin. */
export function stopTipLaag() {
  verbergTip();
  for (const [type, fn, opties] of LUISTERAARS) document.removeEventListener(type, fn as EventListener, opties);
  window.removeEventListener('blur', weg);
  bijLaagOpen(null);
  tip?.remove();
  tip = null;
  warmTot = 0;
  viaTab = false;
  gedoofd = null;
  gestart = false;
}
