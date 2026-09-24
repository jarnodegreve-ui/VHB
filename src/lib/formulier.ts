import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { valideer, veldfoutenUitAntwoord } from './valideer';

/**
 * Formulierhooks (tranche 3A, 22-09-2026): één manier om veldfouten te
 * beheren en om te weten of een formulier "vuil" is.
 *
 *   const fouten = useVeldfouten();
 *   const verstuur = async () => {
 *     const data = fouten.controleer(schema, waarden);   // null bij fouten, die staan dan per veld
 *     if (!data) return;
 *     const res = await apiFetch(...);
 *     if (res.status === 400 && fouten.vanServer(await res.json())) return;
 *     ...
 *   };
 *   <Field label="Naam" error={fouten.fouten.naam}>…</Field>
 *
 * De hooks zijn bewust klein: geen form-state-bibliotheek, de views houden
 * hun eigen useState per veld zoals ze dat nu doen.
 */

export type Veldfouten = Record<string, string>;

export function useVeldfouten() {
  const [fouten, zet] = useState<Veldfouten>({});
  const wis = useCallback(() => zet((f) => (Object.keys(f).length === 0 ? f : {})), []);
  /** Wist één veld, bv. zodra de gebruiker het corrigeert. */
  const wisVeld = useCallback((veld: string) => {
    zet((f) => {
      if (!(veld in f)) return f;
      const n = { ...f };
      delete n[veld];
      return n;
    });
  }, []);
  /** Valideert met het gedeelde zod-schema; bij fouten staan ze per veld en
   *  komt er null terug, anders de geparste data. */
  const controleer = useCallback(<S extends z.ZodType>(schema: S, waarden: unknown): z.output<S> | null => {
    const r = valideer(schema, waarden);
    if (r.ok) {
      zet((f) => (Object.keys(f).length === 0 ? f : {}));
      return r.data;
    }
    zet(r.fouten);
    return null;
  }, []);
  /** Veldfouten uit een 400-antwoord naar de velden; true als er waren. */
  const vanServer = useCallback((data: unknown): boolean => {
    const f = veldfoutenUitAntwoord(data);
    if (f) zet(f);
    return f !== null;
  }, []);
  return { fouten, zet, wis, wisVeld, controleer, vanServer, heeftFouten: Object.keys(fouten).length > 0 };
}

const serialiseer = (waarden: unknown): string => {
  try {
    return JSON.stringify(waarden) ?? '';
  } catch {
    return String(waarden);
  }
};

/**
 * Is het formulier gewijzigd sinds het opende? Neemt een momentopname zodra
 * `actief` waar wordt (de modal opent) of `sleutel` verandert (ander record),
 * en vergelijkt daarna de geserialiseerde `waarden`. Formulieren die hun
 * waarden pas ná het openen laden, roepen `markeerSchoon()` aan zodra dat
 * klaar is; een geslaagde save doet hetzelfde vóór hij sluit.
 *
 *   const { vuil, markeerSchoon } = useVuil({ naam, email }, open);
 *   <Modal open={open} onClose={sluit} vuil={vuil}>
 */
export function useVuil(waarden: unknown, actief = true, sleutel: unknown = undefined) {
  const huidig = serialiseer(waarden);
  // De momentopname wordt in de render zelf genomen, niet in een effect
  // (polish P2a, 24-09): met een effect stond een net geopend formulier één
  // render lang als "vuil" op het scherm, en een terugknop in dat venster
  // vroeg "Wijzigingen niet bewaren?" zonder dat er iets gewijzigd was.
  const [staat, setStaat] = useState({ basis: huidig, actief, sleutel });
  let basis = staat.basis;
  if (actief !== staat.actief || sleutel !== staat.sleutel) {
    const gewisseld = (actief && !staat.actief) || (actief && sleutel !== staat.sleutel);
    if (gewisseld) basis = huidig;
    setStaat({ basis, actief, sleutel });
  }
  const markeerSchoon = useCallback(() => {
    const nu = serialiseer(waarden);
    setStaat((s) => ({ ...s, basis: nu }));
  }, [waarden]);
  return { vuil: actief && huidig !== basis, markeerSchoon };
}

/** Browser-waarschuwing bij tabblad sluiten of herladen zolang er
 *  onbewaarde invoer staat. De tekst bepaalt de browser zelf. */
export function useVerlaatWaarschuwing(vuil: boolean) {
  useEffect(() => {
    if (!vuil) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chromium wil nog een returnValue; de tekst zelf wordt niet getoond.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [vuil]);
}
