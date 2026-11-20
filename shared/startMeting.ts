export const START_FASEN = ['js', 'sessie', 'profiel', 'gegevens', 'beeld'] as const;
export type StartFase = typeof START_FASEN[number];
export const START_RELEASE = /^[0-9a-f]{7,12}$/;

export type StartMeting = Partial<Record<StartFase, number>> & {
  rol?: string;
  scherm?: 'dashboard' | 'mijn-dag' | 'ander';
  bron?: 'cache' | 'vers';
  toestel?: 'ios' | 'android' | 'desktop';
  weergave?: 'app' | 'browser';
  release?: string;
  vroeg?: true;
};

function uitLijst<T extends string>(waarde: unknown, lijst: readonly T[]): T | undefined {
  return typeof waarde === 'string' && lijst.includes(waarde as T) ? waarde as T : undefined;
}

function geldigeMs(waarde: unknown): waarde is number {
  return typeof waarde === 'number' && Number.isInteger(waarde) && waarde >= 0 && waarde <= 120_000;
}

/** Browseropslag en aanvraagbody zijn allebei onbetrouwbaar. Neem alleen
 *  toegestane meetwaarden over, nooit extra velden of vrije tekst. */
export function schoneStartMeting(waarde: unknown): StartMeting | undefined {
  if (!waarde || typeof waarde !== 'object' || Array.isArray(waarde) || Object.keys(waarde).length > 20) return;
  const m = waarde as Record<string, unknown>;
  const rol = uitLijst(m.rol, ['chauffeur', 'technieker', 'planner', 'admin']);
  const scherm = uitLijst(m.scherm, ['dashboard', 'mijn-dag', 'ander']);
  if (!rol || !scherm || !geldigeMs(m.gegevens)) return;

  const schoon: StartMeting = {
    rol, scherm,
    bron: uitLijst(m.bron, ['cache', 'vers']),
    toestel: uitLijst(m.toestel, ['ios', 'android', 'desktop']),
    weergave: uitLijst(m.weergave, ['app', 'browser']),
    vroeg: m.vroeg === true ? true : undefined,
    release: typeof m.release === 'string' && START_RELEASE.test(m.release) ? m.release : undefined,
  };
  for (const fase of START_FASEN) {
    const ms = m[fase];
    if (geldigeMs(ms)) schoon[fase] = ms;
  }
  return schoon;
}
