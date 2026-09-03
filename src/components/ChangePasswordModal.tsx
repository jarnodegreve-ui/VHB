import React, { useEffect, useRef, useState } from 'react';
import { WACHTWOORD_MIN, WACHTWOORD_HINT } from '../lib/wachtwoord';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Modal } from './Modal';
import { ModalHeader } from './ui';
import { Button } from './primitives';
import { Field, Input } from './Field';

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

    if (newPassword.length < WACHTWOORD_MIN) {
      setError(`Nieuw wachtwoord moet minstens ${WACHTWOORD_MIN} tekens zijn.`);
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
          <Field label="Huidig wachtwoord" htmlFor="cpm-current-password">
            <Input
              id="cpm-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => { setCurrentPassword(e.target.value); setError(''); }}
              required
              placeholder="••••••••"
            />
          </Field>

          <Field label="Nieuw wachtwoord" htmlFor="cpm-new-password">
            <Input
              id="cpm-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setError(''); }}
              required
              minLength={WACHTWOORD_MIN}
              placeholder={WACHTWOORD_HINT}
            />
          </Field>

          <Field label="Bevestig nieuw wachtwoord" htmlFor="cpm-confirm-password">
            <Input
              id="cpm-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
              required
              minLength={WACHTWOORD_MIN}
              placeholder="Herhaal nieuw wachtwoord"
            />
          </Field>

          {error && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl">
              <AlertTriangle size={14} className="text-red-700 shrink-0" />
              <p className="text-red-700 text-sm font-medium">{error}</p>
            </motion.div>
          )}

          {success && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
              <CheckCircle size={14} className="text-emerald-700 shrink-0" />
              <p className="text-emerald-700 text-sm font-medium">Wachtwoord succesvol gewijzigd.</p>
            </motion.div>
          )}

          <div className="flex gap-3 pt-2">
            <Button variant="ghost" className="flex-1" onClick={handleClose}>
              Annuleren
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={isSubmitting || success}>
              {isSubmitting ? 'Opslaan…' : 'Opslaan'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
