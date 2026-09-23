import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, X } from 'lucide-react';
import { Button, IconButton } from './primitives';
import { DUR, EASE } from '../lib/motion';

/**
 * PWA-randzaken: de install-prompt.
 *
 * - <InstallPrompt/>: vangt het beforeinstallprompt-event (Android/Chrome)
 *   en biedt een nette knop "Toevoegen aan beginscherm" aan. Onthoudt een
 *   weigering in localStorage zodat 't niet blijft zeuren.
 *
 * De offline-pil (`OfflineBanner`) die hier stond is op 15-09 (punt 19)
 * verwijderd: hij las alleen `navigator.onLine` (op bus-wifi zonder internet
 * blijft dat true) en stond naast de offline-kaart in de schil en het stille
 * label op Mijn dag, drie signalen voor één oorzaak. De schil toont nu één
 * kaart op de online-store (src/lib/useOnline.ts); Mijn dag houdt zijn
 * stille Badge, geen banner.
 */

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
          transition={{ duration: DUR.slow, ease: EASE }}
          // Zelfde reden als de offline-pil hierboven: op 1rem overlapte deze
          // kaart de tab-knoppen bijna volledig.
          className="fixed inset-x-0 z-toast flex justify-center px-4 pointer-events-none bottom-boven-dock md:bottom-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-rim bg-overlay px-4 py-3 elev-3 max-w-sm">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-oker-500 text-slate-950">
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
            <Button variant="primary" size="sm" className="shrink-0" onClick={install}>
              Toevoegen
            </Button>
            <IconButton label="Niet nu" variant="ghost" size="sm" onClick={() => dismiss(true)}>
              <X size={16} />
            </IconButton>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
