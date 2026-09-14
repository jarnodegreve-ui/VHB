import { useEffect, useState } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { Skeleton } from '../components/Skeleton';
import { DashboardSkelet, ViewLoader } from '../components/ui';
import { cn } from '../lib/ui';
import { routeUitUrl } from './router';
import { isBreed, sectieLabel } from './routes';

/**
 * Skeleton-schil voor de eerste seconden ná een warme start: er is een
 * opgeslagen sessie, dus we weten dat de app zo komt — toon dan meteen de
 * zijbalk, topbar en het scherm-skelet in plaats van een laadscherm
 * (verbeterronde laadscherm 03-09, nr. 3). Het thema staat al goed (boot-
 * script in index.html). Na 8 s zonder resultaat: een rustige uitweg.
 *
 * Layout-getrouw (next-level 2, punt 7): de schil leest de startroute uit de
 * URL (die is al genormaliseerd door useRoute) en spiegelt de echte schil
 * element voor element: beeldmerk in de mobiele topbar, sectiewoord op
 * desktop, dezelfde kolombreedte (`breed`), dezelfde rijhoogte via
 * --topbar-h, het dashboardraster op `/` en de dock op smal scherm. Bij het
 * omwisselen naar de echte app verschuift er zo niets.
 */
export function AppSkeleton() {
  const [lang, setLang] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLang(true), 8000);
    return () => window.clearTimeout(t);
  }, []);
  const view = (typeof window !== 'undefined' && routeUitUrl(window.location.href)?.view) || 'dashboard';
  const kolomClass = isBreed(view) ? 'max-w-[var(--content-max-breed)]' : 'max-w-[var(--content-max)]';
  const sectie = sectieLabel(view);
  return (
    <div className="flex h-dvh w-full overflow-hidden" aria-busy="true" aria-label="Portaal wordt geladen">
      <aside className="hidden lg:flex w-[17.5rem] shrink-0 flex-col panel-dark" aria-hidden="true">
        <div className="px-5 pt-4 pb-3 flex justify-center">
          <BrandLogo tone="licht" laden className="w-40 lg:w-44 h-auto select-none block dark:hidden" />
          <BrandLogo tone="donker" laden className="w-40 lg:w-44 h-auto select-none hidden dark:block" />
        </div>
        <div className="px-4 pt-3 space-y-3">
          {['w-24', 'w-20', 'w-28', 'w-24', 'w-32', 'w-20', 'w-24', 'w-28', 'w-32'].map((w, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-1">
              <Skeleton className="h-4 w-4" rounded="md" />
              <Skeleton className={`h-3 ${w}`} />
            </div>
          ))}
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="statusbalk-strook" aria-hidden="true" />
        <header className="topbar px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] md:px-7">
          {/* Zelfde rij als App.tsx: py-2.5 + min-h op --topbar-h (min de haarlijn). */}
          <div className={cn('mx-auto flex w-full items-center justify-between gap-3 py-2.5 min-h-[calc(var(--topbar-h)-1px)]', kolomClass)}>
            <div className="flex items-center gap-2 min-w-0">
              {/* Menuknop (alleen md): zelfde slot als de IconButton sm in de echte topbar. */}
              <span className="hidden md:inline-flex lg:hidden -ml-1"><Skeleton rounded="lg" className="h-11 w-11 sm:pointer-fine:h-8 sm:pointer-fine:w-8" /></span>
              <span className="lg:hidden inline-flex shrink-0 items-center">
                <BrandLogo tone="licht" variant="beeldmerk" laden className="h-6 w-auto select-none block dark:hidden" />
                <BrandLogo tone="donker" variant="beeldmerk" laden className="h-6 w-auto select-none hidden dark:block" />
              </span>
              {sectie && <span className="hidden lg:inline text-micro shrink-0 whitespace-nowrap">{sectie}</span>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Bel (IconButton sm) en de avatar-trigger van het accountmenu (py-1 + h-8 + pijltje). */}
              <Skeleton rounded="lg" className="h-11 w-11 sm:pointer-fine:h-8 sm:pointer-fine:w-8" />
              <span className="flex items-center gap-1 py-1 pl-1 pr-1.5">
                <Skeleton rounded="full" className="h-8 w-8" />
                <Skeleton className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-hidden px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] md:px-7 pt-5">
          <div className={cn('mx-auto w-full', kolomClass)}>
            {view === 'dashboard' ? <DashboardSkelet /> : <ViewLoader />}
            {lang && (
              <p className="mt-6 text-center text-xs font-medium text-slate-500">
                Dit duurt langer dan normaal,{' '}
                {/* rauw: tekstlink in het skelet. */}
                <button type="button" className="underline underline-offset-2 hover:text-slate-800" onClick={() => window.location.reload()}>vernieuw de pagina</button>.
              </p>
            )}
          </div>
        </div>
        {/* Dock-skelet: zelfde doos als BottomNav (md:hidden, zwevend op
            max(0.75rem, safe-area), px-1.5 py-2, tabs van min-h-11). */}
        <div
          aria-hidden="true"
          className="md:hidden fixed left-[max(0.5rem,env(safe-area-inset-left))] right-[max(0.5rem,env(safe-area-inset-right))] z-40 rounded-2xl px-1.5 py-2 bottom-dock"
          style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <ul className="flex items-center justify-around">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex-auto min-w-0">
                <div className="flex w-full min-h-11 flex-col items-center justify-center gap-0.5 py-1">
                  <Skeleton className="h-4.5 w-4.5" />
                  <Skeleton className="mt-px h-2.5 w-8" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}

/** Is er een opgeslagen Supabase-sessie? Dan is de skeleton-schil de juiste
 *  eerste indruk; zonder sessie komt zo het inlogscherm (carbon). */
export function heeftOpgeslagenSessie(): boolean {
  try {
    return Object.keys(window.localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
  } catch {
    return false;
  }
}
