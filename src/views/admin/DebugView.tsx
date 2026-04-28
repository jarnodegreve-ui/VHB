import React, { useEffect, useState } from 'react';
import { Activity, FlaskConical } from 'lucide-react';
import type { Service, Shift, User } from '../../types';
import { cn, getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { PageHeader, PageShell } from '../../components/ui';

const TEST_SHIFT_ID_PREFIX = 'test-shift-';

export function DebugView({ currentUser, shifts, services, onSaveShifts }: { currentUser: User; shifts: Shift[]; services: Service[]; onSaveShifts: (s: Shift[]) => void | Promise<void> }) {
  const [healthData, setHealthData] = useState<any>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const checkHealth = async () => {
    try {
      setIsCheckingHealth(true);
      const response = await fetch('/api/health');
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

      const testResponse = await fetch('/api/test', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ test: true }),
      });

      if (!testResponse.ok) {
        setTestResult(`Algemene POST test mislukt (${testResponse.status}). Dit duidt op een server/Vercel configuratie probleem.`);
        return;
      }

      const response = await fetch('/api/users', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify([
          {
            id: 'test-' + Date.now(),
            name: 'Test Gebruiker',
            role: 'chauffeur',
            employeeId: 'TEST-000',
            email: `test-${Date.now()}@example.com`,
            password: 'Test1234!',
            isActive: false,
          },
        ]),
      });

      const text = await response.text();
      if (response.ok) {
        setTestResult('Succes! Schrijven naar database werkt.');
      } else {
        setTestResult(`Fout (${response.status}): ${text}`);
      }
    } catch (error: any) {
      setTestResult(`Fout: ${error.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const myTestShifts = shifts.filter((s) => s.driverId === currentUser.id && (s.id.startsWith(TEST_SHIFT_ID_PREFIX) || s.line === 'TEST-DEMO'));

  const addTestShift = async () => {
    if (services.length === 0) {
      notify('Geen diensten beschikbaar — voeg eerst een dienst toe via Beheer Dienstoverzicht.', 'error');
      return;
    }
    const sample = services[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
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
    const remaining = shifts.filter((s) => !(s.driverId === currentUser.id && (s.id.startsWith(TEST_SHIFT_ID_PREFIX) || s.line === 'TEST-DEMO')));
    await onSaveShifts(remaining);
    notify(`${myTestShifts.length} fictieve dienst${myTestShifts.length === 1 ? '' : 'en'} verwijderd.`, 'success');
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Systeem"
        title="Systeem Status (Debug)"
        actions={(
          <div className="flex items-center gap-3">
            <button
              onClick={testWrite}
              disabled={isTesting}
              className="btn-primary ios-pressable px-4 py-2 text-sm"
            >
              {isTesting ? 'Testen...' : 'Test Schrijven'}
            </button>
            <button
              onClick={checkHealth}
              disabled={isCheckingHealth}
              className="px-4 py-2 bg-slate-100 rounded-xl text-slate-600 font-bold text-sm hover:bg-slate-200 disabled:opacity-50"
            >
              {isCheckingHealth ? 'Controleren...' : 'Ververs Status'}
            </button>
          </div>
        )}
      />

      {testResult && (
        <div
          className={cn(
            'p-4 rounded-2xl text-sm font-bold',
            testResult.startsWith('Succes')
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
              : 'bg-red-50 text-red-700 border border-red-100'
          )}
        >
          {testResult}
        </div>
      )}

      {healthData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="surface-card p-6 rounded-[32px]">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Supabase Status</h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-slate-600">Configuratie:</span>
                  <span className={cn('px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest', healthData.supabase === 'configured' ? 'bg-emerald-50 text-emerald-500' : 'bg-red-50 text-red-500')}>
                    {healthData.supabase}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-slate-600">Omgeving:</span>
                  <span className="text-sm font-black text-slate-800">{healthData.env}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-slate-600">Server Tijd:</span>
                  <span className="text-xs font-mono text-slate-500">{new Date(healthData.time).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="surface-card p-6 rounded-[32px]">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Tabel Status</h4>
              <div className="space-y-3">
                {Object.entries(healthData.tables || {}).map(([name, status]: [string, any]) => (
                  <div key={name} className="flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-slate-600 capitalize">{name}:</span>
                      <span className={cn('px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest', status === 'OK' ? 'bg-emerald-50 text-emerald-500' : 'bg-red-50 text-red-500')}>
                        {status === 'OK' ? 'OK' : 'ERROR'}
                      </span>
                    </div>
                    {status !== 'OK' && <p className="text-[10px] text-red-400 font-mono break-all bg-red-50 p-2 rounded-lg mt-1">{status}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-slate-900 p-6 rounded-[32px] text-slate-300 font-mono text-xs overflow-auto max-h-64">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Raw Health Data</h4>
            <pre>{JSON.stringify(healthData, null, 2)}</pre>
          </div>
        </div>
      )}

      <div className="surface-card p-8 rounded-[28px]">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-violet-500 text-white rounded-2xl shadow-lg shadow-violet-500/20">
            <FlaskConical size={24} />
          </div>
          <div className="flex-1">
            <h4 className="text-slate-900 font-black text-lg mb-2">Test-omgeving</h4>
            <p className="text-slate-600 text-sm leading-relaxed font-medium mb-4">
              Maak een fictieve dienst aan op je eigen account om de chauffeur-flows (rooster, dienstruil, ...) te testen zonder een test-account aan te maken. Het dienstnummer en de tijden worden overgenomen van een bestaande dienst zodat het realistisch oogt. Busnummer <code className="bg-slate-100 px-1 rounded font-black">TEST</code> markeert het als test-data; cleanup-knop verwijdert ze allemaal in één keer.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={addTestShift}
                className="btn-primary ios-pressable px-4 py-2 text-sm"
              >
                + Maak fictieve dienst voor mezelf
              </button>
              <button
                onClick={clearTestShifts}
                disabled={myTestShifts.length === 0}
                className="px-4 py-2 bg-slate-100 rounded-xl text-slate-600 font-bold text-sm hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Verwijder mijn fictieve diensten ({myTestShifts.length})
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-oker-50 p-8 rounded-[28px] border border-oker-100">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-oker-500 text-white rounded-2xl shadow-lg shadow-oker-500/20">
            <Activity size={24} />
          </div>
          <div>
            <h4 className="text-oker-900 font-black text-lg mb-2">Hulp bij problemen</h4>
            <p className="text-oker-800 text-sm leading-relaxed font-medium">
              Als de tabellen hierboven "Error" of "Exception" aangeven, betekent dit dat de tabel waarschijnlijk nog niet bestaat in Supabase of dat de rechten niet goed staan.
              Zorg ervoor dat je de tabellen <code className="bg-oker-100 px-1 rounded font-black">users</code>, <code className="bg-oker-100 px-1 rounded font-black">planning</code>, <code className="bg-oker-100 px-1 rounded font-black">diversions</code> en <code className="bg-oker-100 px-1 rounded font-black">services</code> hebt aangemaakt in je Supabase project.
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
