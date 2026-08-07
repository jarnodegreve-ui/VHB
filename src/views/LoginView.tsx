import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react';
import { AlertTriangle, ArrowUp, CheckCircle, ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '../components/primitives';
import { supabase } from '../lib/supabase';
import { applyThemeColorMeta, LOGIN_MELDING_KEY } from '../lib/ui';
import { BrandLogo } from '../components/BrandLogo';


type Mode = 'login' | 'forgot';

/**
 * Login-scherm — light variant.
 *
 * Lichte achtergrond met subtiele oker vignet, gecentreerde single-column
 * layout. VHB PORTAAL wordmark boven de form-card. Card gebruikt .panel.
 *
 * Login is altijd licht, los van de globale theme-toggle in de portal.
 * Tilt-parallax blijft op muis, uit op touch.
 * prefers-reduced-motion zet animaties uit (border + breathing wordmark).
 */
export function LoginView({
  onLogin,
  recoveryMode = false,
  onRecoveryComplete,
  melding = '',
}: {
  onLogin: (accessToken?: string) => Promise<void>;
  recoveryMode?: boolean;
  onRecoveryComplete?: () => Promise<void>;
  /** Reden van een gedwongen uitlog ('sessie' | 'account'), doorgegeven door
   *  App. sessionStorage vangt daarnaast het geval af dat de gebruiker de
   *  pagina herlaadt. */
  melding?: 'sessie' | 'account' | '';
}) {
  const [mode, setMode] = useState<Mode>('login');

  // Login is altijd licht, los van de globale theme-toggle. We removen
  // de html.dark class tijdelijk (wordt herstelt op unmount na succesvol
  // inloggen) zodat de hele login-context gegarandeerd licht is.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const wasDark = html.classList.contains('dark');
    html.classList.remove('dark');
    // Statusbalk mee in carbon zolang de login in beeld is.
    applyThemeColorMeta(true);
    return () => {
      if (wasDark) html.classList.add('dark');
      applyThemeColorMeta(wasDark);
    };
  }, []);

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [info, setInfo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Waarom sta je hier? Een gedwongen uitlog (verlopen sessie, gedeactiveerd
  // account) legde dat uit in een toast — maar LoginView vervangt de hele app,
  // dus die melding was meteen weg en je stond zonder uitleg voor een leeg
  // formulier. De reden komt nu via sessionStorage mee en blijft staan.
  const [opgeslagenReden, setOpgeslagenReden] = useState<string>('');
  useEffect(() => {
    try {
      const reden = sessionStorage.getItem(LOGIN_MELDING_KEY);
      if (!reden) return;
      sessionStorage.removeItem(LOGIN_MELDING_KEY);
      setOpgeslagenReden(reden);
    } catch {
      // Privémodus of geblokkeerde storage: dan simpelweg geen melding.
    }
  }, []);
  const reden = melding || opgeslagenReden;
  const uitlogReden = reden === 'account'
    ? 'Je account is gedeactiveerd. Neem contact op met de planning.'
    : reden === 'sessie'
      ? 'Je sessie is verlopen omdat je een tijdje weg was. Log opnieuw in — er is niets van je werk verloren.'
      : '';

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

  const headerCopy = recoveryMode
    ? { title: 'Nieuw wachtwoord', description: 'Kies een nieuw wachtwoord voor je account.' }
    : mode === 'forgot'
      ? { title: 'Wachtwoord vergeten', description: 'Vul je e-mail in — we sturen een reset-link.' }
      : { title: 'Inloggen', description: 'Meld je aan om verder te gaan.' };

  // === Tilt-parallax voor het form-card ===
  // Alleen op muis. Op touch zou de kaart rondtollen tijdens scroll.
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
    if (e.pointerType !== 'mouse') return;
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
    <div className="min-h-screen relative overflow-hidden login-bg-dark">
      {/* Centrale wordmark + form-card, vertikaal gecentreerd. */}
      <main
        className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
        style={{ perspective: '1200px' }}
      >
        {/* Officieel VHB-logo boven het card. Login is donker (carbon), dus
            de reverse-variant (witte tekst + oker bus). */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center text-center mb-10"
        >
          {/* Primary-lockup mét naamregel — overal hetzelfde logo. */}
          <BrandLogo tone="donker" className="h-16 sm:h-20 w-auto select-none" />
        </motion.div>

        {/* Form-card met tilt-parallax + roterende oker-iridescent border */}
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
          className="w-full max-w-[440px] will-change-transform"
        >
          <div
            ref={cardRef}
            onPointerMove={handleCardMove}
            onPointerLeave={handleCardLeave}
            className="panel-login-dark relative w-full rounded-3xl p-7 sm:p-9"
          >
            <AnimatePresence mode="wait">
                <motion.div
                  key={`${mode}-${recoveryMode}`}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.22 }}
                  className="mb-7 text-center"
                >
                  <h2 className="text-2xl font-bold text-white tracking-[-0.02em] leading-tight">
                    {headerCopy.title}
                  </h2>
                  <p className="mt-2 text-sm text-slate-300 font-normal">{headerCopy.description}</p>
                </motion.div>
              </AnimatePresence>

              {/* Reden van een gedwongen uitlog — blijft staan tot je opnieuw
                  inlogt, in tegenstelling tot de toast die hier voorheen
                  achter dit scherm verdween. Oker (info), niet rood: er is
                  niets stuk, je moet alleen opnieuw inloggen. */}
              {uitlogReden && !recoveryMode && (
                <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-oker-500/25 bg-oker-500/12 px-4 py-3">
                  <ShieldCheck size={15} className="mt-px shrink-0 text-oker-400" />
                  <p className="text-[13px] font-medium leading-relaxed text-oker-100">{uitlogReden}</p>
                </div>
              )}

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
                    autoFocus
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
                    autoFocus
                  />
                  <FeedbackBlock error={error} info={info} />
                  <SubmitButton loading={isSubmitting}>Verstuur reset-link</SubmitButton>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      resetFeedback();
                    }}
                    className="w-full text-center text-xs font-bold uppercase tracking-[0.08em] text-slate-400 hover:text-white transition-colors pt-2"
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
                    autoFocus
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
                        className="-my-2 inline-flex min-h-11 items-center text-[11px] font-bold uppercase tracking-[0.08em] text-oker-600 hover:text-oker-700 transition-colors"
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
            <div className="mt-7 pt-5 border-t border-white/10 flex items-center justify-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">
              <ShieldCheck size={11} className="text-emerald-500" />
              Beveiligd via Supabase Auth
            </div>
          </div>{/* /panel */}
        </motion.div>
      </main>

      {/* Footer — gepind aan de onderkant van de viewport.
          Twee regels: "Intern gebruik" boven, copyright onder.
          Respecteert env(safe-area-inset-bottom) op iPhones. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="absolute inset-x-0 bottom-0 text-[11px] font-medium text-slate-400 uppercase tracking-[0.08em] text-center px-6 space-y-1"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <div>Intern gebruik</div>
        <div>© {new Date().getFullYear()} Van Hoorebeke en Zoon</div>
      </motion.div>
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
  autoFocus,
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
  autoFocus?: boolean;
  rightSlot?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const isPassword = type === 'password';
  const [revealed, setRevealed] = useState(false);
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
        <label className="block text-[11px] font-semibold text-slate-300 uppercase tracking-[0.08em]">{label}</label>
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {showCapsWarning && (
              <motion.span
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: 0.18 }}
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-600"
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
          autoFocus={autoFocus}
          className={`control-input-dark w-full pl-11 py-3.5 rounded-2xl font-medium text-white outline-none transition-all no-focus-ring ${
            isPassword ? 'pr-12' : 'pr-4'
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            aria-label={revealed ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
            tabIndex={-1}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-11 w-11 items-center justify-center text-slate-400 hover:text-white rounded-lg transition-colors z-10"
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
          className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-500/25"
        >
          <AlertTriangle size={14} className="text-red-300 shrink-0" />
          <p className="text-red-200 text-sm font-semibold">{error}</p>
        </motion.div>
      )}
      {info && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/25"
        >
          <CheckCircle size={14} className="text-emerald-300 shrink-0" />
          <p className="text-emerald-200 text-sm font-semibold">{info}</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    // btn-primary (via Button) = VHB Amber met VHB Black-tekst (huisstijl:
    // nooit wit op amber — contrast 2,2:1). De login-CTA blijft bewust een
    // maat groter (15px bold) dan de standaard lg-knop: hero-knop op het
    // meest bekeken scherm.
    <Button type="submit" variant="primary" size="lg" full disabled={loading} className="group mt-2 py-3.5 text-[15px] font-bold">
      <span>{loading ? 'Even geduld…' : children}</span>
      {!loading && (
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
      )}
    </Button>
  );
}
