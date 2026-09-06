import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bug, CheckCircle2, ChevronDown, ChevronRight, DownloadCloud, EyeOff, FlaskConical, Mail, Plus, RefreshCw, RotateCcw, Trash2, UploadCloud } from 'lucide-react';
import type { Service, Shift, User } from '../../types';
import { cn, downloadBlob, notify } from '../../lib/ui';
import { ConfirmationModal, PageHeader, PageShell } from '../../components/ui';
import { apiFetch, apiJson } from '../../lib/api';
import { Badge, Button, Chip, IconButton, TableShell, Td, Th } from '../../components/primitives';
import { Card, CardHeader } from '../../components/Card';
import { InfoTip } from '../../components/InfoTip';
import { ActieMenu } from '../../components/ActieMenu';
import { BUILD_INFO, RELEASE, getServiceWorkerVersion } from '../../lib/appVersion';
import { isoDate } from '../../lib/availability';
import { formatDateTimeHuman, formatRelatief } from '../../lib/format';
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

// --- Fouten: gegroepeerd per oorzaak (GET /api/client-errors?groepeer=1) ---

type FoutStatus = 'open' | 'opgelost' | 'genegeerd';
type Breadcrumb = { t: string; soort: string; tekst: string };
type FoutGroep = {
  fingerprint: string;
  message: string;
  source: string;
  topFrame: string | null;
  aantal: number;
  eerste: string;
  laatste: string;
  releases: string[];
  gebruikers: number;
  status: FoutStatus;
  regressie: boolean;
  laatsteVoorval: { createdAt: string; stack?: string; breadcrumbs?: Breadcrumb[]; url?: string; view?: string; role?: string; release?: string; userAgent?: string; online?: boolean; userId?: string };
};
type FoutenAntwoord = { groepen: FoutGroep[]; statusBeschikbaar: boolean };
type PlatteFout = { id: string | number; createdAt: string; message: string; source?: string; url?: string; userId?: string };

const BRON_LABEL: Record<string, string> = {
  'window.onerror': 'crash',
  unhandledrejection: 'rejection',
  'error-toast': 'fout-toast',
  'react-boundary': 'render-crash',
  gebruikersmelding: 'melding',
  csp: 'CSP',
};

function StatusBadge({ groep }: { groep: FoutGroep }) {
  if (groep.regressie) return <Badge tone="red" dot>Opnieuw</Badge>;
  if (groep.status === 'opgelost') return <Badge tone="emerald" stil>Opgelost</Badge>;
  if (groep.status === 'genegeerd') return <Badge tone="slate" stil>Genegeerd</Badge>;
  return <Badge tone="amber" stil>Open</Badge>;
}

/** Uitklapvak onder een groep: stack + broodkruimels + context van het laatste voorval. */
function FoutDetail({ groep }: { groep: FoutGroep }) {
  const v = groep.laatsteVoorval;
  const meta = [
    v.view && `scherm ${v.view}`,
    v.role && `rol ${v.role}`,
    v.release && `release ${v.release}`,
    typeof v.online === 'boolean' && (v.online ? 'online' : 'offline'),
    v.url && v.url,
    v.userId && `gebruiker ${v.userId}`,
  ].filter(Boolean).join(' · ');
  const kruimels = Array.isArray(v.breadcrumbs) ? v.breadcrumbs : [];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0">
        <p className="text-micro mb-1.5">Laatste voorval · {formatDateTimeHuman(v.createdAt)}</p>
        {meta && <p className="mb-2 break-words font-mono text-2xs text-slate-500">{meta}</p>}
        {v.userAgent && <p className="mb-2 break-words font-mono text-2xs text-slate-500">{v.userAgent}</p>}
        <pre className="max-h-48 overflow-auto rounded-xl bg-ink p-3 font-mono text-2xs leading-relaxed text-white/75">{v.stack || 'Geen stack meegestuurd.'}</pre>
      </div>
      <div className="min-w-0">
        <p className="text-micro mb-1.5">Broodkruimels (laatste 10)</p>
        {kruimels.length === 0 ? (
          <p className="text-sm text-slate-500">Geen broodkruimels bij dit voorval.</p>
        ) : (
          <ol className="divide-y divide-slate-200/60 rounded-xl ring-1 ring-hairline">
            {kruimels.map((k, i) => (
              <li key={`${k.t}-${i}`} className="flex items-baseline gap-2.5 px-3 py-1.5 text-xs">
                <span className="shrink-0 font-mono text-2xs tabular-nums text-slate-500">{k.t?.slice(11, 19)}</span>
                <Chip tone={k.soort === 'fout-toast' ? 'red' : 'slate'} mono={false}>{k.soort}</Chip>
                <span className="min-w-0 flex-1 break-words text-slate-700">{k.tekst}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function FoutenSectie() {
  const [data, setData] = useState<FoutenAntwoord | null>(null);
  const [plat, setPlat] = useState<PlatteFout[] | null>(null);
  const [beschikbaar, setBeschikbaar] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [bezig, setBezig] = useState<string | null>(null);

  const laad = async () => {
    try {
      const res = await apiFetch('/api/client-errors?groepeer=1');
      if (!res.ok) { setBeschikbaar(false); return; }
      const json = await res.json();
      if (json && Array.isArray(json.groepen)) {
        setData(json);
      } else if (Array.isArray(json)) {
        // Oudere server zonder groepering: de platte lijst als terugval.
        setPlat(json);
      }
    } catch {
      setBeschikbaar(false);
    }
  };
  useEffect(() => { void laad(); }, []);

  const zetStatus = async (groep: FoutGroep, status: FoutStatus) => {
    setBezig(groep.fingerprint);
    try {
      await apiJson('/api/client-errors/status', { method: 'POST', body: JSON.stringify({ fingerprint: groep.fingerprint, status, release: RELEASE }) });
      notify(status === 'opgelost' ? 'Gemarkeerd als opgelost, komt hij in een nieuwere release terug, dan heropent hij vanzelf.' : status === 'genegeerd' ? 'Genegeerd, blijft ook uit de weekmail.' : 'Heropend.', 'success');
      await laad();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Status opslaan is mislukt.', 'error');
    } finally {
      setBezig(null);
    }
  };

  const groepen = data?.groepen ?? [];
  const openGroepen = groepen.filter((g) => g.status === 'open').length;

  return (
    <Card padding="lg">
      <CardHeader
        icon={<Bug size={16} />}
        title="Fouten"
        description="Gegroepeerd per oorzaak: dezelfde fout met andere getallen of id's is één rij."
        aside={(
          <>
            {groepen.length > 0 && <Badge tone={openGroepen > 0 ? 'amber' : 'emerald'} stil>{openGroepen} open</Badge>}
            <InfoTip label="Uitleg bij fouten" align="right">
              <p>Fouten die bij gebruikers in de browser optraden (crashes én fout-toasts) worden automatisch gerapporteerd, met release, scherm en de laatste tien stappen ervoor.</p>
              <p className="mt-2"><strong>Opgelost</strong> onthoudt de release; komt de fout in een nieuwere release terug, dan staat hij vanzelf weer open. <strong>Negeren</strong> haalt hem ook uit de weekmail.</p>
            </InfoTip>
          </>
        )}
      />
      <div className="mt-4 min-w-0">
        {!beschikbaar || (data === null && plat === null) ? (
          <p className="text-sm font-medium text-slate-500">Niet beschikbaar.</p>
        ) : plat !== null ? (
          plat.length === 0 ? (
            <p className="text-sm font-medium text-emerald-700">Geen fouten gerapporteerd.</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {plat.slice(0, 25).map((e) => (
                <Card key={e.id} tone="muted" padding="sm" className="rounded-xl">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone="red" dot>{e.source || 'onbekend'}</Badge>
                    <span className="shrink-0 font-mono text-2xs text-slate-500 tabular-nums">{new Date(e.createdAt).toLocaleString('nl-BE')}</span>
                  </div>
                  <p className="mt-1.5 break-words text-xs font-medium text-slate-700">{e.message}</p>
                </Card>
              ))}
            </div>
          )
        ) : groepen.length === 0 ? (
          <p className="text-sm font-medium text-emerald-700">Geen fouten gerapporteerd.</p>
        ) : (
          <>
            {!data?.statusBeschikbaar && (
              <p className="mb-3 text-xs font-medium leading-relaxed text-slate-500">
                Statussen bewaren vraagt de migratie <Chip>supabase/2026-09-06_client_errors_groepen.sql</Chip>; tot dan staat alles op Open.
              </p>
            )}
            <TableShell>
              <table className="w-full min-w-[46rem]">
                <thead className="[&_th]:border-b [&_th]:border-slate-200">
                  <tr>
                    <Th className="w-8" />
                    <Th>Fout</Th>
                    <Th className="text-right">Aantal</Th>
                    <Th>Laatste</Th>
                    <Th>Releases</Th>
                    <Th>Status</Th>
                    <Th className="w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {groepen.map((g) => {
                    const uit = open === g.fingerprint;
                    return (
                      <FoutRijen key={g.fingerprint} groep={g} uit={uit} onToggle={() => setOpen(uit ? null : g.fingerprint)} bezig={bezig === g.fingerprint} statusBeschikbaar={Boolean(data?.statusBeschikbaar)} onStatus={(st) => { void zetStatus(g, st); }} />
                    );
                  })}
                </tbody>
              </table>
            </TableShell>
          </>
        )}
      </div>
    </Card>
  );
}

function FoutRijen({ groep: g, uit, onToggle, bezig, statusBeschikbaar, onStatus }: {
  groep: FoutGroep;
  uit: boolean;
  onToggle: () => void;
  bezig: boolean;
  statusBeschikbaar: boolean;
  onStatus: (status: FoutStatus) => void;
}) {
  const items = [
    ...(g.status !== 'opgelost' ? [{ label: 'Opgelost', icon: <CheckCircle2 size={16} />, onClick: () => onStatus('opgelost') }] : []),
    ...(g.status !== 'genegeerd' ? [{ label: 'Negeren', icon: <EyeOff size={16} />, onClick: () => onStatus('genegeerd') }] : []),
    ...(g.status !== 'open' ? [{ label: 'Heropenen', icon: <RotateCcw size={16} />, onClick: () => onStatus('open') }] : []),
  ].map((it) => ({ ...it, disabled: bezig }));
  return (
    <>
      <tr className={cn('align-top transition-colors hover:bg-surface-row-hover', g.status === 'genegeerd' && 'opacity-60')}>
        <Td className="pr-0">
          <IconButton label={uit ? 'Details verbergen' : 'Details tonen'} variant="ghost" size="sm" aria-expanded={uit} onClick={onToggle}>
            {uit ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </IconButton>
        </Td>
        <Td className="min-w-0 max-w-md">
          <p className="break-words text-sm font-medium text-slate-800">{g.message}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-2xs text-slate-500">
            <Chip mono={false}>{BRON_LABEL[g.source] ?? g.source}</Chip>
            {g.topFrame ? <span className="[overflow-wrap:anywhere]">{g.topFrame}</span> : <span>geen bronregel</span>}
          </p>
        </Td>
        <Td className="text-right">
          <Badge tone="slate" stil className="tabular-nums" title={`${g.gebruikers} ${g.gebruikers === 1 ? 'gebruiker' : 'gebruikers'}`}>{g.aantal}×</Badge>
        </Td>
        <Td className="whitespace-nowrap text-slate-600"><span title={formatDateTimeHuman(g.laatste)}>{formatRelatief(g.laatste)}</span></Td>
        <Td>
          <span className="flex flex-wrap gap-1">
            {g.releases.length === 0 ? <span className="text-xs text-slate-500">—</span> : g.releases.slice(0, 3).map((r) => <Chip key={r}>{r}</Chip>)}
            {g.releases.length > 3 && <Chip mono={false}>+{g.releases.length - 3}</Chip>}
          </span>
        </Td>
        <Td><StatusBadge groep={g} /></Td>
        <Td className="text-right">
          {statusBeschikbaar && items.length > 0 && <ActieMenu label="Status wijzigen" size="sm" items={items} />}
        </Td>
      </tr>
      {uit && (
        <tr className="bg-slate-50/60">
          <td colSpan={7} className="px-4 py-4">
            <FoutDetail groep={g} />
          </td>
        </tr>
      )}
    </>
  );
}

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
        notify('Dit lijkt geen geldig VHB-back-upbestand (geen “collections”).', 'error');
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
      notify('Kon het bestand niet lezen, is het een geldig JSON-back-upbestand?', 'error');
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
      notify('Geen diensten beschikbaar, voeg eerst een dienst toe via Beheer dienstoverzicht.', 'error');
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
            {/* Eén knop in de kop; de schrijftest zit in het "…"-menu ernaast
                (afwerking 04-09, nr. 7). */}
            <ActieMenu
              label="Meer acties"
              align="left"
              items={[
                { label: isTesting ? 'Testen…' : 'Test schrijven', icon: <FlaskConical size={16} />, disabled: isTesting, onClick: () => { void testWrite(); } },
              ]}
            />
            <Button variant="primary" icon={<RefreshCw size={16} className={isCheckingHealth ? 'animate-spin' : ''} />} onClick={checkHealth} disabled={isCheckingHealth}>
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
              <Badge tone="emerald" stil>{swVersion}</Badge>
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
                  <Badge tone={healthData.supabase === 'configured' ? 'emerald' : 'red'} dot stil={healthData.supabase === 'configured'}>
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
                    Zonder SMTP_USER/SMTP_PASS worden mails alleen gelogd, niet verstuurd, verlofbeslissingen en updates komen dan nergens aan. Een testmail is de enige echte bevestiging dat de SMTP-gegevens kloppen.
                  </InfoTip>
                )}
              />
              <div className="mt-4 space-y-3">
                <StatusRij label="SMTP">
                  <Badge tone={healthData.smtp?.status === 'configured' ? 'emerald' : 'red'} dot stil={healthData.smtp?.status === 'configured'}>
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
                      <Badge tone={status === 'OK' ? 'emerald' : 'red'} dot stil={status === 'OK'}>
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
          description="Alle gegevens als één JSON-bestand, je herstelpad als er iets misgaat."
          aside={(
            <InfoTip label="Wat zit er in de back-up?" align="right">
              <p>Gebruikers, planning, diensten, omleidingen, updates, verlof, dienstruilen, planningscodes en de audit-log. Bewaar het bestand op een veilige plek.</p>
              <p className="mt-2">De PDF-bestanden van omleidingen zitten er niet in; die staan apart in Supabase Storage.</p>
            </InfoTip>
          )}
        />
        <div className="mt-4">
          <Button variant="secondary" onClick={downloadBackup} disabled={isExporting} icon={<DownloadCloud size={16} />}>
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
                <p>Zet planning, gebruikers, verlof, dienstruilen en de andere collecties terug naar de inhoud van het bestand, gebruik dit enkel om een verlies te herstellen.</p>
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

      <FoutenSectie />

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
          <Button variant="secondary" icon={<Plus size={16} />} onClick={addTestShift}>
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
            ? `Je staat op het punt de huidige gegevens te overschrijven met de back-up${pendingRestore.exportedAt ? ` van ${new Date(pendingRestore.exportedAt).toLocaleString('nl-BE')}` : ''}. Dit wordt teruggezet: ${restorePreview.map((p) => `${p.label} (${p.count})`).join(' · ')}. Deze actie kan niet ongedaan gemaakt worden, maak desgewenst eerst een verse back-up.`
            : ''
        }
      />
    </PageShell>
  );
}
