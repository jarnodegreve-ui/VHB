import { useEffect, useState } from 'react';
import { Download, FileText, IdCard } from 'lucide-react';
import type { User } from '../types';
import { getSupabaseAuthHeaders, notify, openPdfInNewTab } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, MicroLabel } from '../components/primitives';
import { SkeletonRow } from '../components/Skeleton';
import { EXPIRY_SOORT_LABELS, formatDateHuman } from '../lib/format';

export type UserDocument = {
  id: string;
  userId: string;
  filename: string;
  category: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
  uploadedBy: string | null;
  url: string | null;
  openedAt?: string | null;
};

const prettySize = (bytes: number | null) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Eigen documenten voor de chauffeur (attesten, reglement, loonbrieven). */
export function DocumentsView({ currentUser, onSeen }: { currentUser: User; onSeen?: () => void }) {
  const [docs, setDocs] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  // Eigen vervaldata (rijbewijs/Code 95/medische schifting): zo ziet de
  // chauffeur zelf wanneer er iets vernieuwd moet worden — de pushmeldingen
  // op 90/30/7 dagen verwijzen hierheen. Best-effort: zonder data geen blok.
  const [verval, setVerval] = useState<Array<{ soort: string; validUntil: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/user-expiries', { headers: await getSupabaseAuthHeaders() });
        if (!res.ok) return;
        const rows = await res.json();
        if (!cancelled && Array.isArray(rows)) setVerval(rows);
      } catch { /* stil */ }
    })();
    return () => { cancelled = true; };
  }, [currentUser.id]);
  const vandaag = new Date();
  const dagenTot = (d: string) => Math.round((Date.parse(d) - Date.parse(`${vandaag.getFullYear()}-${String(vandaag.getMonth() + 1).padStart(2, '0')}-${String(vandaag.getDate()).padStart(2, '0')}`)) / 86400000);

  useEffect(() => {
    // De view openen = documenten gezien: badge/lastseen bijwerken.
    onSeen?.();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/documents', { headers: await getSupabaseAuthHeaders() });
        if (!res.ok) throw new Error('laden mislukt');
        const data = (await res.json()) as UserDocument[];
        if (!cancelled) setDocs(data);
      } catch {
        if (!cancelled) notify('Documenten laden is mislukt.', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id]);

  return (
    <PageShell>
      <PageHeader title="Mijn documenten" description="Documenten die de planning voor jou klaarzet vind je hier terug." />

      {verval.length > 0 && (
        <div className="surface-card rounded-3xl divide-y divide-slate-100 overflow-hidden">
          {verval.map((e) => {
            const dagen = dagenTot(e.validUntil);
            const urgent = Number.isFinite(dagen) && dagen <= 30;
            return (
              <div key={e.soort} className="flex items-center gap-4 px-5 py-4">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${urgent ? 'bg-red-50 text-red-600' : 'bg-oker-50 text-oker-600'}`}>
                  <IdCard size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 truncate">{EXPIRY_SOORT_LABELS[e.soort] ?? e.soort}</p>
                  <MicroLabel className="mt-0.5">Geldig tot {formatDateHuman(e.validUntil)}</MicroLabel>
                </div>
                {Number.isFinite(dagen) && (
                  <Badge tone={dagen < 0 ? 'red' : dagen <= 30 ? 'amber' : 'emerald'} dot className="shrink-0 whitespace-nowrap">
                    {dagen < 0 ? 'Verlopen' : dagen === 0 ? 'Verloopt vandaag' : dagen <= 60 ? `Nog ${dagen} ${dagen === 1 ? 'dag' : 'dagen'}` : 'In orde'}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="surface-card rounded-3xl divide-y divide-slate-100 overflow-hidden">
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
        </div>
      ) : docs.length === 0 ? (
        <EmptyState icon={<FileText size={22} />} title="Nog geen documenten" message="Zodra de planning een document voor je klaarzet, verschijnt het hier." />
      ) : (
        <div className="surface-card rounded-3xl divide-y divide-slate-100 overflow-hidden">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-4 px-5 py-4">
              <div className="w-10 h-10 rounded-2xl bg-oker-50 text-oker-600 flex items-center justify-center shrink-0">
                <FileText size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-slate-900 truncate">{doc.filename}</p>
                  {doc.category ? <Badge tone="slate">{doc.category}</Badge> : null}
                </div>
                <MicroLabel className="mt-0.5">
                  {formatDateHuman(doc.uploadedAt)}{doc.sizeBytes != null ? ` · ${prettySize(doc.sizeBytes)}` : ''}
                </MicroLabel>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!doc.url) return notify('Bestand is niet beschikbaar.', 'error');
                  // Leesbevestiging (fire-and-forget): de planner ziet zo dat
                  // dit document geopend is. Mag het openen nooit vertragen.
                  void getSupabaseAuthHeaders()
                    .then((headers) => fetch(`/api/documents/${encodeURIComponent(doc.id)}/opened`, { method: 'POST', headers }))
                    .catch(() => {});
                  openPdfInNewTab(doc.url);
                }}
                aria-label={`Open ${doc.filename}`}
                className="ios-pressable shrink-0 inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Download size={16} className="text-oker-500" /> Openen
              </button>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
