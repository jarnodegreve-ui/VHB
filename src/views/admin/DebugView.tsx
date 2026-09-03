import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bug, DownloadCloud, FlaskConical, Mail, Plus, Trash2, UploadCloud } from 'lucide-react';
import type { Service, Shift, User } from '../../types';
import { cn, downloadBlob, notify } from '../../lib/ui';
import { ConfirmationModal, PageHeader, PageShell } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, Chip } from '../../components/primitives';
import { Card, CardHeader } from '../../components/Card';
import { InfoTip } from '../../components/InfoTip';
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

/** Eén sleutel/waarde-regel in een statuskaart. */
function StatusRij({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      {children}
    </div>
  );
}

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
        setTestResult(`Algemene POST-test mislukt (${testResponse.status}). Dit duidt op een server-/Vercel-configuratieprobleem.`);
        return;
      }

      // Bewust GEEN schrijftest meer via POST /api/users: dat endpoint heeft
      // replace-all-semantiek (één testgebruiker insturen = alle anderen
      // verwijderen) en werd alleen door de minimum-één-admin-vangrail
      // tegengehouden — de test faalde daardoor ook altijd. De health-check
      // hieronder dekt de databaseverbinding al af.
      setTestResult('Succes: API bereikbaar en POST-routing werkt.');
    } catch (error: any) {
      setTestResult(`Fout: ${error.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const myTestShifts = shifts.filter((s) => s.driverId === currentUser.id && s.id.startsWith(TEST_SHIFT_ID_PREFIX));

  const addTestShift = async () => {
    if (services.length === 0) {
      notify('Geen diensten beschikbaar — voeg eerst een dienst toe via Beheer dienstoverzicht.', 'error');
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

  const testOk = Boolean(testResult && testResult.startsWith('Succes'));

  return (
    <PageShell>
      <PageHeader
        eyebrow="Systeem"
        title="Systeemstatus"
        description="Koppelingen, tabellen en health checks."
        actions={(
          <>
            <Button variant="secondary" onClick={testWrite} disabled={isTesting}>
              {isTesting ? 'Testen…' : 'Test schrijven'}
            </Button>
            <Button variant="primary" onClick={checkHealth} disabled={isCheckingHealth}>
              {isCheckingHealth ? 'Controleren…' : 'Status verversen'}
            </Button>
          </>
        )}
      />

      {testResult && (
        <Card tone={testOk ? 'success' : 'danger'} padding="sm" role="status">
          <p className={cn('text-sm font-semibold', testOk ? 'text-emerald-700' : 'text-red-700')}>{testResult}</p>
        </Card>
      )}

      <Card>
        <CardHeader title="Versie" />
        <div className="mt-4 space-y-3">
          <StatusRij label="App-versie">
            <span className="text-sm font-semibold text-slate-800 tabular-nums">v{BUILD_INFO.version}</span>
          </StatusRij>
          <StatusRij label="Build (commit)">
            {BUILD_INFO.sha ? (
              <a
                href={`https://github.com/jarnodegreve-ui/VHB/commit/${BUILD_INFO.sha}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-oker-700 tabular-nums"
              >
                {BUILD_INFO.sha}
              </a>
            ) : (
              <span className="text-xs font-mono text-slate-500">lokaal</span>
            )}
          </StatusRij>
          <StatusRij label="Gebouwd op">
            <span className="text-xs font-mono text-slate-500 tabular-nums">{new Date(BUILD_INFO.builtAt).toLocaleString('nl-BE')}</span>
          </StatusRij>
          <StatusRij label="Service worker">
            {swVersion ? (
              <Badge tone="emerald" dot>{swVersion}</Badge>
            ) : (
              <span className="text-xs font-mono text-slate-500">niet actief</span>
            )}
          </StatusRij>
        </div>
      </Card>

      {healthData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Supabase" />
              <div className="mt-4 space-y-3">
                <StatusRij label="Configuratie">
                  <Badge tone={healthData.supabase === 'configured' ? 'emerald' : 'red'} dot>
                    {healthData.supabase}
                  </Badge>
                </StatusRij>
                <StatusRij label="Omgeving">
                  <span className="text-sm font-semibold text-slate-800">{healthData.env}</span>
                </StatusRij>
                <StatusRij label="Servertijd">
                  <span className="text-xs font-mono text-slate-500 tabular-nums">{new Date(healthData.time).toLocaleString('nl-BE')}</span>
                </StatusRij>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="E-mail"
                aside={(
                  <InfoTip label="Uitleg bij e-mail" align="right">
                    Zonder SMTP_USER/SMTP_PASS worden mails alleen gelogd, niet verstuurd — verlofbeslissingen en updates komen dan nergens aan. Een testmail is de enige echte bevestiging dat de SMTP-gegevens kloppen.
                  </InfoTip>
                )}
              />
              <div className="mt-4 space-y-3">
                <StatusRij label="SMTP">
                  <Badge tone={healthData.smtp?.status === 'configured' ? 'emerald' : 'red'} dot>
                    {healthData.smtp?.status === 'configured' ? 'geconfigureerd' : 'niet geconfigureerd'}
                  </Badge>
                </StatusRij>
                {healthData.smtp?.status === 'configured' ? (
                  <>
                    <StatusRij label="Afzender">
                      <span className="min-w-0 truncate text-xs font-mono text-slate-500">{healthData.smtp.from}</span>
                    </StatusRij>
                    <StatusRij label="Server">
                      <span className="min-w-0 truncate text-xs font-mono text-slate-500">{healthData.smtp.host}</span>
                    </StatusRij>
                  </>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={sendTestEmail}
                  disabled={isMailTesting}
                  icon={<Mail size={14} />}
                >
                  {isMailTesting ? 'Versturen…' : 'Stuur testmail naar mezelf'}
                </Button>
                {mailTest && (
                  <Card tone={mailTest.ok ? 'success' : 'danger'} padding="sm" role="status">
                    <p className={cn('break-words text-xs font-medium', mailTest.ok ? 'text-emerald-700' : 'text-red-700')}>{mailTest.message}</p>
                  </Card>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Tabellen"
                aside={(
                  <InfoTip label="Hulp bij problemen" align="right">
                    Staat een tabel op "Fout", dan bestaat ze waarschijnlijk nog niet in Supabase of staan de rechten niet goed. Het volledige verwachte schema staat in <Chip>supabase/</Chip> in de repo (setup + migraties).
                  </InfoTip>
                )}
              />
              <div className="mt-4 space-y-3">
                {Object.entries(healthData.tables || {}).map(([name, status]: [string, any]) => (
                  <div key={name} className="flex flex-col gap-1">
                    <StatusRij label={name}>
                      <Badge tone={status === 'OK' ? 'emerald' : 'red'} dot>
                        {status === 'OK' ? 'OK' : 'Fout'}
                      </Badge>
                    </StatusRij>
                    {status !== 'OK' && <p className="mt-1 break-all rounded-lg bg-red-50 p-2 font-mono text-2xs text-red-700">{status}</p>}
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Ruwe health-data" description="Het volledige antwoord van de health check." />
              <pre className="mt-4 max-h-64 overflow-auto rounded-2xl bg-ink p-4 font-mono text-xs text-white/75">{JSON.stringify(healthData, null, 2)}</pre>
            </Card>
          </div>
        </div>
      )}

      <OcpiCard />

      <Card padding="lg">
        <CardHeader
          icon={<DownloadCloud size={16} />}
          title="Back-up"
          description="Alle gegevens als één JSON-bestand — je herstelpad als er iets misgaat."
          aside={(
            <InfoTip label="Wat zit er in de back-up?" align="right">
              <p>Gebruikers, planning, diensten, omleidingen, updates, verlof, dienstruilen, planningscodes en de audit-log. Bewaar het bestand op een veilige plek.</p>
              <p className="mt-2">De PDF-bestanden van omleidingen zitten er niet in; die staan apart in Supabase Storage.</p>
            </InfoTip>
          )}
        />
        <div className="mt-4">
          <Button variant="primary" onClick={downloadBackup} disabled={isExporting} icon={<DownloadCloud size={16} />}>
            {isExporting ? 'Exporteren…' : 'Download volledige back-up'}
          </Button>
        </div>
      </Card>

      {/* Gevarenzone: compact — één regel, uitleg in de popover, knop rechts. */}
      <Card tone="danger">
        <CardHeader
          icon={<UploadCloud size={16} />}
          title="Herstellen vanuit back-up"
          description="Overschrijft de huidige gegevens met een back-upbestand; je bevestigt eerst een overzicht."
          aside={(
            <>
              <InfoTip label="Uitleg bij herstellen" align="right">
                <p>Zet planning, gebruikers, verlof, dienstruilen en de andere collecties terug naar de inhoud van het bestand — gebruik dit enkel om een verlies te herstellen.</p>
                <p className="mt-2">De audit-log en de import-historiek blijven ongewijzigd.</p>
              </InfoTip>
              <Button variant="danger" size="sm" onClick={() => restoreInputRef.current?.click()}>
                Kies back-upbestand…
              </Button>
            </>
          )}
        />
        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => handleRestoreFile(e.target.files?.[0])}
        />
      </Card>

      <Card padding="lg">
        <CardHeader
          icon={<Bug size={16} />}
          title="Recente client-fouten"
          aside={(
            <InfoTip label="Uitleg bij client-fouten" align="right">
              Fouten die bij gebruikers in de browser optraden (crashes én fout-toasts) worden automatisch gerapporteerd. Ze staan altijd in de Vercel-functielogs; hier verschijnen ze zodra de optionele <Chip>client_errors</Chip>-tabel in Supabase bestaat.
            </InfoTip>
          )}
        />
        <div className="mt-4 min-w-0">
          {clientErrors === null ? (
            <p className="text-sm font-medium text-slate-500">Niet beschikbaar.</p>
          ) : clientErrors.length === 0 ? (
            <p className="text-sm font-medium text-emerald-700">Geen fouten gerapporteerd.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {clientErrors.slice(0, 25).map((e) => (
                <Card key={e.id} tone="muted" padding="sm" className="rounded-xl">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone="red" dot>{e.source || 'onbekend'}</Badge>
                    <span className="shrink-0 font-mono text-2xs text-slate-500 tabular-nums">{new Date(e.createdAt).toLocaleString('nl-BE')}</span>
                  </div>
                  <p className="mt-1.5 break-words text-xs font-medium text-slate-700">{e.message}</p>
                  {(e.url || e.userId) && (
                    <p className="mt-1 break-all font-mono text-2xs text-slate-500">{[e.url, e.userId && `gebruiker ${e.userId}`].filter(Boolean).join(' · ')}</p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card padding="lg">
        <CardHeader
          icon={<FlaskConical size={16} />}
          title="Testomgeving"
          description="Een fictieve dienst op je eigen account om de chauffeursflows te testen."
          aside={(
            <InfoTip label="Uitleg bij de testomgeving" align="right">
              Dienstnummer en tijden komen van een bestaande dienst zodat het realistisch oogt. Busnummer <Chip>TEST</Chip> markeert het als testdata; de opruimknop verwijdert al je fictieve diensten in één keer.
            </InfoTip>
          )}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<Plus size={16} />} onClick={addTestShift}>
            Fictieve dienst aanmaken
          </Button>
          <Button variant="secondary" icon={<Trash2 size={16} />} onClick={clearTestShifts} disabled={myTestShifts.length === 0}>
            Fictieve diensten verwijderen ({myTestShifts.length})
          </Button>
        </div>
      </Card>

      <ConfirmationModal
        isOpen={restoreConfirmOpen}
        onClose={() => { setRestoreConfirmOpen(false); setPendingRestore(null); }}
        onConfirm={applyRestore}
        title="Back-up terugzetten?"
        variant="danger"
        confirmText={isRestoring ? 'Bezig…' : 'Ja, alles terugzetten'}
        message={
          pendingRestore
            ? `Je staat op het punt de huidige gegevens te overschrijven met de back-up${pendingRestore.exportedAt ? ` van ${new Date(pendingRestore.exportedAt).toLocaleString('nl-BE')}` : ''}. Dit wordt teruggezet: ${restorePreview.map((p) => `${p.label} (${p.count})`).join(' · ')}. Deze actie kan niet ongedaan gemaakt worden — maak desgewenst eerst een verse back-up.`
            : ''
        }
      />
    </PageShell>
  );
}
