/**
 * De vasthoudstand na een beslissing (ronde 6, punt 1): de rekenkern en de
 * regel wanneer de stand loslaat, zonder React. De hook die ze gebruikt
 * (`useVasthouden`, `useBeslisteRijen`) staat in src/components/LijstRij.tsx.
 *
 * Een rij verdween na een geslaagde beslissing in hetzelfde beeld als het
 * antwoord van de server en de rest schoof op; alleen de toast zei wat er
 * gebeurde. Nu blijft ze even op haar plaats staan met het record zoals het
 * nu in de collectie staat (de status van de server, nooit een zelf gezette),
 * inert en zonder knoppen, en pas daarna verlaat ze de lijst: wat er niet meer
 * in hoort klapt dicht, wat elders hoort schuift erheen.
 *
 * Alleen weergave: de stand komt nooit in een lijst waarop iets anders rekent
 * (doorschakelen, tellers, "Selecteer alles"); die blijven op de collectie.
 */

/**
 * Hoe lang een beslist record na het antwoord van de server op zijn plaats
 * blijft staan (ms). Een pauze om de nieuwe status te lezen, geen
 * animatieduur: het dichtklappen daarna loopt op DUR.fast.
 */
export const BESLIST_MS = 450;

/** Marge rond het vak (px): tot hier telt de aanwijzer nog als "op de rij".
 *  Dezelfde 8 px als de plaatsgrendel van Dienstruil (#801). */
export const VAK_MARGE = 8;

/**
 * Na een `pointerup` binnen de stand: zo lang (ms) wachten op de `click` van
 * datzelfde gebaar voor de stand loslaat. Gemeten (Chromium, iPhone-emulatie)
 * komt die click in dezelfde milliseconde als `pointerup`, maar een browser
 * die nog een tikvertraging aanhoudt (dubbeltik om te zoomen, tot 300 ms)
 * stuurt hem later, en wie dan al losliet, verlegt de rijen onder de vinger.
 * Een veiligheidsmarge, geen wachttijd: komt de click (bijna altijd), dan
 * laat de stand meteen daarna los; dit vangt alleen een gebaar zonder click.
 */
export const KLIK_WACHT_MS = 300;

/** Een vak in vensterpixels (zoals `getBoundingClientRect`). */
export type Vak = { left: number; top: number; right: number; bottom: number };

/** Ligt het punt in het vak, met `marge` px eromheen? */
export const binnenVak = (vak: Vak, x: number, y: number, marge = VAK_MARGE): boolean =>
  x >= vak.left - marge && x <= vak.right + marge && y >= vak.top - marge && y <= vak.bottom + marge;

/** Eén regel van de getoonde lijst: het id en of ze vastgehouden wordt. */
export type GetoondId = { id: string; vast: boolean };

/**
 * De volgorde van de getoonde lijst: de huidige lijst, met elke vastgehouden
 * rij op haar plaats in de vorige getoonde lijst. Zo'n rij staat er precies
 * één keer, ook als ze intussen elders in de huidige lijst staat (verschoven,
 * of via een verversing teruggekomen): tot de stand voorbij is op haar oude
 * plaats, daarna waar de huidige lijst haar zet. Een vastgehouden id dat de
 * vorige keer niet getoond werd, heeft geen plaats om te houden en telt niet
 * als vastgehouden. Zonder vastgehouden rijen is dit precies `huidig`.
 */
export function plaatsVastgehouden(huidig: readonly string[], vorige: readonly string[], vast: Iterable<string>): GetoondId[] {
  const plek = new Map<string, number>();
  vorige.forEach((id, i) => { if (!plek.has(id)) plek.set(id, i); });
  const vastHier = new Set([...vast].filter((id) => plek.has(id)));
  const gezien = new Set<string>();
  const uit: GetoondId[] = [];
  for (const id of huidig) {
    if (vastHier.has(id) || gezien.has(id)) continue;
    gezien.add(id);
    uit.push({ id, vast: false });
  }
  // In de volgorde van de vorige lijst, elk direct na de dichtstbijzijnde
  // voorganger die er nog staat (vooraan als er geen meer is).
  const volgorde = [...vastHier].sort((a, b) => plek.get(a)! - plek.get(b)!);
  for (const id of volgorde) {
    let na = -1;
    for (let j = plek.get(id)! - 1; j >= 0 && na < 0; j--) na = uit.findIndex((r) => r.id === vorige[j]);
    uit.splice(na + 1, 0, { id, vast: true });
  }
  return uit;
}

/**
 * De getoonde lijst met records. Een vastgehouden rij krijgt het record zoals
 * het nu in de collectie staat (`zoek`); is het daar weg, dan valt ze weg.
 */
export function toonBeslist<T>({ huidig, sleutel, vorige, vast, zoek }: {
  huidig: readonly T[];
  sleutel: (record: T) => string;
  /** De ids van de vorige getoonde lijst, in volgorde. */
  vorige: readonly string[];
  vast: Iterable<string>;
  zoek: (id: string) => T | undefined;
}): Array<{ record: T; vast: boolean }> {
  const perId = new Map<string, T>();
  for (const r of huidig) { const id = sleutel(r); if (!perId.has(id)) perId.set(id, r); }
  const uit: Array<{ record: T; vast: boolean }> = [];
  for (const { id, vast: v } of plaatsVastgehouden([...perId.keys()], vorige, vast)) {
    const record = v ? zoek(id) : perId.get(id);
    if (record !== undefined) uit.push({ record, vast: v });
  }
  return uit;
}

type Luisteraar = (e: PointerEvent) => void;
type Doel = {
  addEventListener: (type: string, fn: Luisteraar, opties: AddEventListenerOptions) => void;
  removeEventListener: (type: string, fn: Luisteraar, opties: AddEventListenerOptions) => void;
};

export type StandOpties = {
  /**
   * De aanwijzerregel: de beslissing viel met een klik van de aanwijzer
   * (`detail > 0`) in het vak zelf. Dan duurt de stand bovendien tot de
   * aanwijzer dat vak (+ VAK_MARGE) verliet of de vinger ergens anders
   * neerkwam. Zonder (toetsenbord, of de klik viel in een paneel of een
   * bevestiging) telt alleen de tijd.
   */
  aanwijzer: boolean;
  /** Het vak, live gelezen (het kan verschuiven); null = het is er niet meer. */
  vak?: () => Vak | null;
  /** De stand is voorbij. Komt hoogstens één keer, nooit na `stop`. */
  klaar: () => void;
  ms?: number;
  /** Waar de luisteraars hangen (standaard `window`). */
  doel?: Doel;
  /** Eén beeld wachten (standaard requestAnimationFrame). */
  frame?: (fn: () => void) => void;
};

/**
 * Start één stand en geeft `stop` terug (stopt stil, zonder `klaar`).
 *
 * De stand laat los zodra de tijd om is, en (met de aanwijzerregel) de
 * aanwijzer weg is, en er geen gebaar loopt. "Weg" volgt alleen uit
 * `pointermove` van een muis buiten het vak en `pointerdown` buiten het vak,
 * op het doel in de capture-fase, zoals #801: nooit `pointerleave`,
 * `pointerout` of `mouseleave`, want een tik geeft na `pointerup` ook die
 * twee, terwijl de vinger weg is en de muis nergens heen ging.
 *
 * Een gebaar loopt van `pointerdown` tot na zijn `click` (of, zonder click,
 * KLIK_WACHT_MS na `pointerup`, of een beeld na `pointercancel`), en dat in
 * beide vormen: valt het einde van de tijd midden in een tik, dan wacht de
 * stand tot die tik geland is op wat getikt werd, zodat er niets onder de
 * vinger verschuift.
 */
export function startStand({ aanwijzer, vak, klaar, ms = BESLIST_MS, doel = window as unknown as Doel, frame = (fn) => { requestAnimationFrame(() => fn()); } }: StandOpties): () => void {
  let tijdOm = false;
  let weg = !aanwijzer;
  /** Volgnummer van het lopende gebaar (0 = geen). */
  let gebaar = 0;
  let laatste = 0;
  let gestopt = false;
  let wachtOpKlik: ReturnType<typeof setTimeout> | undefined;
  const klokken = new Set<ReturnType<typeof setTimeout>>();
  const na = (wacht: number, fn: () => void) => {
    const k = setTimeout(() => { klokken.delete(k); if (!gestopt) fn(); }, wacht);
    klokken.add(k);
    return k;
  };
  const buiten = (e: PointerEvent) => {
    const v = vak?.();
    return !v || !binnenVak(v, e.clientX, e.clientY);
  };
  const kijk = () => {
    if (gestopt || !tijdOm || !weg || gebaar) return;
    stop();
    klaar();
  };
  const gebaarKlaar = (nr: number) => {
    if (gebaar !== nr) return;
    gebaar = 0;
    kijk();
  };
  const opBeweging: Luisteraar = (e) => {
    if (weg || e.pointerType !== 'mouse' || !buiten(e)) return;
    weg = true;
    kijk();
  };
  const opNeer: Luisteraar = (e) => {
    if (wachtOpKlik !== undefined) { clearTimeout(wachtOpKlik); klokken.delete(wachtOpKlik); wachtOpKlik = undefined; }
    gebaar = ++laatste;
    if (!weg && buiten(e)) weg = true;
  };
  const opLos: Luisteraar = () => {
    if (!gebaar) return;
    const nr = gebaar;
    wachtOpKlik = na(KLIK_WACHT_MS, () => gebaarKlaar(nr));
  };
  const opAfbreek: Luisteraar = () => {
    if (!gebaar) return;
    const nr = gebaar;
    frame(() => { if (!gestopt) gebaarKlaar(nr); });
  };
  // Na de click: pas als die bij zijn doel geweest is (de click loopt nog,
  // dit is de capture-fase op het venster).
  const opKlik: Luisteraar = () => {
    if (!gebaar) return;
    const nr = gebaar;
    na(0, () => gebaarKlaar(nr));
  };
  const luisteraars: Array<[string, Luisteraar]> = [
    ['pointermove', opBeweging],
    ['pointerdown', opNeer],
    ['pointerup', opLos],
    ['pointercancel', opAfbreek],
    ['click', opKlik],
  ];
  const CAPTURE = { capture: true };
  for (const [soort, fn] of luisteraars) doel.addEventListener(soort, fn, CAPTURE);
  function stop() {
    if (gestopt) return;
    gestopt = true;
    for (const k of klokken) clearTimeout(k);
    klokken.clear();
    for (const [soort, fn] of luisteraars) doel.removeEventListener(soort, fn, CAPTURE);
  }
  na(ms, () => { tijdOm = true; kijk(); });
  return stop;
}
