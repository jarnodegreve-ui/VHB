import React, { useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { cn } from '../lib/ui';
import type { View } from '../types';
import { sectieLabel } from '../app/routes';
import { versheidTekst, type Versheid } from '../lib/zelfLadend';
import { Button } from './primitives';
import { Modal } from './Modal';
import { Skeleton, SkeletonRow } from './Skeleton';
import { AllesGedaan, Fout, GeenBereik, LegeLijst } from './illustraties';

export function PageShell({
  children,
  className,
  breed = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Brede kolom (--content-max-breed) voor matrices en brede tabellen.
   *  Alleen zinvol als de route in routes.tsx óók `breed` heeft: de schil
   *  (topbar, #hoofdinhoud) volgt dat veld, anders blijft de buitenwand op
   *  --content-max en verandert deze prop niets. */
  breed?: boolean;
}) {
  return <div className={cn(breed ? 'max-w-[var(--content-max-breed)]' : 'max-w-[var(--content-max)]', 'mx-auto space-y-6 md:space-y-8', className)}>{children}</div>;
}

export function PageHeader({
  view,
  eyebrow: eyebrowProp,
  title,
  description,
  actions,
}: {
  /** Het scherm uit de routetabel. De regel boven de titel is dan het
   *  sectiewoord van de zijbalk (`sectieLabel`: Beheer · Planning, Techniek,
   *  Systeem…), één bron voor zijbalk, topbar en kop. Schermen in 'Algemeen'
   *  krijgen er geen. Ronde 3 (19-09): de koppen droegen elk een eigen,
   *  handgeschreven eyebrow ("Beheer", "Planning", "Gebruikersbeheer" boven
   *  "Gebruikersbeheer") of geen, zonder regel. */
  view?: View;
  /** Alleen nog voor koppen buiten de routetabel (print, subschermen). */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const eyebrow = eyebrowProp ?? (view ? sectieLabel(view) ?? undefined : undefined);
  return (
    // flex-wrap: op mobiel staat de (nu ene) primaire knop + "…" naast de
    // titel zolang dat past; bij een lange titel zakt de actie eronder.
    // Voorheen stapelden drie volle-breedte-knoppen onder de kop
    // (afwerking 04-09, nr. 7).
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 md:items-end">
      <div className="min-w-0 flex-1 basis-[14rem] max-w-3xl max-sm:grow-[999]">
        {eyebrow ? <p className="text-micro">{eyebrow}</p> : null}
        {/* Eén h1 per scherm, in de page-title-rol (24/30 px, Manrope 800
            conform huisstijl): de kop wint het van de rest door máát én de
            tracking-ladder, de beschrijving eronder staat in de body-rol. */}
        <h1 className={cn('text-page-title', eyebrow && 'mt-1.5')}>
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-body font-normal text-slate-500">{description}</p>
        ) : null}
      </div>
      {/* Telefoon: passen de acties naast de titel, dan staan ze rechts zoals
          altijd. Zakken ze naar een eigen rij, dan staan ze LINKS, zodat
          titel, uitleg en actie één leeslijn vormen; rechts uitgelijnd
          zweefden ze los onder de tekst (Verlof, Dienstruil, zoekveld
          Contacten). Dat werkt zonder meten: het titelblok groeit 999 keer
          harder dan de acties, dus op dezelfde rij krijgen de acties geen
          extra ruimte en blijven ze rechts; op een eigen rij vullen ze de
          breedte en lijnt hun inhoud links uit. Vanaf sm ongewijzigd. */}
      {actions ? <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 max-sm:ml-0 max-sm:grow max-sm:justify-start md:gap-3">{actions}</div> : null}
    </header>
  );
}

/**
 * Vaste kop voor een Modal: eyebrow (optioneel), titel, beschrijving
 * (optioneel) en een optionele sluitknop rechts. Eén padding (`p-6 md:p-7`),
 * één titelgrootte (`text-lg`) en één hairline — de view-modals dreven eerder
 * uiteen (p-6/p-8, text-lg/text-xl, `border-slate-200/70` vs een in light
 * onzichtbare `border-rim`). Gebruik binnen een `flex flex-col`-modal
 * met `!p-0`; de body eronder krijgt zijn eigen padding.
 * `leading` is het enige extra slot (icoontegel of terugknop vóór de tekst);
 * andere knoppen horen in de body of de knoppenrij, niet in de kop.
 */
export function ModalHeader({
  eyebrow,
  title,
  description,
  onClose,
  leading,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  onClose?: () => void;
  leading?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-6 md:p-7 border-b border-hairline shrink-0">
      <div className="flex min-w-0 items-center gap-3">
        {leading ? <div className="shrink-0">{leading}</div> : null}
        <div className="min-w-0">
          {eyebrow ? <p className="text-micro text-oker-700">{eyebrow}</p> : null}
          <h2 className={cn('text-section-title', eyebrow && 'mt-1.5')}>{title}</h2>
          {description ? <p className="mt-1.5 text-body font-normal text-slate-500">{description}</p> : null}
        </div>
      </div>
      {onClose ? (
        <button
          type="button"
          aria-label="Sluiten"
          onClick={onClose}
          className="w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 inline-flex items-center justify-center shrink-0 text-slate-400 hover:bg-surface-soft-hover hover:text-slate-700 rounded-xl transition-colors"
        >
          <X size={18} />
        </button>
      ) : null}
    </div>
  );
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Verwijderen',
  cancelText = 'Annuleren',
  variant = 'danger',
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
  /** Extra invoer onder de boodschap, bv. een tekstvak voor een reden. */
  children?: React.ReactNode;
}) {
  // Op de gedeelde Modal gebouwd, met `boven` (hogere z-index + stapel-besef
  // voor ESC/focus-trap): als eigen portal op z-[100] rendert een bevestiging
  // die vanuit een open modal wordt geopend (bv. verwijderen in
  // Gebruikersbeheer) áchter die modal — de knop leek dan gewoon dood. Via de
  // Modal krijgt hij nu ook ESC, focus-trap en focus-herstel, die deze
  // variant miste.
  return (
    <Modal open={isOpen} onClose={onClose} maxWidth="md" ariaLabel={title} boven>
      <div className="flex max-h-overlay flex-col overflow-hidden">
        <div className="p-6 md:p-7 border-b border-hairline shrink-0">
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center mb-4', variant === 'danger' ? 'bg-red-500/12 text-red-700' : 'bg-amber-500/15 text-amber-700')}>
            <AlertTriangle size={20} />
          </div>
          <h2 className="text-section-title">{title}</h2>
          <p className="text-body text-slate-500 font-normal mt-1.5">{message}</p>
          {children && <div className="mt-4">{children}</div>}
        </div>
        <div className="p-5 md:p-6 bg-slate-50/80 flex gap-2.5 shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl font-semibold text-sm text-slate-600 hover:bg-surface-row-hover hover:text-slate-900 border border-transparent hover:border-hairline transition-colors">
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            /* warning = de semantische amber-kleur, net als het icoon erboven —
               niet het merk-oker (dat mengde twee talen in één dialoog).
               Tekst op amber is altijd VHB Black (huisstijlregel; wit op
               amber-600 haalde ≈3,6:1, onder AA — controle-ronde 27-08). */
            className={cn('flex-1 px-4 py-3 rounded-xl font-semibold text-sm transition-colors ring-1 ring-inset ring-ink/10', variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-600/90' : 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-amber-500/20')}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Gedeelde lege staat: herkenbaar symbool, links uitgelijnde tekst en
 * optioneel één actie. Compact gebruikt dezelfde taal in een korte rij.
 */

/** Toestand van een lege staat: niets te zien, alles afgehandeld, of stuk. */
export type LegeStaatVariant = 'leeg' | 'klaar' | 'fout';

export function EmptyState({
  icon,
  illustratie,
  variant = 'leeg',
  title,
  message,
  action,
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
  icon?: React.ReactNode;
  illustratie?: React.ReactNode;
  variant?: LegeStaatVariant;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  const StandaardIllustratie = variant === 'klaar' ? AllesGedaan : variant === 'fout' ? Fout : LegeLijst;
  const beeld = illustratie ?? icon ?? <StandaardIllustratie compact={compact} />;

  if (compact) {
    return (
      <div className={cn('surface-muted @container min-w-0 rounded-2xl px-4 py-4', className)}>
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 @[28rem]:grid-cols-[auto_minmax(0,1fr)_auto]">
          <span aria-hidden="true" className="flex items-center border-r border-hairline pr-4 text-slate-600 [&_svg]:h-8 [&_svg]:w-8 [&_svg]:stroke-[1.5]">{beeld}</span>
          <div className="min-w-0">
            <p className="text-md font-semibold text-slate-800 [overflow-wrap:anywhere]">{title}</p>
            {message ? <p className="mt-1 text-body-sm text-slate-500 [overflow-wrap:anywhere]">{message}</p> : null}
          </div>
          {action ? <div className="col-span-2 flex min-w-0 flex-wrap gap-2 @[28rem]:col-span-1 @[28rem]:col-start-3 @[28rem]:justify-end">{action}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('surface-muted flex h-full min-w-0 flex-col items-start rounded-2xl p-5 text-left', className)}>
      <span aria-hidden="true" className="mb-4 flex text-slate-600 [&_svg]:h-16 [&_svg]:w-16">{beeld}</span>
      <div className="min-w-0 max-w-md flex-1">
        <h3 className="text-card-title text-slate-800 [overflow-wrap:anywhere]">{title}</h3>
        {message ? <p className="mt-2 text-body-sm text-slate-500 [overflow-wrap:anywhere]">{message}</p> : null}
      </div>
      {action ? <div className="mt-5 flex max-w-full flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * Dé laadfout van een scherm (next-level 2, punt 17): één taal voor "dit kon
 * niet laden" met altijd een uitweg. EmptyState in de fout-variant met de
 * Fout-illustratie, een korte boodschap en "Opnieuw proberen" (secundair,
 * met bezig-staat zolang de retry loopt). `compact` = één rij, voor bóven
 * een lijst die nog oude data toont (mislukte verversing) of in een kaart.
 * Schrijffouten blijven toasts; dit is alleen voor laden.
 */
export function Foutkaart({
  boodschap,
  titel,
  onOpnieuw,
  bezig,
  offline = false,
  compact = false,
  className,
}: {
  /** Korte boodschap ("De gele boek kon niet laden."). */
  boodschap: string;
  titel?: string;
  /** Retry; een Promise houdt de knop bezig tot hij afgerond is. */
  onOpnieuw?: () => void | Promise<void>;
  /** Bezig-staat van buitenaf (bv. `zl.laden`); anders volgt de kaart de Promise. */
  bezig?: boolean;
  /** Zonder bereik: de knop blijft, de boodschap zegt waarom. */
  offline?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [eigenBezig, setEigenBezig] = useState(false);
  const isBezig = bezig ?? eigenBezig;
  const opnieuw = async () => {
    if (!onOpnieuw || isBezig) return;
    const r = onOpnieuw();
    if (r && typeof (r as Promise<void>).then === 'function') {
      setEigenBezig(true);
      try { await r; } finally { setEigenBezig(false); }
    }
  };
  const knop = onOpnieuw ? (
    <Button variant="secondary" size={compact ? 'sm' : 'md'} icon={<RefreshCw size={16} />} bezig={isBezig} onClick={() => void opnieuw()}>
      Opnieuw proberen
    </Button>
  ) : undefined;
  return (
    <div role="alert" className={cn('min-w-0', className)}>
      <EmptyState
        compact={compact}
        variant="fout"
        illustratie={offline ? <GeenBereik /> : <Fout compact={compact} />}
        title={titel ?? (compact ? 'Bijwerken is niet gelukt' : 'Dit kon niet laden')}
        message={offline ? `${boodschap} Je bent offline; probeer opnieuw zodra er bereik is.` : boodschap}
        action={knop}
      />
    </div>
  );
}

/**
 * Stille versheidsregel "Bijgewerkt om 14:32" (text-micro) op één vaste
 * plek: rechts in de PageHeader-acties, vóór de knoppen. Tijdens een stille
 * verversing "Bijwerken…", zonder bereik "Offline · …". Vóór de eerste laad
 * rendert hij niets, zodat de kop niet verspringt.
 */
export function VersheidRegel({ className, ...versheid }: Versheid & { className?: string }) {
  const tekst = versheidTekst(versheid);
  if (!tekst) return null;
  return (
    // Mobiel: eigen regel onder de knoppen (basis-full + order-last), zodat de
    // ene gouden knop niet door een tijdstip van zijn plek geduwd wordt;
    // vanaf md gewoon links van de knoppen op dezelfde rij.
    <p className={cn('text-micro order-last basis-full self-center whitespace-nowrap text-right max-sm:text-left md:order-none md:basis-auto md:text-left', className)} aria-live="polite">
      {tekst}
    </p>
  );
}

export function ViewLoader() {
  // Skeleton i.p.v. spinner: de pagina-opbouw (kop + lijst) staat er al
  // tijdens het laden — dat oogt op 4G rustiger dan een draaiend wiel in
  // een verder leeg scherm. Zelfde shimmer-DNA als de dashboard-skeletons.
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Scherm wordt geladen">
      <div className="px-1 pt-1 space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3 w-44" />
      </div>
      <div className="surface-card rounded-3xl overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <SkeletonRow className="border-b border-hairline-subtle last:border-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skelet-tegel met de opbouw van een OpsStat (ops.tsx): kop van 1,75 rem
 * (icoontegel h-7 + label), groot cijfer op de text-stat-regel (2 rem),
 * subregel (text-xs = 1 rem, of text-sm = 1,25 rem bij `subGroot`), en
 * optioneel de detailregels, de meter en de compacte DienstBalk (pt-7 pb-4
 * rond een h-1-baan). De wrappers hebben de regelhoogtes van de echte
 * tekst, zodat de tegel even hoog is als de tegel die hem straks vervangt.
 */
function TegelSkelet({ className, subGroot = false, regels = 0, balk = false, meter = false }: {
  className?: string;
  subGroot?: boolean;
  regels?: number;
  balk?: boolean;
  meter?: boolean;
}) {
  return (
    <div className={cn('rounded-3xl p-4', className)} style={{ background: 'var(--tile-bg-soft)', border: 'var(--tile-border-soft)' }}>
      <div className="flex h-7 items-center gap-2">
        <Skeleton rounded="lg" className="h-7 w-7 shrink-0" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="mt-2.5 flex h-8 items-center"><Skeleton className="h-5 w-24" /></div>
      <div className={cn('mt-0.5 flex items-center', subGroot ? 'h-5' : 'h-4')}><Skeleton className={cn(subGroot ? 'h-3 w-36' : 'h-2.5 w-28')} /></div>
      {meter && <Skeleton rounded="full" className="mt-2 h-1.5 w-full" />}
      {regels > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {Array.from({ length: regels }).map((_, i) => (
            <div key={i} className="flex h-4 items-center justify-between gap-3">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-2.5 w-14" />
            </div>
          ))}
        </div>
      )}
      {balk && (
        <div className="mt-1 pt-7 pb-4"><Skeleton rounded="full" className="h-1 w-full" /></div>
      )}
    </div>
  );
}

/** Skelet-paneel met de opbouw van een OpsPanel: kop (icoontegel + titel, mb-3.5) en drie rijen. */
function PaneelSkelet({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-3xl p-5', className)} style={{ background: 'var(--tile-bg-soft)', border: 'var(--tile-border-soft)' }}>
      <div className="mb-3.5 flex h-7 items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Skeleton rounded="lg" className="h-7 w-7" />
          <Skeleton className="h-3.5 w-32" />
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
      <SkeletonRow className="px-0" />
      <SkeletonRow className="px-0" />
      <SkeletonRow className="px-0" />
    </div>
  );
}

/**
 * Layout-getrouw skelet van het dashboard (next-level 2, punt 7): groet-regel,
 * de tegelstrip in hetzelfde raster als DashboardView/PlannerDashboardWidgets
 * (`grid-cols-2 md:grid-cols-3 xl:grid-cols-6`: twee grote tegels van drie
 * kolommen, drie kleine van twee), daaronder de twee panelen (`lg:grid-cols-3`,
 * 2 + 1) en op smal scherm de snelle acties. De AppSkeleton toont dit bij een
 * warme start op `/`, de Suspense-fallback van het dashboard in App.tsx ook:
 * zo is de app "er al bijna" in plaats van een lijst die in een raster verandert.
 */
export function DashboardSkelet() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Scherm wordt geladen">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-1 pt-1 md:items-end">
        <div className="min-w-0 flex-1 basis-[14rem]">
          {/* text-greeting: 1,25 rem × 1,15 (md 1,5 rem); subregel text-md. */}
          <div className="flex h-6 items-center md:h-7"><Skeleton className="h-5 w-56 md:h-6 md:w-72" /></div>
          <div className="mt-0.5 flex h-5.5 items-center"><Skeleton className="h-3 w-44" /></div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Skeleton rounded="full" className="h-6 w-24" />
          <Skeleton rounded="lg" className="h-11 w-11 sm:pointer-fine:h-8 sm:pointer-fine:w-8" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <TegelSkelet className="col-span-2 md:col-span-1 xl:col-span-3" subGroot regels={2} balk />
        <TegelSkelet className="col-span-2 md:col-span-1 xl:col-span-3" subGroot regels={2} />
        <TegelSkelet className="xl:col-span-2" meter />
        <TegelSkelet className="xl:col-span-2" />
        <TegelSkelet className="col-span-2 md:col-span-1 xl:col-span-2" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PaneelSkelet className="lg:col-span-2" />
        <PaneelSkelet />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex h-16 items-center gap-3 rounded-2xl px-4" style={{ background: 'var(--tile-bg-soft)', border: 'var(--tile-border-soft)' }}>
            <Skeleton rounded="lg" className="h-8 w-8 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-2.5 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CredentialsModal({
  isOpen,
  onClose,
  title,
  email,
  password,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  email: string;
  password: string;
}) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`E-mail: ${email}\nTijdelijk wachtwoord: ${password}`);
    } catch (error) {
      console.error('Clipboard copy failed:', error);
    }
  };

  // Zelfde verhaal als ConfirmationModal: op de gedeelde Modal met `boven`,
  // zodat hij ook bóven een open formulier-modal (Gebruikersbeheer) rendert
  // en ESC/focus-trap meekrijgt.
  return (
    <Modal open={isOpen} onClose={onClose} maxWidth="md" ariaLabel={title} boven>
      <div className="flex max-h-overlay flex-col overflow-hidden">
        <div className="p-6 md:p-7 border-b border-hairline flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-section-title">{title}</h2>
            <p className="mt-1.5 text-body text-slate-500 font-normal">Bewaar deze gegevens of stuur ze door naar de gebruiker.</p>
          </div>
          <button aria-label="Sluiten" onClick={onClose} className="w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 inline-flex items-center justify-center shrink-0 text-slate-400 hover:bg-surface-soft-hover hover:text-slate-700 rounded-xl transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 md:p-7 space-y-3 overflow-y-auto flex-1">
          <div className="surface-muted rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">E-mailadres</p>
            <p className="mt-1.5 font-semibold text-slate-800 break-all">{email}</p>
          </div>
          <div className="surface-muted rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Tijdelijk wachtwoord</p>
            <p className="mt-1.5 font-mono font-semibold text-slate-800">{password}</p>
          </div>
          <div className="flex gap-2.5 pt-2">
            <Button variant="secondary" className="flex-1" onClick={handleCopy}>
              Kopieer gegevens
            </Button>
            <Button variant="primary" className="flex-1" onClick={onClose}>
              Sluiten
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
