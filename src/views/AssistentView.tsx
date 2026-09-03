import { BrandSpinner } from '../components/BrandSpinner';
import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { cn } from '../lib/ui';
import { PageShell } from '../components/ui';
import { Button, MicroLabel } from '../components/primitives';
import { vraagAssistent, type AssistentBericht } from '../lib/assistent';

/**
 * Planner-assistent — chat over de actuele planning (planner/admin). De
 * assistent adviseert alleen; uitvoeren gebeurt via de bestaande schermen.
 * Gesprekken leven alleen in deze sessie: niets wordt bewaard.
 */

const SUGGESTIES = [
  'Welke diensten staan er de komende twee weken nog open?',
  'Wie is er dit weekend vrij?',
  'Wie is er volgende week afwezig?',
];

export function AssistentView() {
  const [berichten, setBerichten] = useState<AssistentBericht[]>([]);
  const [invoer, setInvoer] = useState('');
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const eindeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    eindeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [berichten, bezig]);

  const verstuur = async (tekst: string) => {
    const vraag = tekst.trim();
    if (!vraag || bezig) return;
    const historie: AssistentBericht[] = [...berichten, { role: 'user', content: vraag }];
    setBerichten(historie);
    setInvoer('');
    setFout('');
    setBezig(true);
    try {
      const res = await vraagAssistent(historie);
      setBerichten([...historie, { role: 'assistant', content: res.antwoord }]);
    } catch (e: any) {
      setFout(e?.message || 'De assistent kon je vraag niet beantwoorden — probeer het zo opnieuw.');
    } finally {
      setBezig(false);
    }
  };

  const nietGeactiveerd = fout.includes('geactiveerd');

  return (
    <PageShell>
      <div className="surface-card rounded-3xl flex flex-col overflow-hidden">
        {/* Gespreksvlak */}
        <div className="flex-1 min-h-[45dvh] max-h-[62dvh] overflow-y-auto p-5 space-y-3">
          {berichten.length === 0 && !fout ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-10">
              <div className="w-12 h-12 rounded-2xl bg-oker-50/70 ring-1 ring-oker-100 flex items-center justify-center text-oker-700">
                <Sparkles size={20} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Stel je planningsvraag</p>
                <p className="mt-1 text-xs font-medium text-slate-500 max-w-sm">
                  De assistent kijkt in de actuele planning, het verlof en het invaladvies — en adviseert alleen; toewijzen doe je zelf in het portaal.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void verstuur(s)}
                    className="ios-pressable rounded-xl bg-surface-field ring-1 ring-hairline px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:ring-slate-300 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {berichten.map((b, i) => (
                <div key={i} className={cn('flex', b.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm font-medium whitespace-pre-wrap leading-relaxed',
                      b.role === 'user'
                        ? 'bg-oker-50/70 ring-1 ring-oker-100 text-slate-800'
                        : 'bg-surface-field ring-1 ring-hairline text-slate-700',
                    )}
                  >
                    {b.role === 'assistant' && <MicroLabel className="text-oker-700 block mb-1">Assistent</MicroLabel>}
                    {b.content}
                  </div>
                </div>
              ))}
              {bezig && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-surface-field ring-1 ring-hairline px-4 py-2.5 flex items-center gap-2.5">
                    <BrandSpinner size={14} />
                    <span className="text-xs font-bold text-slate-500">De assistent zoekt het uit…</span>
                  </div>
                </div>
              )}
              {fout && (
                <div className={cn(
                  'rounded-2xl px-4 py-3 text-sm font-semibold',
                  nietGeactiveerd ? 'bg-amber-50/70 text-amber-800' : 'bg-red-50/80 text-red-700',
                )}>
                  {nietGeactiveerd
                    ? 'De assistent is nog niet geactiveerd: er staat nog geen ANTHROPIC_API_KEY in de Vercel-omgeving.'
                    : fout}
                </div>
              )}
            </>
          )}
          <div ref={eindeRef} />
        </div>

        {/* Invoer */}
        <form
          className="border-t border-slate-100 p-3 flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); void verstuur(invoer); }}
        >
          <input
            value={invoer}
            enterKeyHint="send"
            onChange={(e) => setInvoer(e.target.value)}
            placeholder="Bijv. wie kan zaterdag dienst 2603 rijden?"
            aria-label="Je vraag aan de planner-assistent"
            className="control-input flex-1 rounded-xl px-3.5 py-2.5 text-sm font-semibold outline-none"
            disabled={bezig}
          />
          <Button type="submit" variant="primary" size="md" className="shrink-0" disabled={bezig || !invoer.trim()} icon={<Send size={16} />}>
            Vraag
          </Button>
        </form>
      </div>

      <p className="text-2xs font-medium text-slate-400 px-1">
        De assistent baseert zich op de actuele planning maar kan fouten maken — controleer het advies vóór je toewijst. Gesprekken worden niet bewaard.
      </p>
    </PageShell>
  );
}
