import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/ui';

export type Toast = {
  id: number;
  message: string;
  tone?: 'success' | 'error' | 'info';
};

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-[120] w-[calc(100vw-2rem)] max-w-sm space-y-3">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            className={cn(
              'rounded-3xl border px-5 py-4 shadow-2xl backdrop-blur-sm',
              toast.tone === 'success' && 'border-emerald-200 bg-emerald-50/95 text-emerald-900',
              toast.tone === 'error' && 'border-red-200 bg-red-50/95 text-red-900',
              (!toast.tone || toast.tone === 'info') && 'border-slate-200 bg-white/95 text-slate-900'
            )}
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                'mt-0.5 h-2.5 w-2.5 rounded-full',
                toast.tone === 'success' && 'bg-emerald-500',
                toast.tone === 'error' && 'bg-red-500',
                (!toast.tone || toast.tone === 'info') && 'bg-oker-500'
              )} />
              <p className="flex-1 text-sm font-bold leading-5">{toast.message}</p>
              <button
                onClick={() => onDismiss(toast.id)}
                className="rounded-full p-1 text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-700"
                aria-label="Sluit melding"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
