import React, { useEffect, useState } from 'react';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import type { User } from '../types';
import { cn, getSupabaseAuthHeaders, notify } from '../lib/ui';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../components/ui';

type RitblaadjeMeta = {
  filename: string;
  storagePath: string;
  uploadedAt: string;
  uploadedBy: string | null;
  sizeBytes: number | null;
  url: string;
};

const MAX_PDF_MB = 20;

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

  const canEdit = currentUser.role === 'planner' || currentUser.role === 'admin';
  const canDelete = currentUser.role === 'admin';

  const fetchCurrent = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/ritblaadje', { headers: await getSupabaseAuthHeaders() });
      if (!response.ok) throw new Error(`Server antwoordde ${response.status}`);
      const data = await response.json();
      setCurrent(data);
    } catch (error: any) {
      notify('Kon ritblaadje niet laden: ' + error.message, 'error');
      setCurrent(null);
    } finally {
      setIsLoading(false);
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
      setCurrent(JSON.parse(text));
      notify('Ritblaadje succesvol bijgewerkt.', 'success');
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
      notify('Ritblaadje verwijderd.', 'success');
    } catch (error: any) {
      notify('Verwijderen mislukt: ' + error.message, 'error');
    }
  };

  return (
    <PageShell width="5xl">
      <PageHeader
        title="Ritblaadjes"
        description="De actuele rit-informatie voor alle chauffeurs. Planners en admins kunnen de PDF vervangen wanneer de dienstregeling wijzigt."
        actions={canEdit ? (
          <label className={cn(
            'btn-primary ios-pressable px-6 py-3 text-xs uppercase tracking-widest flex items-center gap-2 cursor-pointer',
            isUploading && 'opacity-60 cursor-not-allowed',
          )}>
            <Upload size={16} />
            {isUploading ? 'Uploaden...' : current ? 'Vervang PDF' : 'Upload PDF'}
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={handleFile}
              disabled={isUploading}
            />
          </label>
        ) : undefined}
      />

      {isLoading ? (
        <div className="surface-card p-8 rounded-[28px] flex items-center justify-center min-h-[200px]">
          <div className="flex items-center gap-3 text-slate-500">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
            <span className="text-sm font-bold">Ritblaadje laden...</span>
          </div>
        </div>
      ) : !current ? (
        <EmptyState
          icon={<FileText size={28} />}
          title="Nog geen ritblaadje beschikbaar"
          message={canEdit ? 'Upload een PDF om te delen met alle chauffeurs.' : 'Zodra er een nieuw ritblaadje is, verschijnt het hier.'}
        />
      ) : (
        <div className="space-y-6">
          <div className="surface-card rounded-[28px] p-6 md:p-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-oker-50 text-oker-600 ring-1 ring-oker-100 flex items-center justify-center shrink-0">
                  <FileText size={22} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Huidige ritblaadjes</p>
                  <h4 className="mt-1 text-lg font-black text-slate-900 tracking-tight break-all">{current.filename}</h4>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    Geüpload {current.uploadedBy ? `door ${current.uploadedBy} ` : ''}op {formatUploadedAt(current.uploadedAt)}
                    {current.sizeBytes ? ` · ${formatSize(current.sizeBytes)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={current.url}
                  download={current.filename}
                  className="btn-primary ios-pressable px-5 py-3 text-xs uppercase tracking-widest flex items-center gap-2"
                >
                  <Download size={16} />
                  Download
                </a>
                {canDelete && (
                  <button
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="glass-icon-button p-3 rounded-full text-red-500 active:scale-95 transition-all"
                    title="Verwijder ritblaadje"
                    aria-label="Verwijder ritblaadje"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="surface-card rounded-[28px] overflow-hidden">
            <iframe
              src={current.url}
              title="Ritblaadje voorbeeld"
              className="w-full h-[70vh] min-h-[480px] bg-white"
            />
          </div>

          <p className="text-xs font-medium text-slate-400 text-center">
            Werkt de preview niet op je toestel? Gebruik de <span className="text-slate-600 font-bold">Download</span>-knop om het bestand lokaal te openen.
          </p>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Ritblaadje verwijderen"
        message="Weet je zeker dat je het huidige ritblaadje wilt verwijderen? Chauffeurs zien daarna geen bestand meer tot een nieuwe PDF is geüpload."
      />
    </PageShell>
  );
}
