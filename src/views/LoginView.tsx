import React, { useEffect, useId, useState } from 'react';
import { WACHTWOORD_HINT, WACHTWOORD_MIN, wachtwoordVoortgang } from '../lib/wachtwoord';
import { AlertTriangle, ArrowUp, CheckCircle, ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import { Button, IconButton, microLabelClass } from '../components/primitives';
import { cn } from '../lib/ui';
import { supabase } from '../lib/supabase';
import { applyThemeColorMeta, LOGIN_MELDING_KEY } from '../lib/ui';
import { BrandLogo } from '../components/BrandLogo';
import { OmgevingLabel } from '../components/OmgevingLabel';
import { OnderhoudBanner } from '../components/OnderhoudBanner';
import { useOnderhoudPubliek } from '../app/useOnderhoud';


type Mode = 'login' | 'forgot';

/**
 * Login-scherm — bewust doodstil: carbon-achtergrond, logo, twee velden,
 * één amber knop. Tilt-parallax, ademende focus-glow en de auth-leverancier-
 * badge zijn er in de verfijningsronde van 08-08 uit — het visitekaartje
 * zegt "wij twijfelen niet", stilte is hier de luxe.
 *
 * Login is altijd carbon-donker, los van de globale theme-toggle.
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
  melding?: 'sessie' | 'account' | 'inactief' | '';
}) {
  const [mode, setMode] = useState<Mode>('login');

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
  // Onderhoudsmodus: de publieke variant (alleen actief + tekst), zodat wie
  // wil inloggen al weet dat het portaal even in onderhoud is.
  const onderhoud = useOnderhoudPubliek();
  const uitlogReden = reden === 'account'
    ? 'Je account is gedeactiveerd. Neem contact op met de planning.'
    : reden === 'sessie'
      ? 'Je sessie is verlopen omdat je een tijdje weg was. Log opnieuw in, er is niets van je werk verloren.'
      : reden === 'inactief'
        ? 'Automatisch afgemeld: dit is een gedeeld toestel en er was een half uur geen activiteit.'
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
    // Zelfde minimum als overal (WACHTWOORD_MIN), ook als de browser het
    // native minLength niet afdwingt.
    if (newPassword.length < WACHTWOORD_MIN) {
      setError(`Nieuw wachtwoord moet minstens ${WACHTWOORD_MIN} tekens zijn.`);
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

  const voortgang = wachtwoordVoortgang(newPassword);
  const headerCopy = recoveryMode
    ? { title: 'Nieuw wachtwoord', description: 'Kies een nieuw wachtwoord voor je account.' }
    : mode === 'forgot'
      ? { title: 'Wachtwoord vergeten', description: 'Vul je e-mail in, we sturen een reset-link.' }
      : { title: 'Inloggen', description: 'Meld je aan om verder te gaan.' };

  return (
    <LoginSchil>
      <LoginKop sleutel={`${mode}-${recoveryMode}`} title={headerCopy.title} description={headerCopy.description} />

      {/* Reden van een gedwongen uitlog — blijft staan tot je opnieuw
          inlogt, in tegenstelling tot de toast die hier voorheen
          achter dit scherm verdween. Oker (info), niet rood: er is
          niets stuk, je moet alleen opnieuw inloggen. */}
      {!recoveryMode && <OnderhoudBanner onderhoud={onderhoud} tone="donker" className="mb-6" />}
      {uitlogReden && !recoveryMode && (
        <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-oker-500/25 bg-oker-500/12 px-4 py-3">
          <ShieldCheck size={16} className="mt-px shrink-0 text-oker-400" />
          <p className="text-body-sm font-medium text-oker-100">{uitlogReden}</p>
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
            placeholder={WACHTWOORD_HINT}
            required
            minLength={WACHTWOORD_MIN}
            autoComplete="new-password"
            autoFocus
            hint={voortgang.tekst}
            hintKlaar={voortgang.klaar}
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
          <LoginTekstKnop
            onClick={() => {
              setMode('login');
              resetFeedback();
            }}
          >
            ← Terug naar inloggen
          </LoginTekstKnop>
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
              // rauw: tekstlink naast het veldlabel op de carbon-login (zie
              // LoginTekstKnop hieronder voor de motivatie).
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  resetFeedback();
                }}
                className="-my-2 inline-flex min-h-11 items-center text-xs font-medium text-ink-tekst-gedempt transition-colors hover:text-oker-400"
              >
                Wachtwoord vergeten?
              </button>
            }
          />
          <FeedbackBlock error={error} info={info} />
          <SubmitButton loading={isSubmitting}>Inloggen</SubmitButton>
        </form>
      )}
    </LoginSchil>
  );
}

/**
 * Het carbon kader van het loginscherm: achtergrond, logo, paneel, hulpregel
 * en voet. Ook de landing van een uitnodiging (UitnodigingScherm) staat erin,
 * zodat beide schermen er hetzelfde uitzien.
 *
 * De login stuurt zijn eigen carbon-donkere styling (login-bg-dark e.d.),
 * los van de globale theme-toggle. We halen html.dark tijdelijk weg zodat de
 * .dark-overrides van de app hier niet doorheen lekken; op unmount (na
 * succesvol inloggen) wordt de klasse hersteld.
 */
export function LoginSchil({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const wasDark = html.classList.contains('dark');
    html.classList.remove('dark');
    // Statusbalk mee in carbon zolang de login in beeld is. login-donker
    // kleurt óók de <html>-achtergrond carbon: Safari tekent zijn status- en
    // werkbalkzone in de paginakleur, en die was anders wit (01-09).
    html.classList.add('login-donker');
    applyThemeColorMeta(true);
    return () => {
      if (wasDark) html.classList.add('dark');
      html.classList.remove('login-donker');
      applyThemeColorMeta(wasDark);
    };
  }, []);

  // min-h-dvh i.p.v. 100vh: in Safari (vóór "Zet op beginscherm") stond de
  // absolute footer anders achter de Safari-balk (controle-ronde 27-08, nr. 35).
  return (
    <div className="min-h-dvh relative overflow-hidden login-bg-dark">
      {/* Centrale wordmark + form-card, vertikaal gecentreerd. */}
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12">
        {/* Officieel VHB-logo boven het card. Login is donker (carbon), dus
            de negatief-variant (wit + goud). De inloop is CSS (`inloop`,
            index.css; sinds 14-10): het logo en de kop zijn het eerste beeld
            van de login en mogen niet op de animatiebundel van motion wachten. */}
        <div className="inloop flex flex-col items-center text-center mb-10">
          {/* Volledig logo (VHB primary: merk boven naamregel), 1-op-1 het
              master. 176 px mobiel / 224 px desktop: het nieuwe logo is laag
              en breed, dus iets breder dan de oude 144/176 voor dezelfde
              aanwezigheid (naamregel ±7–9 px). */}
          <BrandLogo tone="donker" className="w-44 sm:w-56 h-auto select-none" />
          {/* Staging-label (alleen met VITE_OMGEVING=staging): testers zien meteen dat dit productie niet is. */}
          <OmgevingLabel className="mt-4" />
        </div>

        {/* Stille form-card: één zachte entrance-fade, verder niets. */}
        <div className="inloop w-full max-w-[440px]" style={{ animationDelay: '150ms' }}>
          <div className="panel-login-dark relative w-full rounded-3xl p-7 sm:p-9">
            {children}
          </div>{/* /panel */}

          {/* Wie te bellen als het niet lukt — chauffeurs zijn geen
              IT-publiek, dus dit staat er gewoon bij. */}
          <p className="fade-in-traag mt-6 text-center text-xs text-ink-tekst-gedempt" style={{ animationDelay: '350ms' }}>
            Problemen met inloggen? Contacteer de planning.
          </p>
        </div>
      </main>

      {/* Footer — gepind aan de onderkant van de viewport, één regel
          ("& Zoon" conform de naamregel in het logo).
          Respecteert env(safe-area-inset-bottom) op iPhones. */}
      <div
        className="fade-in-traag absolute inset-x-0 bottom-0 text-micro text-ink-tekst-gedempt text-center px-6"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))', animationDelay: '500ms' }}
      >
        <div>Intern gebruik · © {new Date().getFullYear()} Van Hoorebeke & Zoon</div>
      </div>
    </div>
  );
}

// === Subcomponents ===

/** Kop van het paneel; schuift kort in als `sleutel` verandert (de key
 *  mount de kop opnieuw, de CSS-animatie loopt bij het invoegen). */
export function LoginKop({ sleutel, title, description }: { sleutel: string; title: string; description: React.ReactNode }) {
  return (
    <div key={sleutel} className="schuif-in mb-7 text-center">
      <h1 className="text-2xl font-bold text-white tracking-[-0.02em] leading-tight">
        {title}
      </h1>
      <p className="mt-2 text-body text-slate-300 font-normal">{description}</p>
    </div>
  );
}

/** Stille tekstlink onder een formulier ("Terug naar inloggen"). */
export function LoginTekstKnop({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    // rauw: tekstlink op de carbon-login — Button ghost hovert met een
    // licht slate-vlak dat hier als vlek zou opvallen. `!`-kleur: .text-micro
    // staat ná de utilities in de cascade en wint anders van text-slate-400.
    <button
      type="button"
      onClick={onClick}
      className={cn(microLabelClass, 'w-full text-center !text-slate-400 hover:!text-white transition-colors pt-2')}
    >
      {children}
    </button>
  );
}

export function FieldInput({
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
  hint,
  hintKlaar,
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
  /** Regel onder het veld die blijft staan terwijl je typt (de placeholder
   *  verdwijnt dan): de wachtwoordregel. `hintKlaar` kleurt ze groen met een
   *  vinkje zodra aan de regel voldaan is. */
  hint?: React.ReactNode;
  hintKlaar?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  // Label en veld gekoppeld (tranche 3A): het label noemde het veld niet.
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
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
        <label htmlFor={id} className="block text-xs font-medium text-slate-300">{label}</label>
        <div className="flex items-center gap-3">
          {showCapsWarning && (
            <span
              className={cn(microLabelClass, 'schuif-in inline-flex items-center gap-1 !text-amber-700')}
              title="Caps Lock staat aan"
            >
              <ArrowUp size={12} strokeWidth={3} />
              Caps Lock
            </span>
          )}
          {rightSlot}
        </div>
      </div>
      {/* Geen field-glow meer: de focus-rand van control-input-dark volstaat —
          een ademende gloed op een pro-tool-login was juist het soort truc
          dat we kwijt wilden. */}
      <div className="relative rounded-2xl">
        <div
          className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors pointer-events-none ${
            focused ? 'text-oker-500' : 'text-slate-400'
          }`}
        >
          {icon}
        </div>
        <input
          id={id}
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
          aria-describedby={hintId}
          className={`control-input-dark w-full pl-11 py-3.5 rounded-2xl font-medium text-white transition-colors ${
            isPassword ? 'pr-12' : 'pr-4'
          }`}
        />
        {isPassword && (
          <IconButton
            label={revealed ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
            variant="ghost"
            size="sm"
            tabIndex={-1}
            onClick={() => setRevealed((r) => !r)}
            // Carbon-veld: geen licht hover-vlak, alleen de icoonkleur wisselt.
            className="absolute right-1.5 top-1/2 z-10 -translate-y-1/2 text-slate-400 hover:bg-transparent hover:text-white"
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
        )}
      </div>
      {hint && (
        <p
          id={hintId}
          className={cn('flex items-center gap-1.5 px-1 text-xs', hintKlaar ? 'text-emerald-300' : 'text-slate-300')}
        >
          {hintKlaar && <CheckCircle size={12} className="shrink-0" aria-hidden="true" />}
          {hint}
        </p>
      )}
    </div>
  );
}

export function FeedbackBlock({ error, info }: { error: string; info: string }) {
  return (
    <>
      {error && (
        <div
          role="alert"
          className="zak-in flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-500/15 border border-red-500/25"
        >
          <AlertTriangle size={14} className="text-red-300 shrink-0" />
          <p className="text-red-200 text-sm font-semibold">{error}</p>
        </div>
      )}
      {info && (
        <div className="zak-in flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/25">
          <CheckCircle size={14} className="text-emerald-300 shrink-0" />
          <p className="text-emerald-200 text-sm font-semibold">{info}</p>
        </div>
      )}
    </>
  );
}

export function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    // btn-primary (via Button) = VHB Amber met VHB Black-tekst (huisstijl:
    // nooit wit op amber — contrast 2,2:1). Standaard md-maat, op inhouds-
    // breedte gecentreerd: de vol-brede hero-variant vond Jarno te groot
    // (31-08); px-8 houdt hem als CTA nog net iets royaler dan een gewone knop.
    // `bezig`: label en breedte blijven staan en de pijl cross-fadet naar de
    // spinner (vroeger versprong de knop op "Even geduld…" zonder pijl); de
    // tekst blijft voor schermlezers als aria-label bestaan.
    <div className="flex justify-center">
      <Button
        type="submit"
        variant="primary"
        size="md"
        bezig={loading}
        aria-label={loading ? 'Even geduld…' : undefined}
        iconRechts={<ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />}
        className="group mt-2 px-8 font-semibold"
      >
        <span>{children}</span>
      </Button>
    </div>
  );
}
