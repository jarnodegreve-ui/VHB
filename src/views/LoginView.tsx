import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, MapPin, Bell, AlertTriangle, CheckCircle, ArrowRight, Lock, Mail, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useCursorGlow, getDaypartGreeting } from '../lib/interactive';

type Mode = 'login' | 'forgot';

const FEATURES: Array<{
  icon: React.ReactNode;
  label: string;
  desc: string;
  color: 'oker' | 'blue' | 'emerald';
  delay: number;
}> = [
  {
    icon: <Calendar size={16} />,
    label: 'Roosters & Planning',
    desc: 'Bekijk je diensten en planning per dag.',
    color: 'oker',
    delay: 0.1,
  },
  {
    icon: <MapPin size={16} />,
    label: 'Omleidingen',
    desc: 'Realtime routewijzigingen voor chauffeurs.',
    color: 'blue',
    delay: 0.2,
  },
  {
    icon: <Bell size={16} />,
    label: 'Updates & Meldingen',
    desc: 'Nieuws, veiligheid en technische info.',
    color: 'emerald',
    delay: 0.3,
  },
];

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

  // Login is altijd licht — dark mode oogt vreemd op de cream/oker
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

  const cardRef = useCursorGlow<HTMLDivElement>();

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      {/* Achtergrond: rustige cream + gekleurde blobs (parallax-stijl, hier statisch) */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: 'linear-gradient(180deg, #f9f7f2 0%, #f3efe6 50%, #efeadf 100%)',
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 800px 600px at 12% 12%, rgba(245, 158, 11, 0.18) 0%, transparent 55%),' +
            'radial-gradient(ellipse 700px 500px at 88% 78%, rgba(99, 102, 241, 0.10) 0%, transparent 55%),' +
            'radial-gradient(ellipse 600px 400px at 50% 50%, rgba(244, 114, 182, 0.06) 0%, transparent 60%)',
          filter: 'blur(2px) saturate(125%)',
        }}
      />

      {/* === Linker brand-paneel — alleen desktop === */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative flex-col justify-between p-14 overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10"
        >
          <h1 className="brand-wordmark brand-wordmark-anim text-4xl text-slate-900 leading-none">
            VHB <span className="brand-accent text-oker-500">PORTAAL</span>
          </h1>
          <p className="mt-3 text-[11px] font-bold text-slate-400 uppercase tracking-[0.22em]">
            Van Hoorebeke en Zoon
          </p>
        </motion.div>

        {/* Bento mini-tegels voor features */}
        <div className="relative z-10 space-y-3">
          {FEATURES.map((f) => (
            <div key={f.label}>
              <FeatureTile {...f} />
            </div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="relative z-10 text-xs text-slate-400 font-medium"
        >
          © {new Date().getFullYear()} Van Hoorebeke en Zoon · Intern gebruik
        </motion.p>
      </div>

      {/* === Rechter form-paneel === */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <motion.div
          ref={cardRef}
          initial={{ opacity: 0, y: 16, scale: 0.985, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="cursor-glow glow-top glass-stack w-full max-w-md relative overflow-hidden rounded-[32px] p-8 md:p-10"
          style={{
            background:
              'linear-gradient(180deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0.5) 100%)',
            backdropFilter: 'blur(32px) saturate(160%)',
            WebkitBackdropFilter: 'blur(32px) saturate(160%)',
            border: '1px solid rgba(255, 255, 255, 0.85)',
            boxShadow:
              'inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 0 rgba(255, 255, 255, 0.42), 0 24px 64px rgba(15, 23, 42, 0.08), 0 4px 12px rgba(15, 23, 42, 0.04)',
          }}
        >
          <span className="cursor-glow-layer" />

          <div className="relative z-10">
            {/* Mobile brand-mark */}
            <div className="lg:hidden text-center mb-8">
              <h1 className="brand-wordmark brand-wordmark-anim text-3xl text-slate-900 leading-none">
                VHB <span className="brand-accent text-oker-500">PORTAAL</span>
              </h1>
              <p className="mt-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.22em]">
                Van Hoorebeke en Zoon
              </p>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={`${mode}-${recoveryMode}`}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.25 }}
                className="mb-7"
              >
                <h2 className="text-3xl font-black text-slate-900 tracking-[-0.03em] leading-tight">
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
                  className="w-full text-center text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-oker-600 transition-colors pt-2"
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
            <div className="mt-7 pt-5 border-t border-slate-200/60 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <ShieldCheck size={11} className="text-emerald-500" />
              Beveiligd via Supabase Auth
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// === Subcomponents ===

const FEATURE_COLORS = {
  oker: {
    bg: 'linear-gradient(135deg, rgba(255, 255, 255, 0.65) 0%, rgba(255, 251, 235, 0.5) 100%)',
    iconBg: 'bg-oker-500',
    border: 'rgba(255, 255, 255, 0.8)',
  },
  blue: {
    bg: 'linear-gradient(135deg, rgba(255, 255, 255, 0.65) 0%, rgba(239, 246, 255, 0.5) 100%)',
    iconBg: 'bg-blue-500',
    border: 'rgba(255, 255, 255, 0.8)',
  },
  emerald: {
    bg: 'linear-gradient(135deg, rgba(255, 255, 255, 0.65) 0%, rgba(240, 253, 244, 0.5) 100%)',
    iconBg: 'bg-emerald-500',
    border: 'rgba(255, 255, 255, 0.8)',
  },
} as const;

function FeatureTile({
  icon,
  label,
  desc,
  color,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  color: keyof typeof FEATURE_COLORS;
  delay: number;
}) {
  const c = FEATURE_COLORS[color];
  const ref = useCursorGlow<HTMLDivElement>();
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className="cursor-glow glow-top relative overflow-hidden rounded-2xl p-4 flex items-start gap-4"
      style={{
        background: c.bg,
        backdropFilter: 'blur(24px) saturate(150%)',
        WebkitBackdropFilter: 'blur(24px) saturate(150%)',
        border: `1px solid ${c.border}`,
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.92), 0 6px 18px rgba(15, 23, 42, 0.04)',
      }}
    >
      <span className="cursor-glow-layer" />
      <div className={`relative z-10 w-9 h-9 rounded-xl ${c.iconBg} text-white flex items-center justify-center shadow-md shadow-black/10 shrink-0`}>
        {icon}
      </div>
      <div className="relative z-10 min-w-0">
        <p className="text-sm font-black text-slate-900 tracking-tight">{label}</p>
        <p className="text-xs font-medium text-slate-500 mt-0.5">{desc}</p>
      </div>
    </motion.div>
  );
}

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
          className="flex items-center gap-2 px-4 py-3 rounded-2xl"
          style={{
            background: 'rgba(254, 226, 226, 0.6)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(254, 178, 178, 0.5)',
          }}
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
          className="flex items-center gap-2 px-4 py-3 rounded-2xl"
          style={{
            background: 'rgba(209, 250, 229, 0.55)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(167, 243, 208, 0.5)',
          }}
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
      className="halo-on-hover group w-full inline-flex items-center justify-center gap-2 py-4 mt-2 rounded-2xl text-sm font-black uppercase tracking-widest text-white transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 8px 24px rgba(245, 158, 11, 0.28), 0 2px 6px rgba(245, 158, 11, 0.15)',
      }}
    >
      <span>{loading ? 'Even geduld…' : children}</span>
      {!loading && (
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  );
}
