import { X } from 'lucide-react';
import { Button } from './primitives';
import { Modal } from './Modal';

// Eigen module (polish P2a, 24-09): alleen Gebruikersbeheer gebruikt deze
// dialoog. In ui.tsx, dat in de startbundel zit, droeg elke gebruiker hem
// mee bij het eerste beeld; hier laadt hij met het beheerscherm.

export function CredentialsModal({
  open,
  onClose,
  title,
  email,
  password,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  email: string;
  password: string;
}) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`E-mail: ${email}\nTijdelijk wachtwoord: ${password}`);
    } catch (error) {
      console.error('Clipboard copy failed:', error);
    }
  };

  // Zelfde verhaal als ConfirmationModal: op de gedeelde Modal met `boven`,
  // zodat hij ook bóven een open formulier-modal (Gebruikersbeheer) rendert
  // en ESC/focus-trap meekrijgt.
  return (
    <Modal open={open} onClose={onClose} maxWidth="md" ariaLabel={title} boven>
      <div className="flex max-h-overlay flex-col overflow-hidden">
        <div className="p-6 md:p-7 border-b border-hairline flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-section-title">{title}</h2>
            <p className="mt-1.5 text-body text-slate-500 font-normal">Bewaar deze gegevens of stuur ze door naar de gebruiker.</p>
          </div>
          {/* rauw: ongewijzigd uit ui.tsx overgenomen (P2a), zelfde maat als het kruisje van ModalHeader */}
          <button aria-label="Sluiten" onClick={onClose} className="w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 inline-flex items-center justify-center shrink-0 text-slate-400 hover:bg-surface-soft-hover hover:text-slate-700 rounded-xl transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 md:p-7 space-y-3 overflow-y-auto flex-1">
          <div className="surface-muted rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">E-mailadres</p>
            <p className="mt-1.5 font-semibold text-slate-800 break-all">{email}</p>
          </div>
          <div className="surface-muted rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Tijdelijk wachtwoord</p>
            <p className="mt-1.5 font-mono font-semibold text-slate-800">{password}</p>
          </div>
          <div className="flex gap-2.5 pt-2">
            <Button variant="secondary" className="flex-1" onClick={handleCopy}>
              Kopieer gegevens
            </Button>
            <Button variant="primary" className="flex-1" onClick={onClose}>
              Sluiten
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
