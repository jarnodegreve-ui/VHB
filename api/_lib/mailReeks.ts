import { maakMailTransport, sendEmail, type MailTransport } from "../email.js";
import { logMail, rondMailLogAf, startMailLog } from "../storage.js";
import { mailReeksReden } from "../../shared/mailLog.js";

/**
 * Eén verzendfunctie voor een reeks mails naar losse ontvangers (nr. 5 en 34,
 * 29-09): "Mail versturen" in Beheer › Mails en de mailknop op een omleiding.
 * Vroeger stond dezelfde lus twee keer in mailRoutes.ts, met de logregel
 * erná: één mail tegelijk, per mail een nieuwe SMTP-verbinding, en brak de
 * functie af (60 s, vercel.json) dan was er geen logregel en stuurde
 * "Opnieuw proberen" alles opnieuw, dus dubbele mails.
 *
 * Nu:
 *  1. de logregel staat er VÓÓR de eerste mail, als "niet afgerond", en
 *     wordt na de reeks bijgewerkt. Een afgebroken verzending blijft zo
 *     zichtbaar in het verzendlog (shared/mailLog.ts);
 *  2. één hergebruikte verbinding (pool) en een paar mails tegelijk;
 *  3. een tijdsbudget ruim onder de 60 s: wat niet meer aan de beurt komt
 *     wordt niet geprobeerd en komt terug als "niet verstuurd", zodat het
 *     antwoord altijd vertrekt en het log altijd klopt;
 *  4. het antwoord noemt de adressen die niet vertrokken zijn, zodat het
 *     scherm ALLEEN die opnieuw kan versturen. Het log zelf bevat geen
 *     adressen, alleen aantallen.
 */

const getal = (waarde: string | undefined, standaard: number, min: number, max: number) => {
  const n = Number(waarde);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : standaard;
};

export const REEKS = {
  /** Mails tegelijk onderweg. */
  gelijktijdig: () => getal(process.env.MAIL_GELIJKTIJDIG, 4, 1, 10),
  /** Hoogstens zoveel mails per seconde; de mailprovider begrenst het tempo. */
  perSeconde: () => getal(process.env.MAIL_PER_SECONDE, 5, 1, 50),
  /** Zoveel ms na het binnenkomen van het verzoek start er geen mail meer. */
  budgetMs: 35_000,
  /** Wat dan nog onderweg is, wachten we niet meer af: "onzeker". Samen met
   *  de time-outs van de verbinding (15 s) blijft dit onder de 60 s. */
  uitersteMs: 52_000,
} as const;

export type ReeksStand = "gelukt" | "mislukt" | "niet-geprobeerd" | "onzeker";

type StuurUitkomst = { ok: boolean; mocked?: boolean; overgeslagen?: boolean };

/**
 * De zuivere kern: verdeelt de adressen over `gelijktijdig` werkers. Een
 * werker neemt pas een volgend adres als `stopNa` nog niet bereikt is; op
 * `uiterste` stopt het wachten en is wat nog onderweg is "onzeker" (niet
 * opnieuw versturen: de mail kan vertrokken zijn). `stuur` mag gooien, dat
 * telt als mislukt.
 */
export async function verdeelReeks(
  adressen: readonly string[],
  stuur: (adres: string) => Promise<StuurUitkomst>,
  o: { gelijktijdig: number; stopNa: number; uiterste: number; nu?: () => number },
): Promise<{ standen: Map<string, ReeksStand>; mocked: boolean; overgeslagen: boolean }> {
  const nu = o.nu ?? Date.now;
  const standen = new Map<string, ReeksStand>(adressen.map((a) => [a, "niet-geprobeerd"]));
  let volgende = 0;
  let gestopt = false;
  let mocked = false;
  let overgeslagen = false;

  const werker = async () => {
    while (!gestopt && volgende < adressen.length && nu() < o.stopNa) {
      const adres = adressen[volgende]!;
      volgende += 1;
      standen.set(adres, "onzeker");
      let r: StuurUitkomst;
      try {
        r = await stuur(adres);
      } catch {
        r = { ok: false };
      }
      // Na de uiterste grens is het antwoord al vertrokken: niets meer wijzigen.
      if (gestopt) return;
      if (r.overgeslagen) {
        // De mailsoort staat uit: er vertrekt niets, ook de rest niet.
        overgeslagen = true;
        gestopt = true;
        standen.set(adres, "niet-geprobeerd");
        return;
      }
      if (r.mocked) mocked = true;
      standen.set(adres, r.ok ? "gelukt" : "mislukt");
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const grens = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, o.uiterste - nu()));
  });
  const werkers = Array.from({ length: Math.max(1, Math.min(o.gelijktijdig, adressen.length)) }, werker);
  await Promise.race([Promise.all(werkers), grens]);
  if (timer) clearTimeout(timer);
  gestopt = true;
  return { standen: new Map(standen), mocked, overgeslagen };
}

export interface ReeksOpdracht {
  /** Sleutel in het verzendlog (mail_log.soort). */
  soort: string;
  /** Wie de reeks startte (naam), voor het verzendlog. */
  door: string;
  /** Voor de logregel in de Vercel-logs, bv. "eigen-mail:12". */
  context: string;
  ontvangers: ReadonlyArray<{ adres: string; naam: string }>;
  onderwerp: string;
  text: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  replyTo?: string;
  /** Moment waarop het verzoek binnenkwam (ms); het tijdsbudget telt vanaf hier. */
  gestartOp: number;
}

export interface ReeksUitkomst {
  aantal: number;
  gelukt: number;
  mislukt: number;
  nietGeprobeerd: number;
  onzeker: number;
  /** Geen SMTP ingesteld: de mails zijn alleen gelogd. */
  mocked: boolean;
  /** De mailsoort staat uit in Beheer › Mails: er is niets verstuurd. */
  overgeslagen: boolean;
  /** Adressen die zeker niet vertrokken zijn (mislukt of niet meer aan de
   *  beurt): die mag het scherm opnieuw versturen. */
  resterend: string[];
  /** Adressen waarvan niet zeker is of de mail vertrok: niet opnieuw
   *  versturen zonder na te vragen. */
  onzekerAdressen: string[];
}

const telOp = (adressen: readonly string[], r: Awaited<ReturnType<typeof verdeelReeks>>): ReeksUitkomst => {
  const met = (stand: ReeksStand) => adressen.filter((a) => r.standen.get(a) === stand);
  const mislukt = met("mislukt");
  const nietGeprobeerd = met("niet-geprobeerd");
  const onzeker = met("onzeker");
  return {
    aantal: adressen.length,
    gelukt: met("gelukt").length,
    mislukt: mislukt.length,
    nietGeprobeerd: nietGeprobeerd.length,
    onzeker: onzeker.length,
    mocked: r.mocked,
    overgeslagen: r.overgeslagen,
    resterend: [...mislukt, ...nietGeprobeerd],
    onzekerAdressen: onzeker,
  };
};

export async function verstuurMailReeks(o: ReeksOpdracht): Promise<ReeksUitkomst> {
  const adressen = o.ontvangers.map((x) => x.adres);
  // Eerst de logregel: breekt de functie hierna af, dan staat de verzending
  // als "onderbroken" in het verzendlog.
  const logId = await startMailLog({ soort: o.soort, aantal: adressen.length, door: o.door });
  const rondAf = async (gelukt: boolean, fout: string | null) => {
    if (logId) await rondMailLogAf(logId, { gelukt, fout });
    // Zonder regel vooraf (tabel ontbreekt, schrijven mislukte): achteraf één
    // regel, zoals vroeger.
    else await logMail({ soort: o.soort, aantal: adressen.length, gelukt, fout, door: o.door });
  };

  let transport: MailTransport | null = null;
  try {
    transport = await maakMailTransport({ gelijktijdig: REEKS.gelijktijdig(), perSeconde: REEKS.perSeconde() });
    const verdeeld = await verdeelReeks(
      adressen,
      (adres) => sendEmail({ to: [adres], subject: o.onderwerp, text: o.text, html: o.html, attachments: o.attachments, context: o.context, soort: o.soort, door: o.door, replyTo: o.replyTo, zonderLog: true, transport }),
      { gelijktijdig: REEKS.gelijktijdig(), stopNa: o.gestartOp + REEKS.budgetMs, uiterste: o.gestartOp + REEKS.uitersteMs },
    );
    const uitkomst = telOp(adressen, verdeeld);
    const reden = mailReeksReden(uitkomst);
    await rondAf(reden === null, reden);
    return uitkomst;
  } catch (err) {
    // Vóór of tijdens de reeks ging iets mis dat geen mailfout is: het log
    // zegt dat, en de route antwoordt met een fout.
    await rondAf(false, `verzending afgebroken: ${String((err as Error)?.message || err)}`);
    throw err;
  } finally {
    try {
      transport?.close?.();
    } catch {
      /* een pool die niet netjes sluit mag het antwoord niet tegenhouden */
    }
  }
}
