import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import type { User } from '../types';
import { notify, openPdfInNewTab } from '../lib/ui';
import { prettySize } from '../lib/format';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../components/ui';
import { apiFetch } from '../lib/api';
import { Badge, Button } from '../components/primitives';
import { Card } from '../components/Card';
import { Skeleton } from '../components/Skeleton';
import { Zijvak, ZijvakLayout, ZijvakRij } from '../components/Zijvak';

type RitblaadjeMeta = {
  filename: string;
  storagePath: string;
  uploadedAt: string;
  uploadedBy: string | null;
  sizeBytes: number | null;
  url?: string;
};

const MAX_PDF_MB = 20;

// localStorage-keys voor offline-fallback van de ritblaadje-metadata.
// Het ritblaadje is één gedeelde resource, dus cachen is veilig — maar de
// signed `url` gaat er BEWUST niet volledig in: die verleent toegang buiten
// de login/toestel-whitelist om en bleef zo op een gedeelde depot-tablet
// achter. We bewaren het QUERY-LOZE pad (origin + pathname): geen token,
// maar exact de cache-key waaronder de service worker de PDF bewaart —
// offline blijven de iframe en de Openen-knop zo werken.
const cacheSafeMeta = (meta: Record<string, unknown>) => {
  const { url, ...rest } = meta;
  if (typeof url !== 'string' || !url) return rest;
  try {
    const u = new URL(url);
    return { ...rest, url: `${u.origin}${u.pathname}` };
  } catch {
    return rest;
  }
};
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
  // Op een touch-toestel (iPhone) rendert WKWebView een PDF in een <iframe>
  // als één niet-scrolbare eerste pagina — een chauffeur zag van een
  // meerpaginas ritblad dus stilzwijgend maar de helft. Daar tonen we een
  // open-kaart i.p.v. de iframe.
  const [touchToestel] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
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
      const response = await apiFetch('/api/ritblaadje');
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
        if (data) localStorage.setItem(META_CACHE_KEY, JSON.stringify(cacheSafeMeta(data)));
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

      const response = await apiFetch('/api/ritblaadje', {
        method: 'POST',
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
        localStorage.setItem(META_CACHE_KEY, JSON.stringify(cacheSafeMeta(updated)));
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
      const response = await apiFetch('/api/ritblaadje', {
        method: 'DELETE',
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

  // Het bestandsveld staat één keer buiten de kop: de Upload-knop (kop, zonder
  // ritblad) én Vervangen (zijvak, mét ritblad) openen hetzelfde veld.
  const kiesBestand = () => fileInputRef.current?.click();

  // Zijvak "Huidig ritblad": bestand, geüpload op, grootte en de acties —
  // de tabelrij/kaart van vroeger dubbelde die info boven de preview.
  const zijvak = current ? (
    <Zijvak
      titel="Huidig ritblad"
      aside={fromCache ? <Badge tone="amber" dot>Offline</Badge> : undefined}
      voet={(
        <div className="flex flex-wrap items-center gap-2">
          {/* openPdfInNewTab i.p.v. een download-anchor: het download-
              attribuut wordt op een cross-origin signed URL genegeerd,
              waardoor de PWA in standalone wegnavigeert. Openen in een
              (nieuw) tabblad laat de gebruiker daar bewaren, met
              same-window-fallback in standalone. */}
          <Button variant="secondary" size="sm" disabled={!current.url} onClick={() => current.url && openPdfInNewTab(current.url)} icon={<Download size={14} />}>
            Openen
          </Button>
          {canEdit && (
            <Button variant="secondary" size="sm" disabled={isUploading} onClick={kiesBestand} icon={<Upload size={14} />}>
              {isUploading ? 'Uploaden…' : 'Vervangen'}
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setConfirmDeleteOpen(true)} aria-label="Verwijder ritblad">
              Verwijderen
            </Button>
          )}
        </div>
      )}
    >
      <ZijvakRij label="Bestand" waarde={<span title={current.filename}>{current.filename}</span>} />
      <ZijvakRij label="Geüpload op" waarde={formatUploadedAt(current.uploadedAt)} mono />
      {current.uploadedBy ? <ZijvakRij label="Door" waarde={current.uploadedBy} /> : null}
      <ZijvakRij label="Grootte" waarde={current.sizeBytes ? prettySize(current.sizeBytes) : '—'} mono={!!current.sizeBytes} />
      {formatSyncedAt(syncedAt) ? <ZijvakRij label="Laatst bijgewerkt" waarde={formatSyncedAt(syncedAt)} mono /> : null}
    </Zijvak>
  ) : undefined;

  return (
    <PageShell>
      {canEdit && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleFile}
          disabled={isUploading}
        />
      )}
      <PageHeader
        title="Ritbladen"
        description="De actuele ritbladen."
        actions={canEdit && !isLoading && !current ? (
          <Button variant="primary" icon={<Upload size={16} />} disabled={isUploading} onClick={kiesBestand}>
            {isUploading ? 'Uploaden…' : 'Upload PDF'}
          </Button>
        ) : undefined}
      />

      {isLoading ? (
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton rounded="xl" className="w-10 h-10 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-2.5 w-1/4" />
            </div>
          </div>
          <Skeleton rounded="2xl" className="w-full h-[320px]" />
        </Card>
      ) : !current ? (
        <EmptyState
          title="Nog geen ritblad beschikbaar"
          message={canEdit ? 'Upload een PDF via de knop bovenaan om te delen met alle chauffeurs.' : 'Zodra er een nieuw ritblad is, verschijnt het hier.'}
        />
      ) : (
        /* Desktop: preview/open-kaart als hoofdkolom, het zijvak ernaast;
           mobiel: zijvak onder de kaart (afwerkingsronde 04-09). */
        <ZijvakLayout zijvak={zijvak}>
          <Card padding="none" className="overflow-hidden">
            {current.url && touchToestel ? (
              /* Opent het vólledige PDF via openPdfInNewTab (met standalone-
                 fallback); de iframe-preview toont op iOS alleen pagina 1,
                 zonder enige hint dat er meer is. */
              /* rauw: grote open-kaart met eigen layout (icoontegel + titel + uitleg) */
              <button
                type="button"
                onClick={() => openPdfInNewTab(current.url!)}
                className="ios-pressable flex w-full flex-col items-center justify-center gap-3 px-8 py-14 text-center"
              >
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-oker-500/15 text-oker-700">
                  <FileText size={20} />
                </span>
                <span className="text-base font-semibold text-slate-800">Bekijk ritblad</span>
                <span className="max-w-sm text-sm font-normal leading-relaxed text-slate-500">
                  Opent het volledige document — alle pagina's, met knijp-zoom.
                </span>
              </button>
            ) : current.url ? (
              <iframe
                src={current.url}
                title="Ritblad-voorbeeld"
                className="w-full h-[70vh] min-h-[480px] bg-surface-white"
              />
            ) : (
              /* Oude offline-cache van vóór deze fix heeft geen url — dan
                 liever een eerlijke melding dan een leeg wit vlak. */
              <div className="flex h-[40vh] min-h-[280px] items-center justify-center p-8 text-center">
                <p className="text-sm font-medium text-slate-500">Het ritblad is offline nog niet beschikbaar op dit toestel. Open het één keer met internet, daarna werkt het ook offline.</p>
              </div>
            )}
          </Card>

          {!touchToestel && (
            <p className="text-xs font-medium text-slate-500 text-center">
              Werkt de preview niet op je toestel? Gebruik de <span className="text-slate-600 font-semibold">Openen</span>-knop om het bestand lokaal te openen.
            </p>
          )}
        </ZijvakLayout>
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
