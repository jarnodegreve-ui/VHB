/**
 * De logactie waarmee een verwijderde omleiding of update wordt vastgelegd.
 * recordWrites.ts schrijft de regel, de uitgestelde opruiming van de
 * bijlagen (bijlagenOpruim.ts) zoekt precies deze regels als bewijs dat een
 * record via het portaal verwijderd is. Eén constante, zodat schrijver en
 * lezer niet uit elkaar kunnen groeien. Bewust een module zonder imports:
 * recordWrites.ts mag er de opslaglaag niet extra door laden.
 */
export const VERWIJDERD_ACTIE = { diversion: "Omleiding verwijderd", update: "Update verwijderd" } as const;
