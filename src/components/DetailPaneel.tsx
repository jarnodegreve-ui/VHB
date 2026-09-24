import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/ui';
import { overgangActief, recordNaam } from '../lib/overgang';
import { useMinWidth } from '../lib/useMinWidth';
import { Card } from './Card';
import { RichtingWissel } from './RichtingWissel';
import { SlideOver } from './SlideOver';
import { SluitContext, useSluitPoort, type SluitVia } from './Modal';
import { EmptyState } from './ui';
import { IconButton } from './primitives';
import { naOpruimen, useLaag } from '../lib/lagen';
import { zetNavigatieBewaker } from '../app/router';

/**
 * Hét detailpaneel van het portaal — één patroon voor "iets uit een lijst
 * openen". Onder `lg` (1024 px) is het een SlideOver (terugknop, swipe-back
 * en Escape sluiten via de useHistoryDismiss die SlideOver al heeft); vanaf
 * `lg` een kaart die náást de lijst staat (master-detail) en onder de topbar
 * blijft plakken. Views vertakken niet meer zelf op het breekpunt: ze geven
 * `open`, kop, inhoud en eventueel een footer met acties.
 *
 * Desktop: een paneel náást de lijst heeft geen sluitkruis nodig; een
 * andere rij kiezen wisselt de inhoud, acties in de footer (opslaan,
 * beslissen, annuleren) roepen `onClose` aan waar dat past, en het paneel
 * valt dan terug op de lege staat ("Kies een …"), één rustige compacte rij
 * (afwerkingsronde 04-09, nr. 2 en 4). Een paneel dat alleen bestaat
 * terwijl het open is (`verbergLeeg`: de verlofbeoordeling boven de
 * kalender, de dag in de verlofkalender) krijgt wél een kruisje en sluit op
 * Escape (polish P2b, regel Jarno 24-09): een wachtende aanvraag bekijken
 * zonder te beslissen moest ook kunnen.
 */
const LG = 1024;

/**
 * Staat het paneel inline naast de lijst (lg+)? Alleen voor views die op
 * desktop een standaardkeuze willen (bv. de nieuwste update meteen open,
 * zodat het paneel nooit leeg opent) — verder hoort een view niet op het
 * breekpunt te vertakken; DetailPaneel doet dat zelf.
 */
export function useInlinePaneel() {
  return useMinWidth(LG);
}

/**
 * Dirty-bescherming voor het desktoppaneel (tranche 3A, 22-09). Op desktop
 * staat het formulier als kaart náást de lijst: een andere rij kiezen,
 * "Nieuw", Annuleren of een recordwissel via de URL gooide onbewaarde
 * invoer zonder vraag weg. Met deze poort vragen die allemaal eerst
 * "Wijzigingen niet bewaren?" (dezelfde OnbewaardDialoog als Modal en
 * SlideOver): "Verder bewerken" houdt record en invoer, "Niet bewaren" voert
 * de wissel uit.
 *
 *   const poort = useDetailPoort(vuil);
 *   const kies = (item) => poort.via(() => open(item));
 *   useStandaardKeuze({ …, vuil });
 *   <DetailPaneel vuil={vuil} poort={poort} …>
 *
 * DetailPaneel toont de vraag en geeft de poort als SluitContext aan de
 * inhoud, zodat een `SluitKnop` (Annuleren) er vanzelf door gaat. Onder `lg`
 * laat de poort alles door: daar is het paneel een SlideOver met een eigen
 * sluitpoort, en een tweede vraag zou dubbel zijn.
 */
export type DetailPoort = { via: SluitVia; dialoog: ReactNode; vuil: boolean };
export function useDetailPoort(vuil: boolean): DetailPoort {
  const inline = useMinWidth(LG);
  const actief = inline && vuil;
  const { sluitVia, dialoog } = useSluitPoort(true, actief);
  // De pagina verlaten met onbewaarde invoer (polish P2b, regel Jarno 24-09):
  // zolang het formulier vuil is, houdt een onzichtbare laag een eigen
  // history-entry vast. De terugknop raakt eerst die en vraagt dezelfde
  // "Wijzigingen niet bewaren?"; een wissel naar een ander scherm (zijbalk,
  // link) vraagt het via de navigatiebewaking van de router. "Niet bewaren"
  // laat de bewaking los en voert de wissel uit zodra de historiek schoon is.
  const [vrij, setVrij] = useState(false);
  useEffect(() => { if (!actief) setVrij(false); }, [actief]);
  const bewaakt = actief && !vrij;
  const verlaat = (doorgaan: () => void) => sluitVia(() => { setVrij(true); naOpruimen(doorgaan); });
  const verlaatRef = useRef(verlaat);
  verlaatRef.current = verlaat;
  useLaag({ open: bewaakt, sluit: () => verlaat(() => window.history.back()), escape: false, soort: 'bewaking' });
  useEffect(() => {
    if (!bewaakt) return;
    zetNavigatieBewaker((doorgaan) => verlaatRef.current(doorgaan));
    return () => zetNavigatieBewaker(null);
  }, [bewaakt]);
  return { via: sluitVia, dialoog, vuil: actief };
}

/**
 * Standaardkeuze voor master-detail met eigen selectiestaat (bewerkformulier,
 * toestel): op desktop staat het eerste item open zodra de lijst er is en er
 * niets gekozen is; verdwijnt het gekozen item uit de lijst (verwijderd,
 * weggefilterd), dan schuift de keuze door naar het item op dezelfde plek
 * (de buur). Is er geen buur meer (lijst leeg) of staat het scherm op
 * mobiel, dan wordt de keuze gewist via `wis` — anders bleef het paneel op
 * een verdwenen record staan (bewerkbaar formulier, Opslaan zonder `_rev`;
 * controle 05-09, nr. 11). Komt het item terug (ongedaan maken), dan kiest
 * desktop het opnieuw als eerste item. Verder doet mobiel niets — daar
 * opent een keuze een SlideOver. Zet `actief` uit terwijl het paneel iets
 * anders toont dan een item (bv. het lege "nieuw"-formulier), zodat de
 * preselectie dat niet kaapt.
 *
 * Terugkeer (controle 05-09, nr. 33): verwijderen is optimistisch — de
 * lijst laat het item meteen los en deze hook schuift door naar de buur nog
 * vóór de server antwoordt. Geeft die 409/404, dan brengt de refetch het
 * item terug; hetzelfde bij "Ongedaan maken". Komt het weggeschoven item
 * binnen korte tijd terug en koos de gebruiker intussen niets zelf, dan
 * gaat de keuze weer naar dat item — anders bleef het paneel op de buur
 * staan met een overschreven formulier.
 *
 * Geeft `inline` terug (lg+), zodat de view op mobiel wél kan sluiten na een
 * actie waar desktop gewoon op het item blijft staan.
 */
/** Zolang mag een weggeschoven item terugkomen en de keuze heroveren:
 *  ruim boven de undo-toast (6 s) en een 409-refetch. */
const TERUGKEER_MS = 15_000;
export function useStandaardKeuze<T>({ items, sleutelVan, gekozen, kies, wis, actief = true, vuil = false }: {
  items: T[];
  sleutelVan: (item: T) => string;
  /** Sleutel van de huidige keuze (null = niets gekozen). */
  gekozen: string | null;
  kies: (item: T) => void;
  /** Keuze wissen bij de wissel naar mobiel als ze automatisch was — anders
   *  schuift daar ineens een SlideOver open. */
  wis?: () => void;
  actief?: boolean;
  /** Onbewaarde invoer in het paneel: dan kiest of wist deze hook níéts
   *  (geen voorselectie, niet doorschuiven naar de buur bij een refetch,
   *  niet wissen bij de wissel naar mobiel). Zodra het formulier weer schoon
   *  is, haalt hij in wat er intussen veranderde. */
  vuil?: boolean;
}) {
  const inline = useMinWidth(LG);
  const vorige = useRef<string[]>([]);
  // Sleutel van de laatste automatische keuze; null zodra de gebruiker zelf koos.
  const automatisch = useRef<string | null>(null);
  // Item dat door een verdwijning uit de lijst is weggeschoven naar een
  // buur, met de uiterste terugkeertijd (zie TERUGKEER_MS).
  const weggeschoven = useRef<{ sleutel: string; tot: number } | null>(null);

  // Zonder deps: goedkoop (één map over de lijst) en zo mist hij nooit een
  // wissel — kiezen gebeurt alleen als er echt iets ontbreekt.
  useEffect(() => {
    // Nooit automatisch wegwisselen van een vuil formulier; `vorige` blijft
    // op de laatste schone stand, zodat de buur daarna nog klopt.
    if (vuil) return;
    const sleutels = items.map(sleutelVan);
    const terug = weggeschoven.current;
    if (terug && (Date.now() > terug.tot || gekozen !== automatisch.current)) {
      // Te laat, of de gebruiker koos intussen zelf iets: niet meer terugspringen.
      weggeschoven.current = null;
    } else if (terug && inline && actief && sleutels.includes(terug.sleutel)) {
      // Het weggeschoven item is terug (mislukte DELETE → refetch, of
      // ongedaan gemaakt): de keuze herstellen.
      weggeschoven.current = null;
      kies(items[sleutels.indexOf(terug.sleutel)]);
      automatisch.current = terug.sleutel;
      vorige.current = sleutels;
      return;
    }
    if (gekozen !== null && !sleutels.includes(gekozen)) {
      // Het gekozen item staat niet (meer) in de lijst.
      if (inline && actief && sleutels.length > 0) {
        const i = vorige.current.indexOf(gekozen);
        const doel = items[Math.min(Math.max(i, 0), items.length - 1)];
        kies(doel);
        automatisch.current = sleutelVan(doel);
        weggeschoven.current = { sleutel: gekozen, tot: Date.now() + TERUGKEER_MS };
      } else {
        // Geen buur (lijst leeg) of mobiel: keuze wissen, zodat het paneel
        // niet op een verwijderd record blijft staan.
        automatisch.current = null;
        wis?.();
      }
    } else if (inline && actief && sleutels.length > 0) {
      if (gekozen === null) {
        kies(items[0]);
        automatisch.current = sleutels[0];
      } else if (gekozen !== automatisch.current) {
        automatisch.current = null;
      }
    }
    vorige.current = sleutels;
  });

  useEffect(() => {
    if (vuil || inline || automatisch.current === null) return;
    automatisch.current = null;
    wis?.();
  }, [inline, wis, vuil]);

  return inline;
}

/**
 * Lijst + paneel naast elkaar vanaf `lg` (lijst 38 %, paneel de rest);
 * rijen die de titel naar het paneel willen laten schuiven, zetten
 * `data-vt-record={id}` op hun titel en kiezen via `kiesRecord`
 * (src/lib/overgang.ts) — zie UpdatesView/DiversionsView;
 * eronder gewoon de lijst — het paneel is dan een SlideOver (portal) en
 * neemt geen plaats in. Zonder `paneel` (bv. lege lijst met EmptyState)
 * krijgt de lijst de volle breedte.
 */
export function MasterDetail({ lijst, paneel, className }: {
  lijst: ReactNode;
  paneel?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('lg:grid lg:grid-cols-[minmax(0,38%)_1fr] lg:items-start lg:gap-5', className)}>
      <div className={cn('min-w-0', !paneel && 'lg:col-span-2')}>{lijst}</div>
      {paneel}
    </div>
  );
}

/**
 * Loopt er een view transition die het paneel al beweegt? De route-wissel
 * (`vt-route`) én de gedeelde titel-overgang van kiesRecord (`vt-record`):
 * in beide gevallen wisselt de inhoud zonder eigen beweging, anders vecht
 * de body-fade met de overgang die de browser al tekent.
 */
const overgangLoopt = () => overgangActief() || (typeof document !== 'undefined' && document.documentElement.classList.contains('vt-record'));

/** Positie van de rij-titel van een record in de lijst (`data-vt-record`), of null. */
const rijTop = (id: string): number | null => {
  if (typeof document === 'undefined' || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') return null;
  const el = document.querySelector<HTMLElement>(`[data-vt-record="${CSS.escape(id)}"]`);
  return el ? el.getBoundingClientRect().top : null;
};

/**
 * Richting van een recordwissel: 1 als het nieuwe record lager in de lijst
 * staat dan het vorige (de inhoud schuift omhoog), −1 als het hoger staat.
 * Gelezen uit de lijst-DOM vóór de commit (beide rijen staan er nog); zonder
 * rij-markering of zonder vorige keuze: vooruit.
 */
const richtingVoor = (vorige: string | undefined, nieuwe: string | undefined): 1 | -1 => {
  if (!vorige || !nieuwe) return 1;
  const van = rijTop(vorige);
  const naar = rijTop(nieuwe);
  if (van === null || naar === null) return 1;
  return naar < van ? -1 : 1;
};

export function DetailPaneel({
  open,
  onClose,
  title,
  subtitle,
  titelTerugloop = false,
  icon,
  chip,
  acties,
  footer,
  children,
  breedte = 'md',
  sleutel,
  richting,
  leegTekst = 'Kies een item uit de lijst.',
  leegActie,
  verbergLeeg = false,
  plakkend = true,
  vuil = false,
  poort,
  sluitKnop = verbergLeeg,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Toon lange titel/subtitel volledig; de kop kan zo nodig zelf scrollen. */
  titelTerugloop?: boolean;
  /** Icoontegel links van de titel (zelf sizen, bv. h-9 w-9). */
  icon?: ReactNode;
  /** Statuschip(s) naast de titel (Badge). Op mobiel in een rij boven de inhoud. */
  chip?: ReactNode;
  /** Secundaire acties rechts in de kop (IconButton of ActieMenu: geschiedenis,
   *  verwijderen …); de footer houdt zo alleen de primaire knoppen. Op mobiel
   *  in dezelfde rij boven de inhoud (de SlideOver-kop heeft het sluitkruis). */
  acties?: ReactNode;
  /** Actieknoppen onderaan: vast in beeld, los van de scrollende inhoud. */
  footer?: ReactNode;
  children: ReactNode;
  /** Breedte van de mobiele SlideOver. */
  breedte?: 'md' | 'lg';
  /** Id van het getoonde item: bij wissel scrolt de inhoud terug naar boven,
   *  komt het paneel op desktop in beeld en wisselt de inhoud met een zachte
   *  verschuiving (opacity + 4 px) in de richting van de wissel. */
  sleutel?: string;
  /** Richting van de wissel (1 = het nieuwe item staat lager in de lijst).
   *  Zonder deze prop leest het paneel ze af uit `data-vt-record` op de
   *  rij-titels; ontbreekt die, dan altijd vooruit. */
  richting?: 1 | -1;
  /** Lege staat op desktop (niets gekozen). */
  leegTekst?: string;
  /** Optionele knop onder de lege-staat-tekst (bv. "Nieuwe omleiding"). */
  leegActie?: ReactNode;
  /** Geen lege-staat-kaart tonen (paneel dat alleen bestaat terwijl het open is,
   *  bv. de verlofbeoordeling bovenaan een kolom die verder al gevuld is). */
  verbergLeeg?: boolean;
  /** `lg:sticky` onder de topbar — uit voor een paneel in een gewone kolomflow. */
  plakkend?: boolean;
  /** Onbewaarde invoer (tranche 3A): de mobiele SlideOver vraagt dan eerst
   *  "Wijzigingen niet bewaren?" bij sluiten. */
  vuil?: boolean;
  /** Desktop-bewaking (useDetailPoort): toont de vraag en laat een
   *  `SluitKnop` in de inhoud of footer door de poort gaan. Rijkeuze en
   *  recordwissel in de view lopen via `poort.via`. */
  poort?: DetailPoort;
  /** Desktop: kruisje in de kop en Escape sluiten het paneel. Standaard aan
   *  voor een paneel dat alleen bestaat terwijl het open is (`verbergLeeg`). */
  sluitKnop?: boolean;
  className?: string;
}) {
  const inline = useMinWidth(LG);
  // Kruisje en Escape op desktop gaan door de sluitpoort van het scherm
  // (onbewaarde invoer vraagt eerst); Escape als laag in de gedeelde stapel,
  // dus een modal erboven gaat eerst dicht. Geen eigen history-entry: het
  // paneel staat in de pagina.
  const sluitInline = () => (poort ? poort.via(onClose) : (onClose(), true));
  useLaag({ open: inline && open && sluitKnop, sluit: sluitInline, historie: false, soort: 'paneel' });
  const wortel = useRef<HTMLDivElement>(null);
  const kopRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Richting van de inhoudswissel, bepaald op het moment dat de sleutel
  // verandert (vóór de commit: de lijst-DOM toont nog beide rijen). Stil
  // tijdens een view transition (zie overgangLoopt) — die staat op dat
  // moment al op <html>, dus dit is in dezelfde render bekend.
  const vorigeSleutel = useRef(sleutel);
  const wisselRef = useRef<{ richting: 1 | -1; stil: boolean }>({ richting: 1, stil: false });
  if (sleutel !== vorigeSleutel.current) {
    wisselRef.current = { richting: richting ?? richtingVoor(vorigeSleutel.current, sleutel), stil: overgangLoopt() };
    vorigeSleutel.current = sleutel;
  }
  const wissel = wisselRef.current;

  // Nieuw item: de inhoud én een eventueel gescrolde lange titel weer
  // bovenaan tonen. De containers blijven staan voor de cross-fade.
  useLayoutEffect(() => {
    kopRef.current?.scrollTo?.(0, 0);
    scroller.current?.scrollTo?.(0, 0);
  }, [sleutel]);

  // Desktop: het paneel in beeld brengen zodra er iets (anders) gekozen is —
  // wie onderaan een lange lijst klikt, ziet anders niets gebeuren.
  // Alleen wanneer de BOVENKANT van het paneel buiten beeld staat: met
  // 'nearest' scrolde de pagina ook als enkel de onderkant buiten beeld viel,
  // en op een verse pagina is dat bijna altijd zo. Beheer updates en Beheer
  // omleidingen (die op desktop meteen het eerste item openen) begonnen
  // daardoor een stuk naar beneden gescrold, met de paginatitel onder de
  // topbar (Jarno 09-09).
  useEffect(() => {
    if (!inline || !open) return;
    const el = wortel.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const topbar = 56; // hoogte van de plakkende topbar (h-14), zie App.tsx
      const bovenkantZichtbaar = r.top >= topbar && r.top <= window.innerHeight - 120;
      if (!bovenkantZichtbaar) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [inline, open, sleutel]);

  if (!inline) {
    return (
      <SlideOver open={open} onClose={onClose} vuil={vuil} title={title} subtitle={subtitle} titelTerugloop={titelTerugloop} icon={icon} width={breedte} footer={footer}>
        {/* Een andere rij kiezen terwijl het paneel open staat: zachte wissel
            i.p.v. een harde; het openen zelf is de veer van de SlideOver. */}
        <RichtingWissel sleutel={sleutel ?? ''} richting={wissel.richting} as="y" stil={wissel.stil}>
          {chip || acties ? (
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">{chip}</div>
              {acties ? <div className="flex shrink-0 items-center gap-1">{acties}</div> : null}
            </div>
          ) : null}
          {children}
        </RichtingWissel>
      </SlideOver>
    );
  }

  if (!open && verbergLeeg) return null;

  const kaart = (
    <div ref={wortel} className={cn(plakkend && 'lg:sticky lg:top-16', className)} aria-live="polite">
      {/* Lege staat ↔ kaart: cross-fade met 4 px i.p.v. een kale if. */}
      <RichtingWissel sleutel={open ? 'kaart' : 'leeg'} richting={1} as="y" stil={overgangLoopt()}>
      {!open ? (
        <EmptyState compact title={leegTekst} action={leegActie} />
      ) : (
      /* Kop en footer staan vast; alleen de inhoud scrolt (max. de
          viewport onder de topbar) — zoals de SlideOver dat ook doet. */
      <Card
        as="section"
        padding="none"
        aria-label={title}
        className={cn('flex flex-col overflow-hidden', plakkend && 'lg:max-h-[calc(100dvh_-_5rem)]')}
      >
        <div ref={kopRef} className={cn(
          'flex shrink-0 items-start gap-3 border-b border-hairline p-5 md:p-6',
          titelTerugloop && 'max-h-[40dvh] overflow-y-auto overscroll-contain',
        )}>
          {icon}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {/* Gedeelde-element-overgang (src/lib/overgang.ts): dezelfde naam
                  als de titel van de gekozen rij (data-vt-record), zodat die
                  bij een keuze van de lijst naar hier schuift. */}
              <h2
                className={cn('text-section-title min-w-0', titelTerugloop ? '[overflow-wrap:anywhere]' : 'truncate')}
                style={sleutel ? { viewTransitionName: recordNaam(sleutel) } : undefined}
              >
                {title}
              </h2>
              {chip}
            </div>
            {subtitle ? <p className={cn('mt-0.5 text-md text-slate-500', titelTerugloop ? '[overflow-wrap:anywhere]' : 'truncate')}>{subtitle}</p> : null}
          </div>
          {acties || sluitKnop ? (
            <div className="-my-1 flex shrink-0 items-center gap-1">
              {acties}
              {sluitKnop ? <IconButton label="Sluiten" variant="ghost" size="sm" onClick={() => sluitInline()}><X size={16} /></IconButton> : null}
            </div>
          ) : null}
        </div>
        {/* relative: de vertrekkende inhoud (popLayout) blijft binnen de
            scroll-container staan i.p.v. op de kaart te springen. */}
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 md:p-6">
          <RichtingWissel sleutel={sleutel ?? ''} richting={wissel.richting} as="y" stil={wissel.stil}>
            {children}
          </RichtingWissel>
        </div>
        {footer ? <div className="border-t border-hairline p-4 md:px-6">{footer}</div> : null}
      </Card>
      )}
      </RichtingWissel>
    </div>
  );
  if (!poort) return kaart;
  return (
    <>
      <SluitContext.Provider value={poort.via}>{kaart}</SluitContext.Provider>
      {poort.dialoog}
    </>
  );
}
