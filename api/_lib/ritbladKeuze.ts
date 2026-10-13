import { hoortBijVersie, oudsteVersie, versieVoorDatum, type VersieKern } from "../../shared/dienstregeling.js";

/**
 * Welke ritbladbundel hoort bij een dag (13-10, keuzes Jarno): de bundel van
 * de dienstregelingversie die op die dag geldt. Heeft die versie nog geen
 * bundel, dan blijft `bundel` leeg en wijst `vorige` naar de jongste eerdere
 * versie die er wél een heeft, zodat het scherm "nog geen ritbladen voor deze
 * dienstregeling" kan zeggen met een knop naar de vorige bundel. Zonder
 * versies (migratie van 08-10 niet gedraaid) is er één bundel, de rij zonder
 * versie. Zuiver: geen I/O.
 */
export type RitbladBundelKern = { dienstregelingId: string | null };

export type RitbladKeuze<V extends VersieKern, B extends RitbladBundelKern> = {
  versie: V | null;
  bundel: B | null;
  vorige: { versie: V; bundel: B } | null;
};

const bundelVanVersie = <V extends VersieKern, B extends RitbladBundelKern>(versie: V, bundels: readonly B[], oudsteId: string | null): B | null =>
  bundels.find((b) => hoortBijVersie(b, versie.id, oudsteId)) ?? null;

export function kiesRitblad<V extends VersieKern, B extends RitbladBundelKern>(versies: readonly V[], bundels: readonly B[], datum: string): RitbladKeuze<V, B> {
  if (versies.length === 0) return { versie: null, bundel: bundels.find((b) => !b.dienstregelingId) ?? bundels[0] ?? null, vorige: null };
  const oudsteId = oudsteVersie(versies)?.id ?? null;
  const versie = versieVoorDatum(versies, datum)!;
  const bundel = bundelVanVersie(versie, bundels, oudsteId);
  if (bundel) return { versie, bundel, vorige: null };
  const eerder = versies
    .filter((v) => v.geldigVanaf < versie.geldigVanaf)
    .sort((a, b) => b.geldigVanaf.localeCompare(a.geldigVanaf) || b.id.localeCompare(a.id));
  for (const v of eerder) {
    const b = bundelVanVersie(v, bundels, oudsteId);
    if (b) return { versie, bundel: null, vorige: { versie: v, bundel: b } };
  }
  return { versie, bundel: null, vorige: null };
}

/** Per versie (oudste eerst) haar bundel of null; zonder versies één regel zonder versie. */
export function bundelsPerVersie<V extends VersieKern, B extends RitbladBundelKern>(versies: readonly V[], bundels: readonly B[]): Array<{ versie: V | null; bundel: B | null }> {
  if (versies.length === 0) return [{ versie: null, bundel: bundels.find((b) => !b.dienstregelingId) ?? bundels[0] ?? null }];
  const oudsteId = oudsteVersie(versies)?.id ?? null;
  return [...versies]
    .sort((a, b) => a.geldigVanaf.localeCompare(b.geldigVanaf) || a.id.localeCompare(b.id))
    .map((versie) => ({ versie, bundel: bundelVanVersie(versie, bundels, oudsteId) }));
}
