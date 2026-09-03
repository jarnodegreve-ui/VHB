import { useEffect, useRef, useState } from 'react';
import { Activity, Bug, DownloadCloud, FlaskConical, Mail, UploadCloud } from 'lucide-react';
import type { Service, Shift, User } from '../../types';
import { cn, downloadBlob, notify } from '../../lib/ui';
import { ConfirmationModal, PageHeader, PageShell } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, MicroLabel } from '../../components/primitives';
import { BUILD_INFO, getServiceWorkerVersion } from '../../lib/appVersion';
import { isoDate } from '../../lib/availability';
import { OcpiCard } from './OcpiCard';

const COLLECTION_LABELS: Record<string, string> = {
  users: 'Gebruikers',
  planning: 'Planning (diensten)',
  services: 'Dienstoverzicht',
  diversions: 'Omleidingen',
  updates: 'Updates',
  leave: 'Verlofaanvragen',
  swaps: 'Dienstruilen',
  planningCodes: 'Planningscodes',
  planningMatrixRows: 'Planning-matrix',
  coverageExpectations: 'Dekkingsverwachtingen',
};

const TEST_SHIFT_ID_PREFIX = 'test-shift-';

// onSaveShifts geeft in de praktijk savePlanning door, en dat is een
// Promise<boolean> (false = de save is afgewezen). Het type stond op
// Promise<void> en verzweeg dat — zichtbaar geworden toen de React-types
// eindelijk meededen. Zelfde vorm als onSave elders in de app.
export function DebugView({ currentUser, shifts, services, onSaveShifts }: { currentUser: User; shifts: Shift[]; services: Service[]; onSaveShifts: (s: Shift[]) => void | boolean | Promise<void | boolean> }) {
  const [healthData, setHealthData] = useState<any>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [mailTest, setMailTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [isMailTesting, setIsMailTesting] = useState(false);
  const [clientErrors, setClientErrors] = useState<Array<{ id: string | number; createdAt: string; message: string; source?: string; url?: string; userId?: string }> | null>(null);
  const [swVersion, setSwVersion] = useState<string | null>(null);

  // Restore-flow: bestand inlezen → preview tonen → bevestigen → toepassen.
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<{ exportedAt?: string; collections: Record<string, any> } | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.collections || typeof parsed.collections !== 'object') {
        notify('Dit lijkt geen geldig VHB-back-upbestand (geen "collections").', 'error');
        return;
      }
      const users = parsed.collections.users;
      if (Array.isArray(users) && !users.some((u: any) => u?.role === 'admin')) {
        notify('Herstel geweigerd: deze back-up bevat geen admin-account.', 'error');
        return;
      }
      setPendingRestore(parsed);
      setRestoreConfirmOpen(true);
    } catch {
      notify('Kon het bestand niet lezen — is het een geldig JSON-back-upbestand?', 'error');
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  };

  const applyRestore = async () => {
    if (!pendingRestore) return;
    try {
      setIsRestoring(true);
      const response = await apiFetch('/api/restore', {
        method: 'POST',
        body: JSON.stringify(pendingRestore),
      });
      if (response.status === 413) {
        notify('De back-up is te groot om te herstellen via de browser. Neem contact op zodat we hem rechtstreeks kunnen terugzetten.', 'error');
        return;
      }
      const data = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        const partial = data.appliedSoFar && Object.keys(data.appliedSoFar).length
          ? ` Al teruggezet: ${Object.entries(data.appliedSoFar).map(([k, v]) => `${k} (${v})`).join(', ')}.`
          : '';
        notify((data.details || data.error || `Herstellen mislukt (${response.status}).`) + partial, 'error');
        return;
      }
      notify('Back-up hersteld. De pagina wordt herladen…', 'success');
      // Alle collecties zijn vervangen — een harde reload is de eenvoudigste,
      // betrouwbaarste manier om de hele app-state opnieuw op te bouwen.
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      notify('Herstellen is mislukt.', 'error');
    } finally {
      setIsRestoring(false);
      setPendingRestore(null);
    }
  };

  const restorePreview = pendingRestore
    ? Object.entries(pendingRestore.collections)
        .filter(([key]) => key in COLLECTION_LABELS)
        .map(([key, value]) => ({
          key,
          label: COLLECTION_LABELS[key],
          count: Array.isArray(value) ? value.length : (value && typeof value === 'object' ? Object.keys(value).length : 0),
        }))
    : [];

  const downloadBackup = async () => {
    try {
      setIsExporting(true);
      const response = await apiFetch('/api/backup');
      if (!response.ok) {
        const err = await response.json().catch(() => ({} as any));
        notify(err.details || err.error || `Back-up mislukt (${response.status}).`, 'error');
        return;
      }
      // downloadBlob i.p.v. een handmatige <a download>: dezelfde iOS-share-
      // route, revokeObjectURL en bevestigings-toast als de andere exports.
      await downloadBlob(`vhb-backup-${new Date().toISOString().slice(0, 10)}.json`, await response.blob());
    } catch {
      notify('Back-up downloaden is mislukt.', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const fetchClientErrors = async () => {
    try {
      const response = await apiFetch('/api/client-errors');
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data)) setClientErrors(data);
    } catch {
      // niet-kritisch: kaart toont dan 'niet beschikbaar'
    }
  };

  // Testmail: de enige echte bevestiging dat de SMTP-gegevens kloppen —
  // zonder verzenden lijkt alles te werken (sendEmail logt dan alleen).
  const sendTestEmail = async () => {
    setIsMailTesting(true);
    setMailTest(null);
    try {
      const res = await apiFetch('/api/admin/test-email', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      setMailTest(res.ok
        ? { ok: true, message: data.message || 'Testmail verstuurd.' }
        : { ok: false, message: data.error || `Verzenden mislukt (${res.status}).` });
    } catch (err: any) {
      setMailTest({ ok: false, message: err?.message || 'Netwerkfout bij het versturen.' });
    } finally {
      setIsMailTesting(false);
    }
  };

  const checkHealth = async () => {
    try {
      setIsCheckingHealth(true);
      // Het publieke /api/health is bewust kaal (alleen status+tijd, geen
      // info-disclosure); de config-/tabelstatussen zitten in het admin-only
      // details-endpoint.
      const response = await apiFetch('/api/health/details');
      const data = await response.json();
      setHealthData(data);
    } catch (error) {
      console.error('Health check error:', error);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const testWrite = async () => {
    try {
      setIsTesting(true);
      setTestResult(null);

      const testResponse = await apiFetch('/api/test', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
      });

      if (!testResponse.ok) {
        setTestResult(`Algemene POST test mislukt (${testResponse.status}). Dit duidt op een server/Vercel configuratie probleem.`);
        return;
      }

      // Bewust GEEN schrijftest meer via POST /api/users: dat endpoint heeft
      // replace-all-semantiek (één testgebruiker insturen = alle anderen
      // verwijderen) en werd alleen door de minimum-één-admin-vangrail
      // tegengehouden — de test faalde daardoor ook altijd. De health-check
      // hieronder dekt de databaseverbinding al af.
      setTestResult('Succes! API bereikbaar en POST-routing werkt.');
    } catch (error: any) {
      setTestResult(`Fout: ${error.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const myTestShifts = shifts.filter((s) => s.driverId === currentUser.id && s.id.startsWith(TEST_SHIFT_ID_PREFIX));

  const addTestShift = async () => {
    if (services.length === 0) {
      notify('Geen diensten beschikbaar — voeg eerst een dienst toe via Beheer Dienstoverzicht.', 'error');
      return;
    }
    const sample = services[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = isoDate(tomorrow); // lokale datum (niet UTC)
    const newShift: Shift = {
      id: `${TEST_SHIFT_ID_PREFIX}${Date.now()}`,
      date: dateStr,
      startTime: sample.startTime,
      endTime: sample.endTime,
      line: sample.serviceNumber,
      busNumber: 'TEST',
      loopnr: '1',
      driverId: currentUser.id,
    };
    await onSaveShifts([...shifts, newShift]);
    notify(`Fictieve dienst ${sample.serviceNumber} (${sample.startTime}-${sample.endTime}) toegevoegd op ${dateStr}.`, 'success');
  };

  const clearTestShifts = async () => {
    if (myTestShifts.length === 0) {
      notify('Geen fictieve diensten op je naam gevonden.', 'info');
      return;
    }
    const remaining = shifts.filter((s) => !(s.driverId === currentUser.id && s.id.startsWith(TEST_SHIFT_ID_PREFIX)));
    await onSaveShifts(remaining);
    notify(`${myTestShifts.length} fictieve dienst${myTestShifts.length === 1 ? '' : 'en'} verwijderd.`, 'success');
  };

  useEffect(() => {
    checkHealth();
    fetchClientErrors();
    getServiceWorkerVersion().then(setSwVersion);
  }, []);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Systeem"
        title="Systeemstatus"
        actions={(
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={testWrite} disabled={isTesting}>
              {isTesting ? 'Testen…' : 'Test schrijven'}
            </Button>
            <Button variant="secondary" onClick={checkHealth} disabled={isCheckingHealth}>
              {isCheckingHealth ? 'Controleren…' : 'Status verversen'}
            </Button>
          </div>
        )}
      />

      {testResult && (
        <div
          className={cn(
            'p-4 rounded-2xl text-sm font-semibold',
            testResult.startsWith('Succes')
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
              : 'bg-red-50 text-red-700 border border-red-100'
          )}
        >
          {testResult}
        </div>
      )}

      <div className="surface-card p-6 rounded-3xl">
        <MicroLabel className="mb-4">Versie</MicroLabel>
        <div className="space-y-3">
          <div className="flex justify-between items-center gap-4">
            <span className="text-sm font-medium text-slate-600">App-versie:</span>
            <span className="text-sm font-semibold text-slate-800 tabular-nums">v{BUILD_INFO.version}</span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <span className="text-sm font-medium text-slate-600">Build (commit):</span>
            {BUILD_INFO.sha ? (
              <a
                href={`https://github.com/jarnodegreve-ui/VHB/commit/${BUILD_INFO.sha}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-oker-700 hover:text-oker-700 tabular-nums"
              >
                {BUILD_INFO.sha}
              </a>
            ) : (
              <span className="text-xs font-mono text-slate-400">lokaal</span>
            )}
          </div>
          <div className="flex justify-between items-center gap-4">
            <span className="text-sm font-medium text-slate-600">Gebouwd op:</span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">{new Date(BUILD_INFO.builtAt).toLocaleString('nl-BE')}</span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <span className="text-sm font-medium text-slate-600">Service worker:</span>
            {swVersion ? (
              <Badge tone="emerald" dot>{swVersion}</Badge>
            ) : (
              <span className="text-xs font-mono text-slate-400">niet actief</span>
            )}
          </div>
        </div>
      </div>

      {healthData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="surface-card p-6 rounded-3xl">
              <MicroLabel className="mb-4">Supabase Status</MicroLabel>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">Configuratie:</span>
                  <Badge tone={healthData.supabase === 'configured' ? 'emerald' : 'red'} dot>
                    {healthData.supabase}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">Omgeving:</span>
                  <span className="text-sm font-semibold text-slate-800">{healthData.env}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">Server Tijd:</span>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">{new Date(healthData.time).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="surface-card p-6 rounded-3xl">
              <MicroLabel className="mb-4">E-mail</MicroLabel>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">SMTP:</span>
                  <Badge tone={healthData.smtp?.status === 'configured' ? 'emerald' : 'red'} dot>
                    {healthData.smtp?.status === 'configured' ? 'geconfigureerd' : 'niet geconfigureerd'}
                  </Badge>
                </div>
                {healthData.smtp?.status === 'configured' ? (
                  <>
                    <div className="flex justify-between items-center gap-3">
                      <span className="text-sm font-medium text-slate-600">Afzender:</span>
                      <span className="text-xs font-mono text-slate-500 truncate">{healthData.smtp.from}</span>
                    </div>
                    <div className="flex justify-between items-center gap-3">
                      <span className="text-sm font-medium text-slate-600">Server:</span>
                      <span className="text-xs font-mono text-slate-500 truncate">{healthData.smtp.host}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs font-medium text-red-700">
                    Zonder SMTP_USER/SMTP_PASS worden mails alleen gelogd, niet verstuurd — verlofbeslissingen en updates komen dan nergens aan.
                  </p>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  full
                  onClick={sendTestEmail}
                  disabled={isMailTesting}
                  icon={<Mail size={16} />}
                >
                  {isMailTesting ? 'Versturen…' : 'Stuur testmail naar mezelf'}
                </Button>
                {mailTest && (
                  <p className={`text-xs font-medium break-words rounded-lg p-2 ${mailTest.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {mailTest.message}
                  </p>
                )}
              </div>
            </div>

            <div className="surface-card p-6 rounded-3xl">
              <MicroLabel className="mb-4">Tabel Status</MicroLabel>
              <div className="space-y-3">
                {Object.entries(healthData.tables || {}).map(([name, status]: [string, any]) => (
                  <div key={name} className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-slate-600 capitalize">{name}:</span>
                      <Badge tone={status === 'OK' ? 'emerald' : 'red'} dot>
                        {status === 'OK' ? 'OK' : 'Fout'}
                      </Badge>
                    </div>
                    {status !== 'OK' && <p className="text-2xs text-red-400 font-mono break-all bg-red-50 p-2 rounded-lg mt-1">{status}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-ink p-6 rounded-3xl text-white/75 font-mono text-xs overflow-auto max-h-64">
            <MicroLabel className="mb-4 text-slate-500">Raw Health Data</MicroLabel>
            <pre>{JSON.stringify(healthData, null, 2)}</pre>
          </div>
        </div>
      )}

      <OcpiCard />

      <div className="surface-card p-6 md:p-8 rounded-3xl">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-slate-500/12 text-slate-600 rounded-2xl">
            <DownloadCloud size={24} />
          </div>
          <div className="flex-1">
            <h4 className="text-slate-900 font-semibold text-lg mb-2">Back-up</h4>
            <p className="text-slate-600 text-sm leading-relaxed font-medium mb-4">
              Download alle gegevens (gebruikers, planning, diensten, omleidingen, updates, verlof, dienstruilen, planningscodes en de audit-log) als één JSON-bestand. Bewaar dit op een veilige plek — het is je herstelpad als er ooit iets misgaat. De PDF-bestanden van omleidingen zitten er niet in; die staan apart in Supabase Storage.
            </p>
            <Button variant="primary" onClick={downloadBackup} disabled={isExporting}>
              {isExporting ? 'Exporteren…' : 'Download volledige back-up'}
            </Button>
          </div>
        </div>
      </div>

      <div className="surface-card p-6 md:p-8 rounded-3xl border-2 border-red-100">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-red-500/12 text-red-700 rounded-2xl">
            <UploadCloud size={24} />
          </div>
          <div className="flex-1">
            <h4 className="text-slate-900 font-semibold text-lg mb-2">Herstellen vanuit back-up</h4>
            <p className="text-slate-600 text-sm leading-relaxed font-medium mb-4">
              Zet alle gegevens terug naar de inhoud van een back-upbestand. <strong className="text-red-700">Dit overschrijft de huidige planning, gebruikers, verlof, dienstruilen en meer</strong> — gebruik dit enkel om een verlies te herstellen. Je krijgt eerst een overzicht te zien en moet bevestigen. De audit-log en import-historiek blijven ongewijzigd.
            </p>
            <input
              ref={restoreInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => handleRestoreFile(e.target.files?.[0])}
            />
            <Button variant="secondary" onClick={() => restoreInputRef.current?.click()}>
              Kies back-upbestand…
            </Button>
          </div>
        </div>
      </div>

      <div className="surface-card p-6 md:p-8 rounded-3xl">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-red-500/12 text-red-700 rounded-2xl">
            <Bug size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-slate-900 font-semibold text-lg mb-2">Recente client-fouten</h4>
            <p className="text-slate-600 text-sm leading-relaxed font-medium mb-4">
              Fouten die bij gebruikers in de browser optraden (crashes én fout-toasts) worden automatisch gerapporteerd. Ze staan altijd in de Vercel-functielogs; hieronder verschijnen ze zodra de optionele <code className="bg-surface-muted px-1 rounded font-semibold">client_errors</code>-tabel in Supabase bestaat.
            </p>
            {clientErrors === null ? (
              <p className="text-sm font-medium text-slate-400">Niet beschikbaar.</p>
            ) : clientErrors.length === 0 ? (
              <p className="text-sm font-medium text-emerald-700">Geen fouten gerapporteerd. 🎉</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {clientErrors.slice(0, 25).map((e) => (
                  <div key={e.id} className="rounded-xl bg-surface-soft border border-slate-200/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Badge tone="red" dot>{e.source || 'onbekend'}</Badge>
                      <span className="text-2xs font-mono text-slate-400 tabular-nums shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-slate-700 break-words">{e.message}</p>
                    {(e.url || e.userId) && (
                      <p className="mt-1 text-2xs font-mono text-slate-400 break-all">{[e.url, e.userId && `gebruiker ${e.userId}`].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="surface-card p-6 md:p-8 rounded-3xl">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-oker-500/15 text-oker-700 rounded-2xl">
            <FlaskConical size={24} />
          </div>
          <div className="flex-1">
            <h4 className="text-slate-900 font-semibold text-lg mb-2">Test-omgeving</h4>
            <p className="text-slate-600 text-sm leading-relaxed font-medium mb-4">
              Maak een fictieve dienst aan op je eigen account om de chauffeur-flows (rooster, dienstruil, ...) te testen zonder een test-account aan te maken. Het dienstnummer en de tijden worden overgenomen van een bestaande dienst zodat het realistisch oogt. Busnummer <code className="bg-surface-muted px-1 rounded font-semibold">TEST</code> markeert het als test-data; cleanup-knop verwijdert ze allemaal in één keer.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={addTestShift}>
                + Maak fictieve dienst voor mezelf
              </Button>
              <Button variant="secondary" onClick={clearTestShifts} disabled={myTestShifts.length === 0}>
                Verwijder mijn fictieve diensten ({myTestShifts.length})
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-oker-50 p-8 rounded-3xl border border-oker-100">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-oker-500/15 text-oker-700 rounded-2xl">
            <Activity size={24} />
          </div>
          <div>
            <h4 className="text-oker-900 font-semibold text-lg mb-2">Hulp bij problemen</h4>
            <p className="text-oker-800 text-sm leading-relaxed font-medium">
              Als de tabellen hierboven "Error" of "Exception" aangeven, betekent dit dat de tabel waarschijnlijk nog niet bestaat in Supabase of dat de rechten niet goed staan.
              Controleer dan in Supabase of de betreffende tabel bestaat en of de rechten goed staan — het volledige verwachte schema staat in <code className="bg-oker-100 px-1 rounded font-semibold">supabase/</code> in de repo (setup + migraties).
            </p>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={restoreConfirmOpen}
        onClose={() => { setRestoreConfirmOpen(false); setPendingRestore(null); }}
        onConfirm={applyRestore}
        title="Back-up terugzetten?"
        variant="danger"
        confirmText={isRestoring ? 'Bezig…' : 'Ja, alles terugzetten'}
        message={
          pendingRestore
            ? `Je staat op het punt de huidige gegevens te overschrijven met de back-up${pendingRestore.exportedAt ? ` van ${new Date(pendingRestore.exportedAt).toLocaleString()}` : ''}. Dit wordt teruggezet: ${restorePreview.map((p) => `${p.label} (${p.count})`).join(' · ')}. Deze actie kan niet ongedaan gemaakt worden — maak desgewenst eerst een verse download-back-up.`
            : ''
        }
      />
    </PageShell>
  );
}
