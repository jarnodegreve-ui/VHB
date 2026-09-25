import { DAG_DMJ, PERIODE_DMJ } from "./helpers.js";
import { bouwMail, escapeMailHtml, type MailOpbouw } from "./_lib/mailLayout.js";
import { logMail } from "./storage.js";

/** Escape user-invoer vóór die in HTML-e-mails belandt (injectie-preventie).
 *  Eén bron: de routes importeren deze i.p.v. een eigen kopie. */
export const escapeHtml = escapeMailHtml;

interface SendEmailOptions {
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** Voor de logregel in de Vercel-logs, bv. "leave:approved:jan@…". */
  context?: string;
  /** Sleutel van de mailsoort in het verzendlog (mail_log.soort), bv.
   *  "verlof-beslissing". Ontbreekt hij, dan het stuk van `context` vóór de
   *  eerste dubbelepunt. */
  soort?: string;
  /** Wie de mail veroorzaakte (naam), voor het verzendlog; leeg = Systeem. */
  door?: string | null;
  /** Bijlagen (bv. de wekelijkse backup-JSON, PDF's bij een omleiding) — 1-op-1 doorgegeven aan nodemailer. */
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
}

interface SendEmailResult {
  ok: boolean;
  mocked: boolean;
  /** Serverfout bij een mislukte verzending (alleen aan admins tonen). */
  error?: string;
}

const getSmtpConfig = () => ({
  host: process.env.SMTP_HOST || "smtp.example.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  // STARTTLS afdwingen op niet-TLS-poorten: mails bevatten gevoelige inhoud
  // (o.a. de wekelijkse back-up als bijlage) en mogen nooit plaintext de deur
  // uit als de server geen TLS aanbiedt.
  requireTLS: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const isSmtpConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

/**
 * Afzender uit de omgeving (beslissing Jarno 25-09: "VHB Portaal"
 * <noreply@vhbportaal.com> via Resend, domein geverifieerd). MAIL_FROM valt
 * terug op het oudere SMTP_FROM en daarna op de SMTP-gebruiker; er staat
 * bewust geen adres in de code. MAIL_REPLY_TO is optioneel (bv. planning@…):
 * leeg = geen Reply-To, dus een antwoord gaat naar noreply en verdwijnt.
 */
export const mailAfzender = () => {
  const naam = (process.env.MAIL_FROM_NAME || "VHB Portaal").trim();
  const adres = (process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
  const replyTo = (process.env.MAIL_REPLY_TO || "").trim() || undefined;
  return { naam, adres, replyTo, from: `"${naam.replace(/"/g, "")}" <${adres}>` };
};

export const portalUrl = () => process.env.APP_URL || "https://vhbportaal.com";

/** Mail bouwen op de vaste lay-out (api/_lib/mailLayout.ts) met de portaal-URL erbij. */
export const mailOpbouw = (o: Omit<MailOpbouw, "portaalUrl">) => bouwMail({ ...o, portaalUrl: portalUrl() });

/**
 * Generic email sender. Falls back to console-logging when SMTP credentials
 * are missing — this lets us safely test the integration in production
 * before the SMTP env vars are wired up. Elke poging (ook een mislukte) laat
 * één regel achter in het verzendlog (mail_log): soort, aantal, gelukt, door.
 */
export const sendEmail = async (opts: SendEmailOptions): Promise<SendEmailResult> => {
  const recipients = opts.to.filter(Boolean);
  if (recipients.length === 0) return { ok: true, mocked: false };
  const soort = opts.soort || String(opts.context || "onbekend").split(":")[0];
  const log = (gelukt: boolean, fout?: string) =>
    logMail({ soort, aantal: recipients.length, gelukt, fout: fout ?? null, door: opts.door ?? null });

  if (!isSmtpConfigured()) {
    // In productie NOOIT de body loggen: welkomstmails bevatten wachtwoord-
    // instel-links, ziekmeldingen een medische toelichting — die belandden
    // zo in de Vercel-functielogs (controle-ronde 27-08, bevinding 30).
    // Alleen lokaal (geen Vercel, geen production) blijft de volledige mock
    // zichtbaar, want daar wil je de link kunnen aanklikken.
    const inProductie = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
    const ctx = opts.context ? ` (${opts.context})` : "";
    if (inProductie) {
      console.error(`[mail] SMTP niet geconfigureerd, mail NIET verzonden${ctx}: ${recipients.length} ontvanger(s), onderwerp "${opts.subject}".`);
    } else {
      console.log(`--- MOCK EMAIL${ctx} ---`);
      console.log("To:", recipients.join(", "));
      console.log("Subject:", opts.subject);
      console.log("Body:", opts.text);
      console.log("---------------------------------");
    }
    await log(false, "SMTP niet geconfigureerd, mail alleen gelogd");
    return { ok: true, mocked: true };
  }

  try {
    const smtp = getSmtpConfig();
    // nodemailer lui geladen (ronde 3): alleen wie echt mailt betaalt het
    // inlezen, niet elke koude start. CJS-pakket: module.exports zit onder
    // `default`.
    const mod = await import("nodemailer");
    const nodemailer = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const transporter = nodemailer.createTransport(smtp);
    const afzender = mailAfzender();
    // BCC bij meerdere ontvangers: met alles in `To:` kreeg elke chauffeur bij
    // een dringende update het volledige adressenbestand van het personeel in
    // zijn mailbox (en lekte één doorgestuurde mail de hele lijst). Eén
    // ontvanger blijft gewoon in `To:` staan — dat leest normaal in de
    // mailclient en verklapt niets.
    const single = recipients.length === 1;
    await transporter.sendMail({
      from: afzender.from,
      ...(afzender.replyTo ? { replyTo: afzender.replyTo } : {}),
      to: single ? recipients[0] : afzender.adres,
      ...(single ? {} : { bcc: recipients }),
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    await log(true);
    return { ok: true, mocked: false };
  } catch (err: any) {
    console.error(`Email send failed${opts.context ? ` (${opts.context})` : ""}:`, err);
    const fout = String(err?.message || err);
    await log(false, fout);
    // Detail meebrengen: de testmail-route toont dit aan admins, zodat een
    // verkeerde poort/wachtwoord meteen te herkennen is i.p.v. "mislukt".
    return { ok: false, mocked: false, error: fout };
  }
};

// --- Verlofbeslissing ---

export type LeaveDecisionAction = "approved" | "rejected" | "cancelled";

interface LeaveDecisionEmailContext {
  to: string;
  recipientName: string;
  decidedByName: string;
  typeLabel: string;
  startDate: string;
  endDate: string;
  action: LeaveDecisionAction;
  /** Reden van de planner (alleen bij een afwijzing, vrije tekst). */
  reden?: string;
}

const ACTION_CONFIG: Record<LeaveDecisionAction, { subject: string; status: string; toon: "goed" | "fout" | "neutraal"; sentence: string }> = {
  approved: { subject: "Verlofaanvraag goedgekeurd", status: "Goedgekeurd", toon: "goed", sentence: "is goedgekeurd" },
  rejected: { subject: "Verlofaanvraag afgewezen", status: "Afgewezen", toon: "fout", sentence: "is afgewezen" },
  cancelled: { subject: "Goedgekeurd verlof geannuleerd", status: "Geannuleerd", toon: "neutraal", sentence: "is geannuleerd" },
};

export const sendLeaveDecisionEmail = async (ctx: LeaveDecisionEmailContext) => {
  const config = ACTION_CONFIG[ctx.action];
  const period = PERIODE_DMJ(ctx.startDate, ctx.endDate);
  // Reden bij een afwijzing (wens Jarno 22-09): als blok onder de feiten,
  // met behoud van regeleinden.
  const reden = ctx.action === "rejected" ? String(ctx.reden ?? "").trim() : "";

  const { html, text } = mailOpbouw({
    kicker: "Verlof",
    titel: config.subject,
    status: { label: config.status, toon: config.toon },
    aanhef: `Hallo ${ctx.recipientName},`,
    alineas: [
      `Je verlofaanvraag ${config.sentence} door ${ctx.decidedByName}.`,
      ...(ctx.action === "cancelled" ? ["Neem contact op met de planning als hier vragen over zijn."] : []),
    ],
    feiten: [
      { label: "Periode", waarde: period },
      { label: "Type", waarde: ctx.typeLabel },
      { label: "Beslist door", waarde: ctx.decidedByName },
    ],
    ...(reden ? { blok: { kop: "Reden", tekst: reden } } : {}),
    knop: { tekst: "Bekijk in het portaal", url: `${portalUrl()}/verlof` },
  });

  await sendEmail({
    to: [ctx.to],
    subject: `${config.subject}, ${period}`,
    text,
    html,
    context: `leave:${ctx.action}:${ctx.to}`,
    soort: "verlof-beslissing",
    door: ctx.decidedByName,
  });
};

// --- Welkomstmail voor nieuwe accounts ---

/**
 * Welkomstmail voor een net aangemaakt Auth-account. Met `actionLink` (een
 * Supabase-recovery-link) kan de nieuwe gebruiker direct een eigen wachtwoord
 * instellen; zonder link (bv. als de service-role-key ontbrak) verwijst de
 * mail naar "Wachtwoord vergeten" op het loginscherm — zelfde resultaat.
 */
export const sendWelcomeEmail = async (ctx: { to: string; name: string; actionLink?: string | null; door?: string | null }) => {
  const url = portalUrl();
  const { html, text } = mailOpbouw({
    kicker: "Welkom",
    titel: "Je account op het VHB Portaal",
    aanhef: `Hallo ${ctx.name},`,
    alineas: [
      "Er is een account voor je aangemaakt op het VHB Portaal. Daar vind je je rooster, verlofaanvragen, dienstruilen en updates van de planning. Je logt in met dit e-mailadres.",
      ...(ctx.actionLink ? [] : [`Stel je wachtwoord in via "Wachtwoord vergeten" op het loginscherm: ${url}`]),
    ],
    ...(ctx.actionLink ? { knop: { tekst: "Wachtwoord instellen", url: ctx.actionLink } } : {}),
    voet: `Tip: open ${url} op je telefoon en kies "Zet op beginscherm", dan werkt het portaal als app.`,
  });

  return sendEmail({
    to: [ctx.to],
    subject: "Welkom op het VHB Portaal, stel je wachtwoord in",
    text,
    html,
    context: `welcome:${ctx.to}`,
    soort: "welkom",
    door: ctx.door ?? null,
  });
};

// --- Vervaldata-herinnering (Code 95 / medische schifting) ---

/**
 * Herinnert de chauffeur zélf per e-mail dat een document bijna verloopt.
 * De push op de mijlpalen (90/30/7/0 dagen) bereikt alleen wie meldingen aan
 * heeft — dat zijn er nauwelijks — dus dit is het kanaal dat wél aankomt.
 * De planner ziet de vervaldata sowieso al in het ochtenddigest.
 */
export const sendExpiryReminderEmail = async (ctx: {
  to: string;
  name: string;
  soortLabel: string;
  validUntil: string;
  dagen: number;
}) => {
  const wanneer =
    ctx.dagen <= 0
      ? "verloopt vandaag"
      : ctx.dagen === 1
        ? "verloopt morgen"
        : `verloopt over ${ctx.dagen} dagen`;
  const dringend = ctx.dagen <= 7;
  const soort = ctx.soortLabel.toLowerCase();

  const { html, text } = mailOpbouw({
    kicker: "Herinnering",
    titel: `Je ${soort} ${wanneer}`,
    status: { label: dringend ? "Dringend" : "Tijdig regelen", toon: dringend ? "fout" : "aandacht" },
    aanhef: `Hallo ${ctx.name},`,
    alineas: ["Regel de vernieuwing tijdig en geef de nieuwe datum door aan de planning, dan blijf je zonder onderbreking inzetbaar."],
    feiten: [
      { label: "Document", waarde: ctx.soortLabel },
      { label: "Geldig tot", waarde: DAG_DMJ(ctx.validUntil) },
    ],
    knop: { tekst: "Open het portaal", url: portalUrl() },
  });

  return sendEmail({
    to: [ctx.to],
    subject: `Herinnering: je ${soort} ${wanneer}`,
    text,
    html,
    context: `expiry:${ctx.to}:${ctx.dagen}`,
    soort: "vervaldatum",
  });
};
