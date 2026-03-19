import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/ui';

export function AdminPageHeader({
  eyebrow = 'Beheer',
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <section className="surface-card rounded-[32px] px-6 py-6 md:px-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{eyebrow}</p>
          <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-900 md:text-3xl">{title}</h3>
          <p className="mt-2 text-sm font-medium leading-7 text-slate-500 md:text-base">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </section>
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
        {eyebrow ? <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{eyebrow}</p> : null}
        <h3 className="mt-2 text-lg font-black tracking-tight text-slate-900 md:text-xl">{title}</h3>
        {description ? <p className="mt-1 text-sm font-medium text-slate-500">{description}</p> : null}
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
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="glass-modal rounded-[40px] w-full max-w-md overflow-hidden">
            <div className="p-8 border-b border-white/70">
              <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center mb-4', variant === 'danger' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600')}>
                <AlertTriangle size={24} />
              </div>
              <h4 className="text-xl font-black">{title}</h4>
              <p className="text-sm text-slate-500 font-medium mt-2">{message}</p>
            </div>
            <div className="p-8 bg-white/40 flex gap-3 backdrop-blur-sm">
              <button onClick={onClose} className="flex-1 px-4 py-4 rounded-2xl font-black text-slate-500 hover:bg-white/70 transition-all uppercase tracking-widest text-xs border border-transparent hover:border-white/80">
                {cancelText}
              </button>
              <button
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className={cn('flex-1 px-4 py-4 rounded-2xl font-black text-white transition-all shadow-xl uppercase tracking-widest text-xs', variant === 'danger' ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20')}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function EmptyState({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="text-center py-12 surface-card rounded-[32px] border border-dashed border-white/80">
      <div className="w-16 h-16 bg-white/75 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300 shadow-sm ring-1 ring-white/80">{icon}</div>
      <h4 className="text-lg font-black text-slate-800 tracking-tight">{title}</h4>
      <p className="mt-2 text-sm font-medium text-slate-400">{message}</p>
    </div>
  );
}

export function ViewLoader() {
  return (
    <div className="flex min-h-[280px] items-center justify-center">
      <div className="rounded-[28px] border border-white/60 bg-white/85 px-6 py-5 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-oker-500" />
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Laden</p>
            <p className="text-sm font-bold text-slate-800">Scherm wordt voorbereid...</p>
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

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="glass-modal rounded-[32px] w-full max-w-md overflow-hidden">
            <div className="p-8 border-b border-white/70 flex items-center justify-between">
              <div>
                <h4 className="text-xl font-black">{title}</h4>
                <p className="mt-2 text-sm text-slate-500 font-medium">Bewaar deze gegevens of stuur ze door naar de gebruiker.</p>
              </div>
              <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-8 space-y-4">
              <div className="surface-muted rounded-2xl p-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">E-mailadres</p>
                <p className="mt-2 font-bold text-slate-800 break-all">{email}</p>
              </div>
              <div className="surface-muted rounded-2xl p-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tijdelijk wachtwoord</p>
                <p className="mt-2 font-mono font-bold text-slate-800">{password}</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleCopy} className="flex-1 px-4 py-3 rounded-xl font-bold text-slate-700 control-button-soft transition-all">
                  Kopieer gegevens
                </button>
                <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl font-bold bg-oker-500 text-white hover:bg-oker-600 transition-colors shadow-lg shadow-oker-500/20">
                  Sluiten
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
