import { useEffect, useState } from 'react';
import { CalendarPlus, Copy, Check, Download, ExternalLink, X, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';
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
    <Modal open={open} onClose={onClose} maxWidth="md">
      <div className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-oker-500 text-slate-950 shadow-md shadow-black/10 shrink-0">
              <CalendarPlus size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold tracking-tight text-slate-900">Aan agenda toevoegen</h3>
              <p className="text-xs font-medium text-slate-500">Je diensten in je eigen agenda — automatisch bijgewerkt.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Sluiten" className="ios-pressable shrink-0 w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 rounded-full border border-slate-200 bg-surface-white text-slate-400 hover:text-slate-700 hover:bg-surface-soft-hover flex items-center justify-center transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Abonneren */}
        <div className="mt-5">
          <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-slate-400">Abonneren (blijft up-to-date)</div>

          {loading ? (
            <div className="mt-3 flex items-center gap-3 text-slate-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
              <span className="text-sm font-bold">Link laden…</span>
            </div>
          ) : error ? (
            <p className="mt-3 text-sm font-bold text-red-500">{error}</p>
          ) : links ? (
            <>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <a
                  href={links.webcal}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 text-white px-4 py-3 text-sm font-semibold hover:bg-slate-800 transition-colors"
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
                <input
                  readOnly
                  value={links.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-surface-soft px-3 py-2 text-base sm:text-xs font-medium text-slate-600 select-all"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="ios-pressable shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-surface-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-surface-soft-hover transition-colors"
                >
                  {copied ? <><Check size={14} className="text-emerald-500" /> Gekopieerd</> : <><Copy size={14} /> Kopieer</>}
                </button>
              </div>

              <p className="mt-2 text-xs font-medium text-slate-400 leading-relaxed">
                Plak deze link in je agenda-app als <span className="font-bold text-slate-500">abonnement</span> (niet als import).
                Wijzigingen in je rooster verschijnen daarna vanzelf, meestal binnen een uur.
              </p>
              <div className="mt-2 flex items-start gap-1.5 text-2xs font-medium text-slate-400">
                <ShieldCheck size={13} className="text-slate-400 mt-0.5 shrink-0" />
                <span>Deze link is persoonlijk — deel 'm niet, hij toont jouw diensten.</span>
              </div>
            </>
          ) : null}
        </div>

        {/* Eenmalig downloaden */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-slate-400">Of eenmalig</div>
          <button
            type="button"
            onClick={() => { onDownload(); onClose(); }}
            className="mt-2 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-surface-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-surface-soft-hover transition-colors"
          >
            <Download size={16} className="text-oker-500" /> Download .ics-bestand
          </button>
          <p className="mt-1.5 text-xs font-medium text-slate-400">Een momentopname — updatet niet automatisch.</p>
        </div>
      </div>
    </Modal>
  );
}
