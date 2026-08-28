import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Modal } from './Modal';
import { ModalHeader } from './ui';
import { Button } from './primitives';

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

  // Op de gedeelde Modal gebouwd (was een eigen portal zonder focus-trap,
  // ESC of scroll-lock — de enige dialoog die dat allemaal miste).
  return (
    <Modal open={isOpen} onClose={handleClose} maxWidth="md" ariaLabel="Wachtwoord wijzigen">
      <div className="flex max-h-[88dvh] flex-col overflow-hidden">
        <ModalHeader title="Wachtwoord wijzigen" description={`Kies een nieuw wachtwoord voor ${email}.`} onClose={handleClose} />

        <form onSubmit={handleSubmit} className="p-6 md:p-7 space-y-5 overflow-y-auto flex-1">
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
              className="flex-1 px-4 py-3 rounded-xl font-semibold text-slate-600 hover:bg-surface-row hover:text-slate-900 transition-all text-sm border border-transparent hover:border-white/80"
            >
              Annuleren
            </button>
            <Button type="submit" variant="primary" className="flex-1" disabled={isSubmitting || success}>
              {isSubmitting ? 'Opslaan…' : 'Opslaan'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
