import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Calendar, MapPin, Bell, AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/ui';

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
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [info, setInfo] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetFeedback = () => { setError(''); setInfo(''); };

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
    } catch (loginError: any) {
      setError(loginError.message || 'Je account is aangemeld, maar het portaalprofiel kon niet geladen worden.');
    } finally {
      setIsSubmitting(false);
    }
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

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: window.location.origin },
    );

    if (resetError) {
      setError('Kon geen resetmail versturen. Controleer het e-mailadres.');
      setIsSubmitting(false);
      return;
    }

    setInfo('Als dit e-mailadres bij ons bekend is, ontvang je binnen enkele minuten een reset-link.');
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

    if (newPassword.length < 5) {
      setError('Kies een wachtwoord van minstens 5 tekens.');
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
      ? { title: 'Wachtwoord vergeten', description: 'Vul je e-mail in — we sturen een link om je wachtwoord te herstellen.' }
      : { title: 'Welkom terug', description: 'Meld je aan om verder te gaan.' };

  return (
    <div className="min-h-screen flex relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #f8f6f0 0%, #f1ede4 100%)' }}>
      {/* Left brand panel — hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative flex-col justify-between p-14 overflow-hidden rounded-r-[44px] shadow-[18px_0_50px_rgba(217,119,6,0.08)]" style={{ background: 'linear-gradient(160deg, #fff7e6 0%, #fdf1cf 52%, #f7e7be 100%)' }}>
        <div className="absolute top-0 right-0 w-[60%] h-[50%] rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.28) 0%, transparent 72%)' }} />
        <div className="absolute bottom-0 left-0 w-[50%] h-[40%] rounded-full blur-3xl opacity-25" style={{ background: 'radial-gradient(circle, rgba(217,119,6,0.18) 0%, transparent 72%)' }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(rgba(180,83,9,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(180,83,9,0.12) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

        <div className="relative z-10">
          <h1 className="brand-wordmark text-4xl text-slate-900">VHB <span className="text-oker-500">PORTAAL</span></h1>
          <p className="mt-2 text-slate-500 font-medium text-sm tracking-wide">Van Hoorebeke en Zoon</p>
        </div>

        <div className="relative z-10 space-y-5">
          {[
            { icon: <Calendar size={18} />, label: 'Roosters & Planning', desc: 'Bekijk je diensten en planning.' },
            { icon: <MapPin size={18} />, label: 'Omleidingen', desc: 'Realtime routewijzigingen voor chauffeurs.' },
            { icon: <Bell size={18} />, label: 'Updates & Meldingen', desc: 'Nieuws, veiligheid en technische info.' },
          ].map(f => (
            <div key={f.label} className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-xl bg-white/55 border border-white/75 flex items-center justify-center text-oker-500 shadow-sm shrink-0">{f.icon}</div>
              <div>
                <p className="text-sm font-bold text-slate-900">{f.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="relative z-10 text-xs text-slate-500">© {new Date().getFullYear()} Van Hoorebeke en Zoon. Intern gebruik.</p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.985, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm lg:pl-6"
        >
          <div className="lg:hidden text-center mb-10">
            <h1 className="brand-wordmark text-3xl text-slate-900">VHB <span className="text-oker-500">PORTAAL</span></h1>
            <p className="mt-1 text-slate-400 text-xs font-medium tracking-widest uppercase">Van Hoorebeke en Zoon</p>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{headerCopy.title}</h2>
            <p className="mt-1 text-sm text-slate-500 font-medium">{headerCopy.description}</p>
          </div>

          {recoveryMode ? (
            <form onSubmit={handleRecovery} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Nieuw wachtwoord</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); resetFeedback(); }}
                  className="control-input w-full px-4 py-3.5 rounded-2xl font-medium text-slate-800 placeholder:text-slate-300 outline-none transition-all"
                  required
                  minLength={5}
                  placeholder="Minstens 5 tekens"
                />
              </div>

              {error && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <p className="text-red-600 text-sm font-medium">{error}</p>
                </motion.div>
              )}

              {info && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                  <p className="text-emerald-700 text-sm font-medium">{info}</p>
                </motion.div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary ios-pressable w-full py-4 mt-2 text-sm tracking-wide"
              >
                {isSubmitting ? 'Bezig met opslaan...' : 'Wachtwoord opslaan'}
              </button>
            </form>
          ) : mode === 'forgot' ? (
            <form onSubmit={handleForgot} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">E-mailadres</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); resetFeedback(); }}
                  className="control-input w-full px-4 py-3.5 rounded-2xl font-medium text-slate-800 placeholder:text-slate-300 outline-none transition-all"
                  required
                  placeholder="naam@bedrijf.be"
                />
              </div>

              {error && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <p className="text-red-600 text-sm font-medium">{error}</p>
                </motion.div>
              )}

              {info && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                  <p className="text-emerald-700 text-sm font-medium">{info}</p>
                </motion.div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary ios-pressable w-full py-4 mt-2 text-sm tracking-wide"
              >
                {isSubmitting ? 'Bezig met versturen...' : 'Verstuur reset-link'}
              </button>

              <button
                type="button"
                onClick={() => { setMode('login'); resetFeedback(); }}
                className="w-full text-center text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-oker-600 transition-colors pt-2"
              >
                Terug naar inloggen
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">E-mailadres</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); resetFeedback(); }}
                  className="control-input w-full px-4 py-3.5 rounded-2xl font-medium text-slate-800 placeholder:text-slate-300 outline-none transition-all"
                  required
                  placeholder="naam@bedrijf.be"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Wachtwoord</label>
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); resetFeedback(); }}
                    className="text-[10px] font-bold uppercase tracking-widest text-oker-600 hover:text-oker-700 transition-colors"
                  >
                    Vergeten?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); resetFeedback(); }}
                  placeholder="••••••••"
                  className="control-input w-full px-4 py-3.5 rounded-2xl font-medium text-slate-800 placeholder:text-slate-300 outline-none transition-all"
                  required
                />
              </div>

              {error && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <p className="text-red-600 text-sm font-medium">{error}</p>
                </motion.div>
              )}

              {info && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                  <p className="text-emerald-700 text-sm font-medium">{info}</p>
                </motion.div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary ios-pressable w-full py-4 mt-2 text-sm tracking-wide"
              >
                {isSubmitting ? 'Bezig met inloggen...' : 'Inloggen'}
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
