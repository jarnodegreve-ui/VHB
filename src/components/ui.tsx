import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/ui';
import { Button } from './primitives';
import { Modal } from './Modal';
import { Skeleton, SkeletonRow } from './Skeleton';
import { BrandMotief, type MotiefVariant } from './BrandMotief';

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
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    // flex-wrap: op mobiel staat de (nu ene) primaire knop + "…" naast de
    // titel zolang dat past; bij een lange titel zakt de actie eronder.
    // Voorheen stapelden drie volle-breedte-knoppen onder de kop
    // (afwerking 04-09, nr. 7).
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 md:items-end">
      <div className="min-w-0 flex-1 basis-[14rem] max-w-3xl">
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
      {actions ? <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 md:gap-3">{actions}</div> : null}
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
          className="w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 inline-flex items-center justify-center shrink-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700 rounded-xl transition-colors"
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
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
}) {
  // Op de gedeelde Modal gebouwd, met `boven` (hogere z-index + stapel-besef
  // voor ESC/focus-trap): als eigen portal op z-[100] rendert een bevestiging
  // die vanuit een open modal wordt geopend (bv. verwijderen in
  // Gebruikersbeheer) áchter die modal — de knop leek dan gewoon dood. Via de
  // Modal krijgt hij nu ook ESC, focus-trap en focus-herstel, die deze
  // variant miste.
  return (
    <Modal open={isOpen} onClose={onClose} maxWidth="md" ariaLabel={title} boven>
      <div className="flex max-h-[88dvh] flex-col overflow-hidden">
        <div className="p-6 md:p-7 border-b border-hairline shrink-0">
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center mb-4', variant === 'danger' ? 'bg-red-500/12 text-red-700' : 'bg-amber-500/15 text-amber-700')}>
            <AlertTriangle size={20} />
          </div>
          <h2 className="text-section-title">{title}</h2>
          <p className="text-body text-slate-500 font-normal mt-1.5">{message}</p>
        </div>
        <div className="p-5 md:p-6 bg-slate-50/80 flex gap-2.5 shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl font-semibold text-sm text-slate-600 hover:bg-surface-row-hover hover:text-slate-900 border border-transparent hover:border-hairline transition-all">
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
            className={cn('flex-1 px-4 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg', variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-600/90 shadow-red-600/20' : 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-amber-500/20')}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Empty-state: streep-motief (BrandMotief) + boodschap. `variant` kiest het
 * motief: 'leeg' (niets hier), 'klaar' (alles afgehandeld — goud vinkje) of
 * 'fout' (uitroep-accent). Met een expliciet `icon` blijft de gedempte
 * icoon-tegel van vroeger; met `illustratie` (src/components/illustraties)
 * komt er een lijnillustratie op het merkteken — voor de belangrijkste
 * lege staten van een scherm (max. 96 px hoog op mobiel, 128 op desktop).
 * Het busje (BrandBus-mascotte) is 01-09 volledig uitgefaseerd (vraag
 * Jarno) — de git-historiek bewaart hem.
 */
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
  /** Compact: één rustige rij (motief klein links, tekst ernaast) — voor
   *  detailpanelen en zijvakken, waar een hoge lege kaart uit de toon valt. */
  compact?: boolean;
  className?: string;
  /** Eigen icoon in de tegel; zonder icoon toont de staat het lus-motief. */
  icon?: React.ReactNode;
  /** Lijnillustratie (`<LegeLijst />`, `<AllesGedaan />`, …) i.p.v. motief of icoon. */
  illustratie?: React.ReactNode;
  /** Motief zonder `icon`: 'klaar' waar leeg = alles afgehandeld/niets open. */
  variant?: MotiefVariant;
  title: string;
  message?: string;
  /** Optionele call-to-action (knop/link) onder de uitleg — lege schermen
   *  geven zo altijd een volgende stap. */
  action?: React.ReactNode;
}) {
  if (compact) {
    return (
      <div className={cn('surface-muted flex items-center gap-4 rounded-2xl px-4 py-3.5', className)}>
        {illustratie ? (
          <span className="flex shrink-0 items-center text-slate-400 [&_svg]:h-12 [&_svg]:w-auto">{illustratie}</span>
        ) : icon ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-slate-400">{icon}</div>
        ) : (
          <BrandMotief variant={variant} className="h-7 w-14 shrink-0 text-slate-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-md font-semibold text-slate-800">{title}</p>
          {message ? <p className="mt-0.5 text-xs text-slate-500">{message}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    );
  }
  // Rustige gedempte kaart i.p.v. de hoge stippellijn-kaart: een lege staat
  // is geen dropzone, en op desktop vulde die kaart een half scherm
  // (afwerkingsronde 04-09, nr. 4).
  return (
    <div className={cn('surface-muted rounded-2xl px-6 py-7 text-center', className)}>
      {illustratie ? (
        <span className="mx-auto mb-3 flex justify-center text-slate-400 [&_svg]:h-24 [&_svg]:w-auto lg:[&_svg]:h-32">{illustratie}</span>
      ) : icon ? (
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-muted text-slate-400">{icon}</div>
      ) : (
        <BrandMotief variant={variant} className="mx-auto mb-3 h-9 w-[4.5rem] text-slate-400" />
      )}
      <h3 className="text-md font-semibold text-slate-800">{title}</h3>
      {message ? <p className="mx-auto mt-1 max-w-md text-body-sm text-slate-500">{message}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
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
      <div className="flex max-h-[88dvh] flex-col overflow-hidden">
        <div className="p-6 md:p-7 border-b border-hairline flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-section-title">{title}</h2>
            <p className="mt-1.5 text-body text-slate-500 font-normal">Bewaar deze gegevens of stuur ze door naar de gebruiker.</p>
          </div>
          <button aria-label="Sluiten" onClick={onClose} className="w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 inline-flex items-center justify-center shrink-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700 rounded-xl transition-colors">
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
