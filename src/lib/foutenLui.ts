/**
 * Foutcopy voor de startbundel (tranche 3A, 23-09). De datalaag, App.tsx en
 * ongedaan.ts zitten in index-*.js; een statische import van src/lib/fouten.ts
 * duwde die bundel over zijn budget (74 kB, de loginsnelheid). Deze helper laadt
 * de teksten pas wanneer een schrijfactie echt mislukt; de schermen die
 * `meldSchrijffout` zelf gebruiken hebben de module dan meestal al geladen.
 * Lukt het laden niet (offline, nieuwe release), dan valt hij terug op een
 * korte zin met een vervolgstap, nooit op stilte.
 */
export function laatSchrijffout(actie: string, err: unknown, toon: (tekst: string) => void): void {
  void import('./fouten')
    .then((m) => toon(m.schrijffout(actie, err)))
    .catch(() => toon(`${actie} is mislukt. Controleer je verbinding en probeer het opnieuw.`));
}
