import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { notify } from '../../lib/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, MicroLabel } from '../../components/primitives';

type OcpiStatus = {
  registered: boolean;
  ocpiVersion: string | null;
  cpoPartyId: string | null;
  cpoCountryCode: string | null;
  endpoints: Array<{ identifier: string; role: string | null }>;
  registeredAt: string | null;
  configured: boolean;
};

/**
 * Beheer-kaart voor de OCPI-koppeling (ChargEye). Toont of de omgeving
 * geconfigureerd is en of de credentials-handshake al gelukt is, met één knop
 * om (her)te registreren. Read-only monitoring; zie api/ocpi.ts.
 */
export function OcpiCard() {
  const [status, setStatus] = useState<OcpiStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const response = await apiFetch('/api/ocpi/status');
      if (!response.ok) throw new Error(String(response.status));
      setStatus(await response.json());
    } catch {
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const register = async () => {
    setIsRegistering(true);
    try {
      const response = await apiFetch('/api/ocpi/register', {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.details || data.error || `Registratie mislukt (${response.status}).`, 'error');
      } else {
        notify(`Geregistreerd bij ChargEye (OCPI ${data.version ?? '2.2.1'}, ${data.endpoints ?? 0} endpoints).`, 'success');
      }
    } catch {
      notify('Registratie mislukt — controleer de OCPI-instellingen en probeer opnieuw.', 'error');
    } finally {
      setIsRegistering(false);
      fetchStatus();
    }
  };

  const sync = async () => {
    setIsSyncing(true);
    try {
      const response = await apiFetch('/api/ocpi/sync', {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.details || data.error || `Sync mislukt (${response.status}).`, 'error');
      } else {
        const s = `${data.locations ?? 0} locaties · ${data.evses ?? 0} palen · ${data.sessions ?? 0} sessies`;
        setLastSync(s);
        if (data.errors?.length) notify(`Sync deels gelukt (${data.errors.length} fout(en)): ${s}`, 'error');
        else notify(`Sync klaar: ${s}`, 'success');
      }
    } catch {
      notify('Sync mislukt — probeer opnieuw.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="surface-card p-6 md:p-8 rounded-3xl">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-slate-500/12 text-slate-600 dark:text-slate-300 rounded-2xl">
          <Zap size={24} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-base font-bold text-slate-800">OCPI-koppeling (ChargEye)</h3>
              <p className="text-sm text-slate-500 mt-0.5">Read-only monitoring van de Kempower-laadpalen (eMSP, OCPI 2.2.1).</p>
            </div>
            <div className="flex items-center gap-2.5">
              {status?.registered && (
                <Button variant="secondary" onClick={sync} disabled={isSyncing}>
                  {isSyncing ? 'Synchroniseren…' : 'Nu synchroniseren'}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={register}
                disabled={isRegistering || (status ? !status.configured : false)}
              >
                {isRegistering ? 'Registreren…' : status?.registered ? 'Herregistreren' : 'Registreren'}
              </Button>
            </div>
          </div>
          {lastSync && (
            <p className="mt-2 text-2xs text-slate-500">Laatste sync: {lastSync}</p>
          )}

          <div className="mt-5 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-slate-600">Configuratie (env):</span>
              {isLoading ? (
                <span className="text-xs text-slate-400">laden…</span>
              ) : (
                <Badge tone={status?.configured ? 'emerald' : 'red'} dot>
                  {status?.configured ? 'compleet' : 'ontbreekt'}
                </Badge>
              )}
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-slate-600">Registratie:</span>
              {isLoading ? (
                <span className="text-xs text-slate-400">laden…</span>
              ) : (
                <Badge tone={status?.registered ? 'emerald' : 'red'} dot>
                  {status?.registered ? 'geregistreerd' : 'nog niet'}
                </Badge>
              )}
            </div>
            {status?.registered && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">CPO:</span>
                  <span className="text-sm font-semibold text-slate-800">
                    {status.cpoCountryCode ?? '?'}-{status.cpoPartyId ?? '?'} · OCPI {status.ocpiVersion ?? '?'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-600">Endpoints / sinds:</span>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {status.endpoints.length} · {status.registeredAt ? new Date(status.registeredAt).toLocaleString() : '—'}
                  </span>
                </div>
                {status.endpoints.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {status.endpoints.map((e) => (
                      <span key={`${e.identifier}:${e.role}`} className="text-2xs font-mono px-2 py-1 rounded-lg bg-surface-muted text-slate-600">
                        {e.identifier}{e.role ? `:${e.role.toLowerCase()}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {!isLoading && status && !status.configured && (
            <div className="mt-4">
              <MicroLabel className="mb-2 text-slate-500">Eerst instellen</MicroLabel>
              <p className="text-2xs text-slate-500 leading-relaxed">
                Draai <span className="font-mono">supabase/ocpi_registration.sql</span>, zet de <span className="font-mono">OCPI_*</span>-env-vars
                in Vercel (incl. Token A uit ChargEye) en redeploy. Daarna is deze knop actief.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
