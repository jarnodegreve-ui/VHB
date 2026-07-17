import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/ui';

export function ChangePasswordModal({
  isOpen,
  onClose,
  email,
}: {
  isOpen: boolean;
  onClose: () => void;
  email: string;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Succes-timer opruimen: zonder cleanup sloot een heropende modal na
  // <1,8s vanzelf weer (oude timer vuurde alsnog).
  const closeTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess(false);
    setIsSubmitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!supabase) {
      setError('Supabase is niet geconfigureerd.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Nieuw wachtwoord moet minstens 6 tekens zijn.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Wachtwoorden komen niet overeen.');
      return;
    }

    if (newPassword === currentPassword) {
      setError('Nieuw wachtwoord moet verschillen van het huidige.');
      return;
    }

    setIsSubmitting(true);

    // Re-authenticate to confirm the current password is correct.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: currentPassword,
    });

    if (signInError) {
      setError('Huidig wachtwoord is niet correct.');
      setIsSubmitting(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      setError('Wachtwoord wijzigen is mislukt. Probeer later opnieuw.');
      setIsSubmitting(false);
      return;
    }

    setSuccess(true);
    setIsSubmitting(false);
    closeTimerRef.current = window.setTimeout(handleClose, 1800);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          style={{
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="glass-modal rounded-3xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="p-6 md:p-8 border-b border-white/70 flex items-start justify-between gap-4 shrink-0">
              <div>
                <h4 className="text-lg font-bold tracking-tight">Wachtwoord wijzigen</h4>
                <p className="mt-2 text-sm text-slate-500 font-medium">Kies een nieuw wachtwoord voor {email}.</p>
              </div>
              <button
                onClick={handleClose}
                aria-label="Sluiten"
                className="w-11 h-11 inline-flex items-center justify-center text-slate-400 hover:bg-slate-50 rounded-xl shrink-0 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-5 overflow-y-auto flex-1">
              <div className="space-y-1.5">
                <label htmlFor="cpm-current-password" className="block text-xs font-bold text-slate-500 uppercase tracking-[0.08em]">Huidig wachtwoord</label>
                <input
                  id="cpm-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => { setCurrentPassword(e.target.value); setError(''); }}
                  className="control-input w-full px-4 py-3.5 rounded-2xl font-medium text-slate-800 placeholder:text-slate-300 outline-none transition-all"
                  required
                  placeholder="••••••••"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="cpm-new-password" className="block text-xs font-bold text-slate-500 uppercase tracking-[0.08em]">Nieuw wachtwoord</label>
                <input
                  id="cpm-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError(''); }}
                  className="control-input w-full px-4 py-3.5 rounded-2xl font-medium text-slate-800 placeholder:text-slate-300 outline-none transition-all"
                  required
                  minLength={6}
                  placeholder="Minstens 6 tekens"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="cpm-confirm-password" className="block text-xs font-bold text-slate-500 uppercase tracking-[0.08em]">Bevestig nieuw wachtwoord</label>
                <input
                  id="cpm-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  className="control-input w-full px-4 py-3.5 rounded-2xl font-medium text-slate-800 placeholder:text-slate-300 outline-none transition-all"
                  required
                  minLength={6}
                  placeholder="Herhaal nieuw wachtwoord"
                />
              </div>

              {error && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <p className="text-red-600 text-sm font-medium">{error}</p>
                </motion.div>
              )}

              {success && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                  <p className="text-emerald-700 text-sm font-medium">Wachtwoord succesvol gewijzigd.</p>
                </motion.div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 px-4 py-3 rounded-xl font-semibold text-slate-600 hover:bg-white/70 hover:text-slate-900 transition-all text-sm border border-transparent hover:border-white/80"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || success}
                  className={cn('btn-primary ios-pressable flex-1 px-4 py-3 text-xs uppercase tracking-[0.08em]')}
                >
                  {isSubmitting ? 'Opslaan...' : 'Opslaan'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
