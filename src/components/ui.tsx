import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/ui';
import { BrandBus } from './BrandBus';

export function PageShell({
  children,
  width = '4xl',
  className,
}: {
  children: React.ReactNode;
  width?: '3xl' | '4xl' | '5xl' | '6xl';
  className?: string;
}) {
  const widthClass = {
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
  }[width];
  return <div className={cn(widthClass, 'mx-auto space-y-6 md:space-y-8', className)}>{children}</div>;
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{eyebrow}</p>
        ) : null}
        <h3 className={cn('section-title font-black tracking-[-0.02em] text-slate-900 leading-[1.1] text-[26px] md:text-[30px]', eyebrow && 'mt-1.5')}>
          {title}
        </h3>
        {description ? (
          <p className="mt-2 text-sm md:text-[15px] font-normal leading-relaxed text-slate-500">{description}</p>
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
        {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{eyebrow}</p> : null}
        <h3 className="mt-1.5 text-lg font-bold tracking-tight text-slate-900 md:text-xl">{title}</h3>
        {description ? <p className="mt-1 text-sm font-normal text-slate-500">{description}</p> : null}
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-3">{aside}</div> : null}
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
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
}) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 16 }} className="glass-modal rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 md:p-7 border-b border-slate-200/70 shrink-0">
              <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center mb-4', variant === 'danger' ? 'bg-red-500/12 text-red-600' : 'bg-amber-500/15 text-amber-600')}>
                <AlertTriangle size={22} />
              </div>
              <h4 className="text-lg font-bold tracking-tight">{title}</h4>
              <p className="text-sm text-slate-500 font-normal mt-1.5 leading-relaxed">{message}</p>
            </div>
            <div className="p-5 md:p-6 bg-slate-50/80 flex gap-2.5 shrink-0">
              <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl font-semibold text-sm text-slate-600 hover:bg-white hover:text-slate-900 border border-transparent hover:border-slate-200 transition-all">
                {cancelText}
              </button>
              <button
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className={cn('flex-1 px-4 py-3 rounded-xl font-semibold text-sm text-white transition-all shadow-lg', variant === 'danger' ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20')}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
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
  message: string;
  mascotte?: boolean;
  /** Optionele call-to-action (knop/link) onder de uitleg — lege schermen
   *  geven zo altijd een volgende stap. */
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-12 surface-card rounded-3xl !border-dashed">
      {mascotte ? (
        <div className="bus-sway mx-auto mb-3 inline-block">
          <BrandBus width={170} />
        </div>
      ) : (
        <div className="w-14 h-14 bg-slate-100/80 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
          {icon}
        </div>
      )}
      <h4 className="text-base font-bold text-slate-800 tracking-tight">{title}</h4>
      <p className="mt-1.5 text-sm font-normal text-slate-500 max-w-md mx-auto">{message}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ViewLoader() {
  return (
    <div className="flex min-h-[280px] items-center justify-center">
      <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-5 py-4 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-oker-500" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Laden</p>
            <p className="text-sm font-semibold text-slate-800">Scherm wordt voorbereid...</p>
          </div>
        </div>
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

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 16 }} className="glass-modal rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 md:p-7 border-b border-slate-200/70 flex items-center justify-between shrink-0">
              <div>
                <h4 className="text-lg font-bold tracking-tight">{title}</h4>
                <p className="mt-1.5 text-sm text-slate-500 font-normal">Bewaar deze gegevens of stuur ze door naar de gebruiker.</p>
              </div>
              <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 md:p-7 space-y-3 overflow-y-auto flex-1">
              <div className="surface-muted rounded-xl p-4">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.08em]">E-mailadres</p>
                <p className="mt-1.5 font-semibold text-slate-800 break-all">{email}</p>
              </div>
              <div className="surface-muted rounded-xl p-4">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.08em]">Tijdelijk wachtwoord</p>
                <p className="mt-1.5 font-mono font-semibold text-slate-800">{password}</p>
              </div>
              <div className="flex gap-2.5 pt-2">
                <button onClick={handleCopy} className="flex-1 px-4 py-3 rounded-xl font-semibold text-sm text-slate-700 control-button-soft transition-all">
                  Kopieer gegevens
                </button>
                <button onClick={onClose} className="btn-primary ios-pressable flex-1 px-4 py-3 text-sm">
                  Sluiten
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
