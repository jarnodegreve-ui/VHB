import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle, ArrowRight, Lock, Mail, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getDaypartGreeting } from '../lib/interactive';
import { BrandWordmark } from '../components/BrandWordmark';

type Mode = 'login' | 'forgot';

export function LoginView({
  onLogin,
  recoveryMode = false,
  onRecoveryComplete,
}: {
  onLogin: (accessToken?: string) => Promise<void>;
  recoveryMode?: boolean;
  onRecoveryComplete?: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>('login');

  // Login is altijd licht — dark mode oogt vreemd op de licht-grijze
  // achtergrond. Verwijder de dark-class zolang LoginView gemount is en
  // herstel hem bij unmount (na succesvol inloggen).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const wasDark = html.classList.contains('dark');
    html.classList.remove('dark');
    return () => {
      if (wasDark) html.classList.add('dark');
    };
  }, []);

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [info, setInfo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetFeedback = () => {
    setError('');
    setInfo('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    resetFeedback();
    if (!supabase) {
      setError('Supabase is niet geconfigureerd.');
      setIsSubmitting(false);
      return;
    }
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInError) {
      setError('Inloggen mislukt. Controleer je e-mailadres en wachtwoord.');
      setIsSubmitting(false);
      return;
    }
    try {
      await onLogin(data.session?.access_token);
    } catch {
      setError('Sessie kon niet opgehaald worden. Probeer opnieuw.');
    }
    setIsSubmitting(false);
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    resetFeedback();
    if (!supabase) {
      setError('Supabase is niet geconfigureerd.');
      setIsSubmitting(false);
      return;
    }
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}` : undefined;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo,
    });
    if (resetError) {
      setError('We konden geen reset-link versturen. Controleer het e-mailadres.');
      setIsSubmitting(false);
      return;
    }
    setInfo('Check je inbox voor een reset-link.');
    setIsSubmitting(false);
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    resetFeedback();
    if (!supabase) {
      setError('Supabase is niet geconfigureerd.');
      setIsSubmitting(false);
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setError('Wachtwoord wijzigen is mislukt. Vraag een nieuwe reset-link aan.');
      setIsSubmitting(false);
      return;
    }
    await supabase.auth.signOut();
    await onRecoveryComplete?.();
    setInfo('Wachtwoord bijgewerkt. Log opnieuw in met je nieuwe wachtwoord.');
    setNewPassword('');
    setIsSubmitting(false);
  };

  const greeting = getDaypartGreeting();
  const headerCopy = recoveryMode
    ? { title: 'Nieuw wachtwoord', description: 'Kies een nieuw wachtwoord voor je account.' }
    : mode === 'forgot'
      ? { title: 'Wachtwoord vergeten', description: 'Vul je e-mail in — we sturen een reset-link.' }
      : { title: greeting, description: 'Meld je aan om verder te gaan.' };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 md:p-10 relative overflow-hidden">
      {/* Subtiele radial-gradient voor diepte — zonder warme tint */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 900px 600px at 50% 0%, rgba(148, 163, 184, 0.10) 0%, transparent 60%)',
        }}
      />

      <main className="w-full max-w-[440px] flex flex-col items-center gap-6">
        {/* Brand-header: wordmark + heritage-stripe — boven de kaart */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center text-center gap-2"
        >
          <BrandWordmark size="lg" className="items-center" />
          <div className="flex items-center gap-3 mt-2">
            <span className="h-px w-8 bg-slate-300" />
            <span className="text-[10px] font-bold uppercase tracking-[0.32em] text-slate-400">
              Sinds 1922
            </span>
            <span className="h-px w-8 bg-slate-300" />
          </div>
        </motion.div>

        {/* Form-card */}
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="panel ios-soft-panel w-full rounded-[28px] p-7 sm:p-9"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={`${mode}-${recoveryMode}`}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.22 }}
              className="mb-6"
            >
              <h2 className="text-[1.625rem] font-black text-slate-900 tracking-[-0.02em] leading-tight">
                {headerCopy.title}
              </h2>
              <p className="mt-1.5 text-sm text-slate-500 font-medium">{headerCopy.description}</p>
            </motion.div>
          </AnimatePresence>

          {recoveryMode ? (
            <form onSubmit={handleRecovery} className="space-y-4">
              <FieldInput
                icon={<Lock size={16} />}
                label="Nieuw wachtwoord"
                type="password"
                value={newPassword}
                onChange={(v) => {
                  setNewPassword(v);
                  resetFeedback();
                }}
                placeholder="Minstens 6 tekens"
                required
                minLength={6}
              />
              <FeedbackBlock error={error} info={info} />
              <SubmitButton loading={isSubmitting}>Wachtwoord opslaan</SubmitButton>
            </form>
          ) : mode === 'forgot' ? (
            <form onSubmit={handleForgot} className="space-y-4">
              <FieldInput
                icon={<Mail size={16} />}
                label="E-mailadres"
                type="email"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  resetFeedback();
                }}
                placeholder="naam@bedrijf.be"
                required
              />
              <FeedbackBlock error={error} info={info} />
              <SubmitButton loading={isSubmitting}>Verstuur reset-link</SubmitButton>
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  resetFeedback();
                }}
                className="w-full text-center text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 transition-colors pt-2"
              >
                ← Terug naar inloggen
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <FieldInput
                icon={<Mail size={16} />}
                label="E-mailadres"
                type="email"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  resetFeedback();
                }}
                placeholder="naam@bedrijf.be"
                required
                autoComplete="email"
              />
              <FieldInput
                icon={<Lock size={16} />}
                label="Wachtwoord"
                type="password"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  resetFeedback();
                }}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                rightSlot={
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      resetFeedback();
                    }}
                    className="text-[10px] font-bold uppercase tracking-widest text-oker-600 hover:text-oker-700 transition-colors"
                  >
                    Vergeten?
                  </button>
                }
              />
              <FeedbackBlock error={error} info={info} />
              <SubmitButton loading={isSubmitting}>Inloggen</SubmitButton>
            </form>
          )}

          {/* Trust badge */}
          <div className="mt-7 pt-5 border-t border-slate-200/70 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <ShieldCheck size={11} className="text-emerald-500" />
            Beveiligd via Supabase Auth
          </div>
        </motion.div>

        {/* Footer onder de kaart */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-center"
        >
          © {new Date().getFullYear()} Van Hoorebeke en Zoon · Intern gebruik
        </motion.div>
      </main>
    </div>
  );
}

// === Subcomponents ===

function FieldInput({
  icon,
  label,
  type,
  value,
  onChange,
  placeholder,
  required,
  minLength,
  autoComplete,
  rightSlot,
}: {
  icon: React.ReactNode;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.18em]">{label}</label>
        {rightSlot}
      </div>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          {icon}
        </div>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className="control-input w-full pl-11 pr-4 py-3.5 rounded-2xl font-medium text-slate-800 placeholder:text-slate-300 outline-none transition-all"
        />
      </div>
    </div>
  );
}

function FeedbackBlock({ error, info }: { error: string; info: string }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-50/80 border border-red-200/70"
        >
          <AlertTriangle size={14} className="text-red-500 shrink-0" />
          <p className="text-red-700 text-sm font-semibold">{error}</p>
        </motion.div>
      )}
      {info && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-50/80 border border-emerald-200/70"
        >
          <CheckCircle size={14} className="text-emerald-600 shrink-0" />
          <p className="text-emerald-700 text-sm font-semibold">{info}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="group w-full inline-flex items-center justify-center gap-2 py-4 mt-2 rounded-2xl text-sm font-black uppercase tracking-widest text-white transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
      style={{
        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.32), 0 8px 22px rgba(245, 158, 11, 0.25), 0 2px 6px rgba(245, 158, 11, 0.12)',
      }}
    >
      <span>{loading ? 'Even geduld…' : children}</span>
      {!loading && (
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  );
}
