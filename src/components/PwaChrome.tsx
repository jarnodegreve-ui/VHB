import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, WifiOff, X } from 'lucide-react';

/**
 * PWA-randzaken: offline-indicator + install-prompt.
 *
 * - <OfflineBanner/>: subtiele pil onderaan zodra het netwerk wegvalt,
 *   zodat een chauffeur weet dat 'ie (mogelijk verouderde) gecachte data
 *   ziet. Geen actie nodig — puur informatief.
 * - <InstallPrompt/>: vangt het beforeinstallprompt-event (Android/Chrome)
 *   en biedt een nette knop "Toevoegen aan beginscherm" aan. Onthoudt een
 *   weigering in localStorage zodat 't niet blijft zeuren.
 */

/** Reageert op online/offline-events. */
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnlineStatus();
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-0 z-[130] flex justify-center px-4 pointer-events-none"
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-slate-900/90 px-4 py-2.5 text-white shadow-2xl backdrop-blur-sm">
            <WifiOff size={15} className="text-amber-300 shrink-0" />
            <span className="text-xs font-bold tracking-tight">
              Offline — je ziet mogelijk verouderde gegevens
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const INSTALL_DISMISS_KEY = 'vhb-install-dismissed';

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Al geïnstalleerd? Dan niets tonen.
    if (window.matchMedia?.('(display-mode: standalone)').matches) return;
    try {
      if (localStorage.getItem(INSTALL_DISMISS_KEY) === '1') return;
    } catch {
      // localStorage geblokkeerd — prompt dan gewoon tonen
    }

    const onPrompt = (e: Event) => {
      e.preventDefault(); // voorkom de default mini-infobar
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = (remember: boolean) => {
    setVisible(false);
    if (remember) {
      try {
        localStorage.setItem(INSTALL_DISMISS_KEY, '1');
      } catch {
        // localStorage geblokkeerd — prompt komt dan volgende sessie terug
      }
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      // gebruiker sloot de dialoog — niets te doen
    }
    setDeferred(null);
    dismiss(true);
  };

  return (
    <AnimatePresence>
      {visible && deferred && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-0 z-[125] flex justify-center px-4 pointer-events-none"
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/70 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur-sm max-w-sm">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-oker-500 text-white">
              <Download size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 leading-tight">
                Voeg toe aan beginscherm
              </p>
              <p className="text-xs font-medium text-slate-500">
                Sneller openen, werkt als een app.
              </p>
            </div>
            <button
              onClick={install}
              className="btn-primary ios-pressable shrink-0 px-3.5 py-2 text-[11px] uppercase tracking-[0.08em]"
            >
              Toevoegen
            </button>
            <button
              onClick={() => dismiss(true)}
              aria-label="Niet nu"
              className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={16} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
