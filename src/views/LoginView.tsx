import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react';
import { AlertTriangle, ArrowUp, CheckCircle, ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getDaypartGreeting } from '../lib/interactive';
import { BrandWordmark } from '../components/BrandWordmark';
import { MeshGradient } from '../components/MeshGradient';

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

  // === Tilt-parallax voor het form-card ===
  // Cursor-positie tov het card-center bepaalt subtiele 3D-rotation.
  // Max ~3° op elke as, met spring voor zachte respons. Touch-devices
  // krijgen geen tilt (pointer-event fires only on hover).
  const cardRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [3, -3]), {
    stiffness: 120,
    damping: 18,
    mass: 0.5,
  });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-3, 3]), {
    stiffness: 120,
    damping: 18,
    mass: 0.5,
  });

  const handleCardMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const node = cardRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    mouseX.set(px);
    mouseY.set(py);
  };
  const handleCardLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* SVG animated mesh gradient — vervangt de oude CSS radial-blobs.
          Vult de hele viewport, blur-effect via SVG-filter. */}
      <MeshGradient className="absolute inset-0 -z-10 w-full h-full pointer-events-none" />

      {/* Editorial divider lines — drie horizontale lijnen die zich op
          page-load uittekenen. Subtiel decoratief moment. */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="editorial-divider editorial-divider-1 absolute top-[18%]" />
        <div className="editorial-divider editorial-divider-2 absolute top-[50%]" />
        <div className="editorial-divider editorial-divider-3 absolute top-[82%]" />
      </div>

      {/* Asymmetrische editorial layout: wordmark links boven, form-card
          rechts van het midden. Op kleinere schermen valt 't terug op een
          gecentreerde stack. */}
      <div className="min-h-screen grid lg:grid-cols-[1fr_minmax(380px,_500px)_1fr] xl:grid-cols-[1fr_500px_minmax(60px,_180px)] gap-6 p-6 md:p-10">
        {/* === Linker editorial zone — wordmark + tagline === */}
        <aside className="hidden lg:flex flex-col justify-between py-8 pl-2 xl:pl-10">
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <BrandWordmark size="lg" animateLetters />
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="space-y-2 max-w-[280px]"
          >
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.24em]">
              Intern portaal
            </p>
            <p className="text-sm font-medium text-slate-500 leading-relaxed">
              Roosters, omleidingen, verlof en updates — alles op één plek.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]"
          >
            © {new Date().getFullYear()} Van Hoorebeke en Zoon · Intern gebruik
          </motion.div>
        </aside>

        {/* === Centrale form-zone === */}
        <main
          className="flex flex-col items-center justify-center"
          style={{ perspective: '1200px' }}
        >
          {/* Mobile-only wordmark (lg+ ziet 'm in de aside) */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="lg:hidden flex flex-col items-center text-center mb-6"
          >
            <BrandWordmark size="md" className="items-center" animateLetters />
          </motion.div>

          {/* Form-card met tilt-parallax + iridescent border + stacked glass */}
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
            className="glass-stack-wrap w-full max-w-[440px] will-change-transform"
          >
            {/* Stacked glass-panelen achter de hoofd-card */}
            <div className="glass-stack-back glass-stack-back-2 rounded-[28px]" />
            <div className="glass-stack-back glass-stack-back-1 rounded-[28px]" />

            {/* Iridescent wrapper geeft de shimmer-border, panel-card erbinnen */}
            <div
              ref={cardRef}
              onPointerMove={handleCardMove}
              onPointerLeave={handleCardLeave}
              className="iridescent-frame rounded-[28px]"
            >
              <div className="panel ios-soft-panel relative w-full rounded-[28px] p-7 sm:p-9">
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
              </div>{/* /panel */}
            </div>{/* /iridescent-frame */}
          </motion.div>

          {/* Mobile-only footer onder de card */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="lg:hidden mt-6 text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] text-center"
          >
            © {new Date().getFullYear()} Van Hoorebeke en Zoon · Intern gebruik
          </motion.div>
        </main>

        {/* Lege rechter-zone om asymmetrie te vormen (alleen xl+ als smalle gutter) */}
        <div aria-hidden className="hidden xl:block" />
      </div>
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
  // Focus-state voor de ademende oker-glow rond het actieve veld
  const [focused, setFocused] = useState(false);
  // Password-toggle: reveal-state per veld (alleen voor type='password')
  const isPassword = type === 'password';
  const [revealed, setRevealed] = useState(false);
  // Caps Lock-detectie in wachtwoordvelden
  const [capsLockOn, setCapsLockOn] = useState(false);
  const checkCaps = (e: React.KeyboardEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>) => {
    if ('getModifierState' in e && typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'));
    }
  };
  const effectiveType = isPassword && revealed ? 'text' : type;
  const showCapsWarning = isPassword && focused && capsLockOn;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-1 min-h-[14px]">
        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.18em]">{label}</label>
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {showCapsWarning && (
              <motion.span
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: 0.18 }}
                className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber-600"
                title="Caps Lock staat aan"
              >
                <ArrowUp size={10} strokeWidth={3} />
                Caps Lock
              </motion.span>
            )}
          </AnimatePresence>
          {rightSlot}
        </div>
      </div>
      <div className={`relative rounded-2xl transition-shadow ${focused ? 'field-glow' : ''}`}>
        <div
          className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors pointer-events-none ${
            focused ? 'text-oker-500' : 'text-slate-400'
          }`}
        >
          {icon}
        </div>
        <input
          type={effectiveType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => { setFocused(true); checkCaps(e); }}
          onBlur={() => { setFocused(false); setCapsLockOn(false); }}
          onKeyDown={isPassword ? checkCaps : undefined}
          onKeyUp={isPassword ? checkCaps : undefined}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className={`control-input w-full pl-11 py-3.5 rounded-2xl font-medium text-slate-800 placeholder:text-slate-300 outline-none transition-all no-focus-ring ${
            isPassword ? 'pr-12' : 'pr-4'
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
            tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors z-10"
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
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
