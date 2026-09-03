import type express from "express";
import type { z } from "zod";
import { leesbareVeldfout, valideer } from "../../shared/schemas/basis.js";

/**
 * Request-body's valideren met de gedeelde zod-schemas (shared/schemas/*).
 * Bij fouten gaat er één 400 terug in een vaste vorm:
 *
 *   { error: 'Ongeldige invoer', details: '<leesbare eerste fout>', veldfouten: { veld: tekst } }
 *
 * `veldfouten` landt in de client bij het veld (src/lib/valideer.ts →
 * Field error); `details` is de terugval voor toasts en bestaande callers.
 * Bij lijsten zijn de sleutels '<index>.<veld>' en noemt `details` de rij.
 */

export const ongeldigeInvoer = (res: express.Response, veldfouten: Record<string, string>, details: string) =>
  res.status(400).json({ error: "Ongeldige invoer", details, veldfouten });

const eersteFout = (veldfouten: Record<string, string>): [string, string] =>
  Object.entries(veldfouten)[0] ?? ["_", "Ongeldige invoer"];

/** Eén record. Geeft de gevalideerde data, of null nadat de 400 al verstuurd is. */
export const valideerRecord = <S extends z.ZodType>(res: express.Response, schema: S, body: unknown): z.output<S> | null => {
  const uitkomst = valideer(schema, body);
  if (uitkomst.ok === true) return uitkomst.data;
  const [veld, tekst] = eersteFout(uitkomst.fouten);
  ongeldigeInvoer(res, uitkomst.fouten, leesbareVeldfout(veld, tekst));
  return null;
};

/** Een lijst records (collectie-POST). `naamVan` maakt de details leesbaar:
 *  'Rij 4 (Jan Janssen): e-mailadres: Vul een geldig e-mailadres in'. */
export const valideerLijst = <S extends z.ZodType>(
  res: express.Response,
  schema: S,
  lijst: unknown[],
  naamVan?: (record: unknown) => string | undefined,
): z.output<S> | null => {
  const uitkomst = valideer(schema, lijst);
  if (uitkomst.ok === true) return uitkomst.data;
  const [veld, tekst] = eersteFout(uitkomst.fouten);
  const [index, ...rest] = veld.split(".");
  const rij = Number(index);
  const naam = Number.isInteger(rij) ? naamVan?.(lijst[rij]) : undefined;
  const details = Number.isInteger(rij)
    ? `Rij ${rij + 1}${naam ? ` (${naam})` : ""}: ${leesbareVeldfout(rest.join(".") || "_", tekst)}`
    : leesbareVeldfout(veld, tekst);
  ongeldigeInvoer(res, uitkomst.fouten, details);
  return null;
};
