import { useEffect, useState } from 'react';
import { CalendarPlus, Copy, Check, Download, ExternalLink, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';
import { ModalHeader } from './ui';
import { BrandSpinner } from './BrandSpinner';
import { Button, MicroLabel } from './primitives';
import { Input } from './Field';
import { fetchCalendarLinks, type CalendarLinks } from '../lib/calendar';

/**
 * "Aan agenda toevoegen"-modal. Twee opties:
 *  1. Abonneren via een persoonlijke feed-URL → blijft automatisch up-to-date
 *     in Google/Apple Agenda (webcal + Google-link + kopieerbare URL).
 *  2. Eenmalig een .ics-bestand downloaden (bestaande export).
 */
export function CalendarSubscribeModal({
  open,
  onClose,
  onDownload,
}: {
  open: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [links, setLinks] = useState<CalendarLinks | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setCopied(false);
    fetchCalendarLinks()
      .then((res) => { if (!cancelled) setLinks(res); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon de agenda-link niet laden.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const copy = async () => {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Kopiëren lukte niet — selecteer en kopieer de link handmatig.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="md" ariaLabel="Aan agenda toevoegen">
      <div className="flex max-h-[88dvh] flex-col overflow-hidden">
        {/* Zelfde kop-dialect als de andere modals (ModalHeader met icoontegel
            als `leading`), i.p.v. een eigen h3 + losse sluitknop. */}
        <ModalHeader
          leading={
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-oker-500 text-slate-950 shadow-md shadow-black/10">
              <CalendarPlus size={20} />
            </div>
          }
          title="Aan agenda toevoegen"
          description="Je diensten in je eigen agenda — automatisch bijgewerkt."
          onClose={onClose}
        />

        <div className="p-6 md:p-7 overflow-y-auto flex-1">
          {/* Abonneren */}
          <div>
            <MicroLabel>Abonneren (blijft up-to-date)</MicroLabel>

            {loading ? (
              <div className="mt-3 flex items-center gap-3 text-slate-500">
                <BrandSpinner size={16} />
                <span className="text-sm font-bold">Link laden…</span>
              </div>
            ) : error ? (
              <p className="mt-3 text-sm font-bold text-red-700">{error}</p>
            ) : links ? (
              <>
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <a
                    href={links.webcal}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-ink text-white px-4 py-3 text-sm font-semibold hover:bg-ink-soft transition-colors"
                  >
                    <CalendarPlus size={16} /> Apple / iPhone
                  </a>
                  <a
                    href={links.googleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-surface-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-surface-soft-hover transition-colors"
                  >
                    <ExternalLink size={16} className="text-oker-500" /> Google Agenda
                  </a>
                </div>

                <div className="mt-2 flex items-stretch gap-2">
                  <Input
                    readOnly
                    aria-label="Persoonlijke agenda-link"
                    value={links.url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 select-all text-slate-600"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    icon={copied ? <Check size={14} className="text-emerald-700" /> : <Copy size={14} />}
                    onClick={copy}
                  >
                    {copied ? 'Gekopieerd' : 'Kopieer'}
                  </Button>
                </div>

                <p className="mt-2 text-xs font-medium text-slate-500 leading-relaxed">
                  Plak deze link in je agenda-app als <span className="font-bold text-slate-500">abonnement</span> (niet als import).
                  Wijzigingen in je rooster verschijnen daarna vanzelf, meestal binnen een uur.
                </p>
                <div className="mt-2 flex items-start gap-1.5 text-2xs font-medium text-slate-500">
                  <ShieldCheck size={14} className="text-slate-400 mt-0.5 shrink-0" />
                  <span>Deze link is persoonlijk — deel 'm niet, hij toont jouw diensten.</span>
                </div>
              </>
            ) : null}
          </div>

          {/* Eenmalig downloaden */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <MicroLabel>Of eenmalig</MicroLabel>
            <Button variant="secondary" className="mt-2" icon={<Download size={16} className="text-oker-500" />} onClick={() => { onDownload(); onClose(); }}>
              Download .ics-bestand
            </Button>
            <p className="mt-1.5 text-xs font-medium text-slate-500">Een momentopname — updatet niet automatisch.</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
