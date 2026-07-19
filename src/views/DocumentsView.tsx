import { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import type { User } from '../types';
import { getSupabaseAuthHeaders, notify, openPdfInNewTab } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, MicroLabel } from '../components/primitives';
import { SkeletonRow } from '../components/Skeleton';
import { formatDateHuman } from '../lib/format';

export type UserDocument = {
  id: string;
  userId: string;
  filename: string;
  category: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
  uploadedBy: string | null;
  url: string | null;
};

const prettySize = (bytes: number | null) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Eigen documenten voor de chauffeur (attesten, reglement, loonbrieven). */
export function DocumentsView({ currentUser, onSeen }: { currentUser: User; onSeen?: () => void }) {
  const [docs, setDocs] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);

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
      <PageHeader title="Mijn documenten" description="Attesten, reglement en andere documenten die de planning voor jou klaarzet." />

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
                onClick={() => (doc.url ? openPdfInNewTab(doc.url) : notify('Bestand is niet beschikbaar.', 'error'))}
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
