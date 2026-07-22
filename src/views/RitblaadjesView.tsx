import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import type { User } from '../types';
import { getSupabaseAuthHeaders, notify, openPdfInNewTab } from '../lib/ui';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, MicroLabel } from '../components/primitives';
import { Skeleton } from '../components/Skeleton';

type RitblaadjeMeta = {
  filename: string;
  storagePath: string;
  uploadedAt: string;
  uploadedBy: string | null;
  sizeBytes: number | null;
  url: string;
};

const MAX_PDF_MB = 20;

// localStorage-keys voor offline-fallback van de ritblaadje-metadata.
// Het ritblaadje is één gedeelde resource, dus cachen is veilig.
const META_CACHE_KEY = 'vhb-ritblaadje-meta';
const SYNCED_AT_KEY = 'vhb-ritblaadje-synced';

const formatSyncedAt = (iso: string | null) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('nl-BE', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
};

const formatSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatUploadedAt = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('nl-BE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export function RitblaadjesView({ currentUser }: { currentUser: User }) {
  const [current, setCurrent] = useState<RitblaadjeMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canEdit = currentUser.role === 'admin';
  const canDelete = currentUser.role === 'admin';

  // Unmount-guard: fetchCurrent kan nog lopen terwijl de gebruiker al
  // weggenavigeerd is — geen setState/fouttoast meer op een andere pagina.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchCurrent = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/ritblaadje', { headers: await getSupabaseAuthHeaders() });
      if (!response.ok) throw new Error(`Server antwoordde ${response.status}`);
      const data = await response.json();
      if (!mountedRef.current) return;
      setCurrent(data);
      setFromCache(false);
      // Cache de metadata + sync-tijd voor offline-fallback.
      try {
        const now = new Date().toISOString();
        setSyncedAt(now);
        localStorage.setItem(SYNCED_AT_KEY, now);
        if (data) localStorage.setItem(META_CACHE_KEY, JSON.stringify(data));
        else localStorage.removeItem(META_CACHE_KEY);
      } catch {
        // localStorage geblokkeerd — geen fallback, geen ramp
      }
    } catch (error: any) {
      if (!mountedRef.current) return;
      // Offline / server onbereikbaar → val terug op de gecachte metadata.
      let recovered = false;
      try {
        const cached = localStorage.getItem(META_CACHE_KEY);
        if (cached) {
          setCurrent(JSON.parse(cached));
          setSyncedAt(localStorage.getItem(SYNCED_AT_KEY));
          setFromCache(true);
          recovered = true;
        }
      } catch {
        // ongeldige cache — negeer
      }
      if (!recovered) {
        notify('Kon ritblad niet laden: ' + error.message, 'error');
        setCurrent(null);
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      notify('Alleen PDF-bestanden toegestaan.', 'error');
      return;
    }
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      notify(`Bestand is te groot (max ${MAX_PDF_MB} MB).`, 'error');
      return;
    }

    setIsUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Kon bestand niet lezen.'));
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/ritblaadje', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ filename: file.name, dataUrl }),
      });
      const text = await response.text();
      if (!response.ok) {
        let detail = text;
        try { detail = JSON.parse(text).error || detail; } catch {}
        throw new Error(detail);
      }
      const updated = JSON.parse(text);
      setCurrent(updated);
      setFromCache(false);
      try {
        const now = new Date().toISOString();
        setSyncedAt(now);
        localStorage.setItem(SYNCED_AT_KEY, now);
        localStorage.setItem(META_CACHE_KEY, JSON.stringify(updated));
      } catch { /* localStorage geblokkeerd */ }
      notify('Ritblad succesvol bijgewerkt.', 'success');
    } catch (error: any) {
      notify('Upload mislukt: ' + error.message, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async () => {
    try {
      const response = await fetch('/api/ritblaadje', {
        method: 'DELETE',
        headers: await getSupabaseAuthHeaders(),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text);
      }
      setCurrent(null);
      try {
        localStorage.removeItem(META_CACHE_KEY);
        localStorage.removeItem(SYNCED_AT_KEY);
      } catch { /* localStorage geblokkeerd */ }
      notify('Ritblad verwijderd.', 'success');
    } catch (error: any) {
      notify('Verwijderen mislukt: ' + error.message, 'error');
    }
  };

  return (
    <PageShell width="5xl">
      <PageHeader
        title="Ritbladen"
        description="De actuele ritbladen. Admins vervangen de PDF wanneer de dienstregeling wijzigt."
        actions={canEdit ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={handleFile}
              disabled={isUploading}
            />
            <Button
              variant="primary"
              icon={<Upload size={16} />}
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? 'Uploaden...' : current ? 'Vervang PDF' : 'Upload PDF'}
            </Button>
          </>
        ) : undefined}
      />

      {isLoading ? (
        <div className="surface-card p-5 md:p-6 rounded-3xl space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton rounded="xl" className="w-10 h-10 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-2.5 w-1/4" />
            </div>
          </div>
          <Skeleton rounded="2xl" className="w-full h-[320px]" />
        </div>
      ) : !current ? (
        <EmptyState
          icon={<FileText size={28} />}
          title="Nog geen ritblad beschikbaar"
          message={canEdit ? 'Upload een PDF om te delen met alle chauffeurs.' : 'Zodra er een nieuw ritblad is, verschijnt het hier.'}
        />
      ) : (
        <div className="space-y-6">
          <div className="surface-card rounded-3xl p-6 md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-oker-50 text-oker-600 ring-1 ring-oker-100 flex items-center justify-center shrink-0">
                  <FileText size={22} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MicroLabel>Huidige ritbladen</MicroLabel>
                    {fromCache && <Badge tone="amber" dot>Offline</Badge>}
                  </div>
                  <h4 className="mt-1 text-lg font-semibold text-slate-900 tracking-tight break-all">{current.filename}</h4>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Geüpload {current.uploadedBy ? `door ${current.uploadedBy} ` : ''}op {formatUploadedAt(current.uploadedAt)}
                    {current.sizeBytes ? ` · ${formatSize(current.sizeBytes)}` : ''}
                  </p>
                  {formatSyncedAt(syncedAt) && (
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                      Laatst bijgewerkt {formatSyncedAt(syncedAt)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* openPdfInNewTab i.p.v. een download-anchor: het download-
                    attribuut wordt op een cross-origin signed URL genegeerd,
                    waardoor de PWA in standalone wegnavigeert. Openen in een
                    (nieuw) tabblad laat de gebruiker daar bewaren, met
                    same-window-fallback in standalone. */}
                <button
                  type="button"
                  onClick={() => openPdfInNewTab(current.url)}
                  className="control-button-soft ios-pressable inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:text-slate-900 transition-all"
                >
                  <Download size={16} />
                  Openen
                </button>
                {canDelete && (
                  <Button
                    variant="danger"
                    icon={<Trash2 size={16} />}
                    onClick={() => setConfirmDeleteOpen(true)}
                    title="Verwijder ritblad"
                    aria-label="Verwijder ritblad"
                  >
                    <span className="hidden sm:inline">Verwijderen</span>
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="surface-card rounded-3xl overflow-hidden">
            <iframe
              src={current.url}
              title="Ritblad-voorbeeld"
              className="w-full h-[70vh] min-h-[480px] bg-white"
            />
          </div>

          <p className="text-xs font-medium text-slate-400 text-center">
            Werkt de preview niet op je toestel? Gebruik de <span className="text-slate-600 font-semibold">Download</span>-knop om het bestand lokaal te openen.
          </p>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Ritblad verwijderen"
        message="Weet je zeker dat je het huidige ritblad wilt verwijderen? Chauffeurs zien daarna geen bestand meer tot een nieuwe PDF is geüpload."
      />
    </PageShell>
  );
}
