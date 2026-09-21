/**
 * Droge herstelrun (verbeterronde 4, punt 13): wat zou een herstel uit deze
 * back-up doen, zonder één rij te schrijven. De nachtelijke back-up werd al
 * teruggelezen en structureel gecontroleerd (`checkBackupIntegrity`), maar
 * niemand zag vooraf WAT een herstel overschrijft, en een back-up met dubbele
 * of ontbrekende id's kwam pas aan het licht halverwege een echt herstel, dat
 * niet transactioneel is.
 *
 * Puur: de aanroeper levert de back-up en de live stand in hetzelfde formaat
 * (`buildBackupPayload().collections`). Gebruikt door `POST /api/restore?droog=1`
 * (het beheerscherm toont het plan vóór de bevestiging) en door de maandelijkse
 * restore-proef.
 */
export const HERSTEL_LIJSTEN = [
  'users', 'planning', 'services', 'diversions', 'updates', 'planningCodes', 'leave', 'swaps', 'planningMatrixRows',
] as const;
export type HerstelLijst = (typeof HERSTEL_LIJSTEN)[number];
export type HerstelCollectie = HerstelLijst | 'coverageExpectations';

export type HerstelRegel = {
  collectie: HerstelCollectie;
  /** Staat de collectie in de back-up? Zo niet, dan blijft ze ongemoeid. */
  inBackup: boolean;
  /** Een lege matrix wordt niet teruggezet (de save weigert een lege set). */
  overgeslagen: boolean;
  backup: number;
  live: number;
  /** In de back-up, nu niet live: komt terug. */
  erbij: number;
  /** Nu live, niet in de back-up: verdwijnt. */
  weg: number;
  /** In beide: wordt overschreven met de versie uit de back-up. */
  blijft: number;
};

export type HerstelPlan = {
  exportedAt: string | null;
  regels: HerstelRegel[];
  /** Een herstel zou geweigerd worden of halverwege stranden. */
  blokkades: string[];
  /** Mag, maar lees dit eerst. */
  waarschuwingen: string[];
  totaalBackup: number;
};

/** Vanaf dit aandeel verdwijnende records volgt een waarschuwing. */
export const HERSTEL_VERLIES_DREMPEL = 0.5;
/** Een back-up ouder dan dit aantal dagen krijgt een waarschuwing. */
export const HERSTEL_OUD_DAGEN = 7;

const sleutelVan = (rij: unknown): string | null => {
  if (!rij || typeof rij !== 'object') return null;
  const id = (rij as Record<string, unknown>).id;
  if (id === undefined || id === null || String(id).trim() === '') return null;
  return String(id);
};

export function bouwHerstelPlan({ backup, live, exportedAt = null, actorId = null, nu = new Date() }: {
  backup: Record<string, unknown>;
  live: Record<string, unknown>;
  exportedAt?: string | null;
  /** De admin die het herstel start: zit hij zelf nog in de back-up? */
  actorId?: string | null;
  nu?: Date;
}): HerstelPlan {
  const regels: HerstelRegel[] = [];
  const blokkades: string[] = [];
  const waarschuwingen: string[] = [];

  for (const collectie of HERSTEL_LIJSTEN) {
    const bron = backup[collectie];
    const liveLijst = Array.isArray(live[collectie]) ? (live[collectie] as unknown[]) : [];
    const liveIds = new Set(liveLijst.map(sleutelVan).filter((id): id is string => id !== null));
    if (bron === undefined) {
      regels.push({ collectie, inBackup: false, overgeslagen: false, backup: 0, live: liveLijst.length, erbij: 0, weg: 0, blijft: 0 });
      continue;
    }
    if (!Array.isArray(bron)) {
      blokkades.push(`'${collectie}' is geen lijst`);
      regels.push({ collectie, inBackup: true, overgeslagen: true, backup: 0, live: liveLijst.length, erbij: 0, weg: 0, blijft: 0 });
      continue;
    }
    const ids = bron.map(sleutelVan);
    const zonderId = ids.filter((id) => id === null).length;
    if (zonderId > 0) blokkades.push(`'${collectie}': ${zonderId} ${zonderId === 1 ? 'record' : 'records'} zonder id`);
    const gezien = new Set<string>();
    const dubbel = new Set<string>();
    for (const id of ids) {
      if (id === null) continue;
      if (gezien.has(id)) dubbel.add(id);
      gezien.add(id);
    }
    if (dubbel.size > 0) {
      const voorbeeld = [...dubbel].slice(0, 3).join(', ');
      blokkades.push(`'${collectie}': ${dubbel.size} dubbele ${dubbel.size === 1 ? 'id' : 'id’s'} (${voorbeeld}${dubbel.size > 3 ? ', …' : ''})`);
    }
    const overgeslagen = collectie === 'planningMatrixRows' && bron.length === 0;
    const erbij = [...gezien].filter((id) => !liveIds.has(id)).length;
    const blijft = gezien.size - erbij;
    const weg = overgeslagen ? 0 : [...liveIds].filter((id) => !gezien.has(id)).length;
    regels.push({ collectie, inBackup: true, overgeslagen, backup: bron.length, live: liveLijst.length, erbij: overgeslagen ? 0 : erbij, weg, blijft: overgeslagen ? 0 : blijft });
    if (!overgeslagen && liveIds.size > 0 && weg / liveIds.size >= HERSTEL_VERLIES_DREMPEL) {
      waarschuwingen.push(`'${collectie}': ${weg} van de ${liveIds.size} huidige records verdwijnen`);
    }
  }

  // Dekkingsverwachting: een object per dag-type, geen lijst met id's.
  const dekking = backup.coverageExpectations;
  const liveDekking = live.coverageExpectations && typeof live.coverageExpectations === 'object' && !Array.isArray(live.coverageExpectations)
    ? Object.keys(live.coverageExpectations as object) : [];
  if (dekking === undefined) {
    regels.push({ collectie: 'coverageExpectations', inBackup: false, overgeslagen: false, backup: 0, live: liveDekking.length, erbij: 0, weg: 0, blijft: 0 });
  } else if (!dekking || typeof dekking !== 'object' || Array.isArray(dekking)) {
    blokkades.push("'coverageExpectations' is geen object");
    regels.push({ collectie: 'coverageExpectations', inBackup: true, overgeslagen: true, backup: 0, live: liveDekking.length, erbij: 0, weg: 0, blijft: 0 });
  } else {
    const sleutels = Object.keys(dekking as object);
    const erbij = sleutels.filter((k) => !liveDekking.includes(k)).length;
    regels.push({
      collectie: 'coverageExpectations', inBackup: true, overgeslagen: false, backup: sleutels.length, live: liveDekking.length,
      erbij, weg: liveDekking.filter((k) => !sleutels.includes(k)).length, blijft: sleutels.length - erbij,
    });
  }

  // Dezelfde vangrail als de route: zonder admin sluit je jezelf buiten.
  const users = Array.isArray(backup.users) ? (backup.users as Array<Record<string, unknown>>) : null;
  if (users) {
    if (users.length === 0) blokkades.push('de back-up bevat geen gebruikers');
    else if (!users.some((u) => u?.role === 'admin')) blokkades.push('de back-up bevat geen admin-account');
    if (actorId && users.length > 0 && !users.some((u) => sleutelVan(u) === String(actorId))) {
      waarschuwingen.push('jouw eigen account staat niet in deze back-up: na het herstel kan je niet meer aanmelden');
    }
  }

  const moment = exportedAt ? Date.parse(exportedAt) : NaN;
  if (Number.isFinite(moment)) {
    const dagen = Math.floor((nu.getTime() - moment) / 86400000);
    if (dagen > HERSTEL_OUD_DAGEN) waarschuwingen.push(`de back-up is ${dagen} dagen oud: alles van daarna gaat verloren`);
  } else {
    waarschuwingen.push('de back-up heeft geen geldige datum');
  }

  return {
    exportedAt: Number.isFinite(moment) ? new Date(moment).toISOString() : null,
    regels,
    blokkades,
    waarschuwingen,
    totaalBackup: regels.reduce((n, r) => n + (r.overgeslagen ? 0 : r.backup), 0),
  };
}
