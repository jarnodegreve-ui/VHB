import { useRef, useState } from 'react';
import type { Toast, ToastOpties } from '../components/ToastStack';
import { reportHandledError } from '../lib/monitoring';
import { laadfoutOnderdrukt } from './laadfout';

/**
 * De toasts van de app en de gebundelde laadfout. Tot 06-10 stond dit in
 * App.tsx (stap 2 van de splitsing); de code is verplaatst, niet herschreven.
 *
 * De twee vlaggen blijven van de sessie (App): staat de sessie op uitloggen
 * of staat het toestel-wachtscherm er, dan is dát de melding en komen er geen
 * fout-toasts bij. De hook leest ze alleen.
 */
export function useToasts({ sessieBeeindigdRef, toestelGeblokkeerdRef, opnieuwLaden }: {
  /** Staat de sessie op uitloggen? Dan zijn alle lopende calls gedoemd. */
  sessieBeeindigdRef: { readonly current: boolean };
  /** Staat het toestel-wachtscherm (device_pending/revoked)? */
  toestelGeblokkeerdRef: { readonly current: boolean };
  /** De knop "Opnieuw proberen" op de gebundelde laadfout. */
  opnieuwLaden: () => void;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Toast-ids: Date.now()+random kon botsen (dubbele keys, dismiss
  // verwijderde dan twee meldingen tegelijk).
  const toastIdRef = useRef(0);
  // Laadfouten van gelijktijdige calls verzamelen: bij een hik (netwerk,
  // uitrol) faalt de hele reeks tegelijk en kreeg je vier losse rode
  // meldingen. We bundelen ze tot één melding mét "Opnieuw proberen".
  const laadfoutenRef = useRef<Set<string>>(new Set());
  const laadfoutTimerRef = useRef<number | null>(null);
  // Moment van de laatste info-toast van de onderhoudsmodus (zie showToast).
  const onderhoudMeldingRef = useRef(0);

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showToast = (message: string, tone: Toast['tone'] = 'info', action?: Toast['action'], opties?: ToastOpties) => {
    // Sessie loopt af: de catch-blokken van alle lopende calls komen hier
    // tegelijk binnen ("Kon de verlofaanvragen niet laden", "…de dienstruilen
    // niet laden", …). Dat waren vijf rode toasts én vijf regels in de
    // foutenlog voor één oorzaak — 142 meldingen in twee weken, waarvan het
    // leeuwendeel afgeleid. De sessie zelf is al gemeld op het inlogscherm.
    if (tone === 'error' && (sessieBeeindigdRef.current || toestelGeblokkeerdRef.current)) return;
    // Schrijfblok van de onderhoudsmodus: de info-toast uit useOnderhoud is
    // de melding; de rode toast die de aanroeper vlak daarna toont (en het
    // foutrapport dat daaraan hangt) is geen fout van de app.
    if (tone === 'error' && Date.now() - onderhoudMeldingRef.current < 3000) return;
    // Elke fout-toast is een gebroken flow — meld die ook aan de monitoring,
    // anders blijven afgehandelde fouten (catch-blokken) onzichtbaar.
    if (tone === 'error') reportHandledError(message);
    const id = ++toastIdRef.current;
    const ongedaan = opties?.ongedaan === true;
    setToasts((current) => {
      // Dezelfde melding niet stapelen: twee schermen die dezelfde bron
      // ophalen gaven anders twee identieke toasts onder elkaar. Ongedaan-
      // toasts wél: twee snel na elkaar verwijderde items hebben elk hun
      // eigen weg terug nodig.
      if (!ongedaan && current.some((t) => t.message === message && t.tone === tone)) return current;
      return [...current, { id, message, tone, action, ongedaan, duurMs: opties?.duurMs }];
    });
    // Ongedaan-toasts tellen zelf af in ToastStack (pauze bij hover/focus).
    if (ongedaan) return;
    // Fout-toasts bevatten vaak instructies ("probeer opnieuw") — die moeten
    // lang genoeg blijven staan om rustig te lezen. Succes/info mag snel weg.
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, opties?.duurMs ?? (tone === 'error' ? 10000 : 4200));
  };

  /** De info-toast van de onderhoudsmodus bij een geblokkeerde schrijfactie:
   *  de rode toast die de aanroeper vlak daarna toont, valt dan weg. */
  const meldOnderhoud = (tekst: string) => {
    onderhoudMeldingRef.current = Date.now();
    showToast(tekst, 'info');
  };

  /**
   * Eén melding voor alles wat tegelijk misging. De app haalt bij het openen
   * (en bij elke verversing) een stuk of acht bronnen parallel op; bij een
   * netwerkhik of tijdens een uitrol faalt die hele reeks, en dan kreeg je
   * vier tot vijf losse rode toasts voor één oorzaak — gemeten op 07-08.
   * We verzamelen de namen kort en tonen daarna één melding met een knop die
   * alles opnieuw ophaalt, i.p.v. de gebruiker naar 'vernieuw de pagina' te
   * sturen.
   */
  const laadfoutStaat = () => ({ sessieBeeindigd: sessieBeeindigdRef.current, toestelGeblokkeerd: toestelGeblokkeerdRef.current });
  const meldLaadfout = (bron: string, fout?: unknown) => {
    if (laadfoutOnderdrukt(laadfoutStaat(), fout)) return;
    laadfoutenRef.current.add(bron);
    if (laadfoutTimerRef.current !== null) return;
    laadfoutTimerRef.current = window.setTimeout(() => {
      laadfoutTimerRef.current = null;
      const bronnen = [...laadfoutenRef.current];
      laadfoutenRef.current.clear();
      if (bronnen.length === 0 || laadfoutOnderdrukt(laadfoutStaat())) return;
      const opsomming = bronnen.length === 1
        ? bronnen[0]
        : `${bronnen.slice(0, -1).join(', ')} en ${bronnen[bronnen.length - 1]}`;
      showToast(
        `Kon ${opsomming} niet laden. Controleer je verbinding.`,
        'error',
        { label: 'Opnieuw proberen', run: opnieuwLaden },
      );
    }, 400);
  };

  /** Het toestel raakt geblokkeerd: wat er al aan laadfouten klaarstond en de
   *  fout-toasts die er al stonden, gaan weg. Het wachtscherm is de melding. */
  const wisFouten = () => {
    laadfoutenRef.current.clear();
    if (laadfoutTimerRef.current !== null) {
      window.clearTimeout(laadfoutTimerRef.current);
      laadfoutTimerRef.current = null;
    }
    setToasts((current) => current.filter((t) => t.tone !== 'error'));
  };

  /** Afmelden: alle toasts weg (een toast kan een gedownload bestand vasthouden). */
  const wisToasts = () => setToasts([]);

  return { toasts, showToast, dismissToast, meldLaadfout, meldOnderhoud, wisFouten, wisToasts };
}
