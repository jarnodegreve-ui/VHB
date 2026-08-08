import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/ui';
import { Button } from './primitives';
import { BrandBus } from './BrandBus';
import { Modal } from './Modal';
import { Skeleton, SkeletonRow } from './Skeleton';

export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  /** @deprecated Eén canvasbreedte voor de hele app — de prop wordt
   *  genegeerd. Bij het navigeren verspringt het frame zo nooit meer
   *  (voorheen 3xl/4xl/5xl/6xl door elkaar). */
  width?: '3xl' | '4xl' | '5xl' | '6xl';
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
        {eyebrow ? (
          <p className="text-2xs font-medium uppercase tracking-[0.08em] text-slate-500">{eyebrow}</p>
        ) : null}
        {/* text-2xl/3xl + bold (geen black): de kop wint het van de rest door
            máát, niet door extra gewicht — dat houdt de pagina rustig. */}
        <h3 className={cn('section-title font-bold tracking-[-0.02em] text-slate-900 leading-[1.1] text-2xl md:text-3xl', eyebrow && 'mt-1.5')}>
          {title}
        </h3>
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
        {eyebrow ? <p className="text-2xs font-medium uppercase tracking-[0.08em] text-slate-500">{eyebrow}</p> : null}
        <h3 className="mt-1.5 text-lg font-bold tracking-tight text-slate-900 md:text-xl">{title}</h3>
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
 * onzichtbare `border-white/70`). Gebruik binnen een `flex flex-col`-modal
 * met `!p-0`; de body eronder krijgt zijn eigen padding.
 */
export function ModalHeader({
  eyebrow,
  title,
  description,
  onClose,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-6 md:p-7 border-b border-slate-200/70 shrink-0">
      <div className="min-w-0">
        {eyebrow ? <p className="text-2xs font-medium uppercase tracking-[0.08em] text-oker-600">{eyebrow}</p> : null}
        <h4 className={cn('text-lg font-bold tracking-tight text-slate-900', eyebrow && 'mt-1.5')}>{title}</h4>
        {description ? <p className="mt-1.5 text-sm font-normal leading-relaxed text-slate-500">{description}</p> : null}
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
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center mb-4', variant === 'danger' ? 'bg-red-500/12 text-red-600' : 'bg-amber-500/15 text-amber-600')}>
            <AlertTriangle size={22} />
          </div>
          <h4 className="text-lg font-bold tracking-tight">{title}</h4>
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
            className={cn('flex-1 px-4 py-3 rounded-xl font-semibold text-sm transition-all shadow-lg', variant === 'danger' ? 'text-white bg-red-600 hover:bg-red-700 shadow-red-600/20' : 'text-slate-950 bg-oker-500 hover:bg-oker-400 shadow-oker-500/20')}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Brand-empty-state met de VHB-busje-mascotte by default. Bestaande
 * EmptyState-aanroepen krijgen het busje automatisch — `icon` wordt
 * genegeerd tenzij je `mascotte={false}` zet (dan valt-back op icon).
 */
export function EmptyState({
  icon,
  title,
  message,
  mascotte = true,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  mascotte?: boolean;
  /** Optionele call-to-action (knop/link) onder de uitleg — lege schermen
   *  geven zo altijd een volgende stap. */
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-10 surface-card rounded-3xl !border-dashed">
      {mascotte ? (
        /* Bewust bescheiden: het busje is een accent bij de boodschap, geen
           blikvanger (Jarno: "te aanwezig"). */
        <div className="bus-sway mx-auto mb-3 inline-block">
          <BrandBus width={88} />
        </div>
      ) : (
        <div className="w-14 h-14 bg-slate-100/80 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
          {icon}
        </div>
      )}
      <h4 className="text-base font-bold text-slate-800 tracking-tight">{title}</h4>
      {message ? <p className="mt-1.5 text-sm font-normal text-slate-500 max-w-md mx-auto">{message}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
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
            <h4 className="text-lg font-bold tracking-tight">{title}</h4>
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
