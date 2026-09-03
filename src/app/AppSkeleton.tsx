import { useEffect, useState } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { Skeleton } from '../components/Skeleton';
import { ViewLoader } from '../components/ui';

/**
 * Skeleton-schil voor de eerste seconden ná een warme start: er is een
 * opgeslagen sessie, dus we weten dat de app zo komt — toon dan meteen de
 * zijbalk, topbar en het scherm-skelet in plaats van een laadscherm
 * (verbeterronde laadscherm 03-09, nr. 3). Het thema staat al goed (boot-
 * script in index.html). Na 8 s zonder resultaat: een rustige uitweg.
 */
export function AppSkeleton() {
  const [lang, setLang] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLang(true), 8000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="flex h-dvh w-full overflow-hidden" aria-busy="true" aria-label="Portaal wordt geladen">
      <aside className="hidden lg:flex w-[17.5rem] shrink-0 flex-col panel-dark" aria-hidden="true">
        <div className="px-5 pt-4 pb-3 flex justify-center">
          <BrandLogo tone="licht" naamregelSchaal={1.2} naamregelAfstand={70} laden className="w-36 h-auto select-none block dark:hidden" />
          <BrandLogo tone="donker" naamregelSchaal={1.2} naamregelAfstand={70} laden className="w-36 h-auto select-none hidden dark:block" />
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
        <header className="topbar px-4 md:px-7">
          <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between py-2.5 min-h-12">
            <span className="lg:hidden"><BrandLogo tone="licht" variant="beeldmerk" laden className="h-6 w-auto select-none block dark:hidden" /><BrandLogo tone="donker" variant="beeldmerk" laden className="h-6 w-auto select-none hidden dark:block" /></span>
            <span className="hidden lg:block" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8" rounded="lg" />
              <Skeleton className="h-8 w-8" rounded="full" />
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-hidden px-4 md:px-7 pt-5">
          <div className="mx-auto w-full max-w-[1200px]">
            <ViewLoader />
            {lang && (
              <p className="mt-6 text-center text-xs font-medium text-slate-500">
                Dit duurt langer dan normaal —{' '}
                {/* rauw: tekstlink in het skelet. */}
                <button type="button" className="underline underline-offset-2 hover:text-slate-800" onClick={() => window.location.reload()}>vernieuw de pagina</button>.
              </p>
            )}
          </div>
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
