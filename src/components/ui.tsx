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
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('max-w-[1200px] mx-auto space-y-6 md:space-y-8', className)}>{children}</div>;
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
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <p className="text-micro">{eyebrow}</p> : null}
        {/* Eén h1 per scherm, in de page-title-rol (24/30 px, bold — geen
            black): de kop wint het van de rest door máát, niet door gewicht. */}
        <h1 className={cn('text-page-title', eyebrow && 'mt-1.5')}>
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-sm font-normal leading-relaxed text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

export function AdminSubsectionHeader({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? <p className="text-micro">{eyebrow}</p> : null}
        <h2 className={cn('text-section-title', eyebrow && 'mt-1.5')}>{title}</h2>
        {description ? <p className="mt-1 text-sm font-normal text-slate-500">{description}</p> : null}
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-3">{aside}</div> : null}
    </div>
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
    <div className="flex items-start justify-between gap-3 p-6 md:p-7 border-b border-slate-200/70 shrink-0">
      <div className="flex min-w-0 items-center gap-3">
        {leading ? <div className="shrink-0">{leading}</div> : null}
        <div className="min-w-0">
          {eyebrow ? <p className="text-micro text-oker-700">{eyebrow}</p> : null}
          <h2 className={cn('text-section-title', eyebrow && 'mt-1.5')}>{title}</h2>
          {description ? <p className="mt-1.5 text-sm font-normal leading-relaxed text-slate-500">{description}</p> : null}
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
        <div className="p-6 md:p-7 border-b border-slate-200/70 shrink-0">
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center mb-4', variant === 'danger' ? 'bg-red-500/12 text-red-700' : 'bg-amber-500/15 text-amber-700')}>
            <AlertTriangle size={20} />
          </div>
          <h2 className="text-section-title">{title}</h2>
          <p className="text-sm text-slate-500 font-normal mt-1.5 leading-relaxed">{message}</p>
        </div>
        <div className="p-5 md:p-6 bg-slate-50/80 flex gap-2.5 shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl font-semibold text-sm text-slate-600 hover:bg-surface-row-hover hover:text-slate-900 border border-transparent hover:border-slate-200 transition-all">
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
 * Empty-state: lus-motief (BrandMotief) + boodschap. `variant` kiest het
 * motief: 'leeg' (niets hier), 'klaar' (alles afgehandeld — goud vinkje) of
 * 'fout' (uitroep-accent). Met een expliciet `icon` blijft de gedempte
 * icoon-tegel van vroeger. Het busje (BrandBus-mascotte) is 01-09 volledig
 * uitgefaseerd (vraag Jarno) — de git-historiek bewaart hem.
 */
export function EmptyState({
  icon,
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
        {icon ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-slate-400">{icon}</div>
        ) : (
          <BrandMotief variant={variant} className="h-7 w-14 shrink-0 text-slate-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
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
      {icon ? (
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-muted text-slate-400">{icon}</div>
      ) : (
        <BrandMotief variant={variant} className="mx-auto mb-3 h-9 w-[4.5rem] text-slate-400" />
      )}
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {message ? <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">{message}</p> : null}
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
            <SkeletonRow className="border-b border-slate-100 last:border-0" />
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
        <div className="p-6 md:p-7 border-b border-slate-200/70 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-section-title">{title}</h2>
            <p className="mt-1.5 text-sm text-slate-500 font-normal">Bewaar deze gegevens of stuur ze door naar de gebruiker.</p>
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
