import { DAG_DMJ, PERIODE_DMJ, brusselsDay } from "./helpers.js";
import { bouwMail, escapeMailHtml, type MailOpbouw } from "./_lib/mailLayout.js";
import { logMail } from "./storage.js";
import { mailSoortAan } from "./_lib/mailInstellingen.js";

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
  /** Antwoordadres voor déze mail (bv. de admin die zelf mailt); anders MAIL_REPLY_TO. */
  replyTo?: string;
  /** Geen eigen logregel: de aanroeper logt zelf één regel voor een reeks
   *  (zelf een mail sturen: één regel met het aantal, niet één per persoon). */
  zonderLog?: boolean;
  /** Bijlagen (bv. de wekelijkse backup-JSON, PDF's bij een omleiding) — 1-op-1 doorgegeven aan nodemailer. */
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
  /** Hergebruikte verbinding voor een reeks (`maakMailTransport`); zonder
   *  deze optie opent elke mail zijn eigen verbinding, zoals altijd. */
  transport?: MailTransport | null;
}

/** Wat sendEmail van een verbinding nodig heeft (nodemailer-transporter). */
export interface MailTransport {
  sendMail: (mail: Record<string, unknown>) => Promise<unknown>;
  close?: () => void;
}

interface SendEmailResult {
  ok: boolean;
  mocked: boolean;
  /** De mailsoort staat uit in Beheer › Mails: niets verstuurd, wel gelogd. */
  overgeslagen?: boolean;
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

const laadNodemailer = async () => {
  // nodemailer lui geladen (ronde 3): alleen wie echt mailt betaalt het
  // inlezen, niet elke koude start. CJS-pakket: module.exports zit onder
  // `default`.
  const mod = await import("nodemailer");
  return (mod as unknown as { default?: typeof mod }).default ?? mod;
};

/**
 * Eén verbinding voor een hele reeks mails (nr. 5): een pool die zijn
 * SMTP-verbindingen openhoudt, in plaats van per mail opnieuw te verbinden,
 * TLS op te zetten en aan te melden. `gelijktijdig` verbindingen tegelijk en
 * hoogstens `perSeconde` mails per seconde (de mailprovider begrenst het
 * tempo; wie te snel gaat krijgt weigeringen). Korte time-outs, zodat één
 * hangende verbinding de functie niet tot haar limiet van 60 s ophoudt.
 * Null zonder SMTP-gegevens: sendEmail logt de mail dan alleen. Sluit de
 * pool na de reeks met `close()`.
 */
export const maakMailTransport = async (o: { gelijktijdig: number; perSeconde: number }): Promise<MailTransport | null> => {
  if (!isSmtpConfigured()) return null;
  const nodemailer = await laadNodemailer();
  return nodemailer.createTransport({
    ...getSmtpConfig(),
    pool: true,
    maxConnections: o.gelijktijdig,
    maxMessages: Infinity,
    rateDelta: 1000,
    rateLimit: o.perSeconde,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  } as Parameters<typeof nodemailer.createTransport>[0]) as unknown as MailTransport;
};

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

/** Wat een gebruiker leest als de mailsoort uit staat en er dus niets vertrok. */
export const MAIL_UIT_MELDING = "Mail staat uit in Beheer › Mails, er is niets verstuurd.";

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
    opts.zonderLog ? Promise.resolve() : logMail({ soort, aantal: recipients.length, gelukt, fout: fout ?? null, door: opts.door ?? null });

  // Uitgezet in Beheer › Mails (PR 3): niet versturen, wel een logregel zodat
  // zichtbaar blijft dát er iets had kunnen uitgaan. Soorten die altijd aan
  // staan (welkom, back-up, herstel, testmail) komen hier nooit langs.
  if (!(await mailSoortAan(soort))) {
    await log(false, "uitgeschakeld in Beheer › Mails");
    return { ok: true, mocked: false, overgeslagen: true };
  }

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
    const transporter: MailTransport = opts.transport ?? ((await laadNodemailer()).createTransport(getSmtpConfig()) as unknown as MailTransport);
    const afzender = mailAfzender();
    // BCC bij meerdere ontvangers: met alles in `To:` kreeg elke chauffeur bij
    // een dringende update het volledige adressenbestand van het personeel in
    // zijn mailbox (en lekte één doorgestuurde mail de hele lijst). Eén
    // ontvanger blijft gewoon in `To:` staan — dat leest normaal in de
    // mailclient en verklapt niets.
    const single = recipients.length === 1;
    const replyTo = opts.replyTo || afzender.replyTo;
    await transporter.sendMail({
      from: afzender.from,
      ...(replyTo ? { replyTo } : {}),
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

// De titel zegt de uitkomst in een zin, de pil ernaast geeft ze kleur; de
// zin in de mail noemt wie besliste, zodat niets drie keer staat.
const ACTION_CONFIG: Record<LeaveDecisionAction, { subject: string; titel: string; status: string; toon: "goed" | "fout" | "neutraal"; zin: (door: string) => string }> = {
  approved: { subject: "Verlofaanvraag goedgekeurd", titel: "Je verlof is goedgekeurd", status: "Goedgekeurd", toon: "goed", zin: (door) => `${door} heeft je aanvraag goedgekeurd.` },
  rejected: { subject: "Verlofaanvraag afgewezen", titel: "Je verlof is afgewezen", status: "Afgewezen", toon: "fout", zin: (door) => `${door} heeft je aanvraag afgewezen.` },
  cancelled: { subject: "Goedgekeurd verlof geannuleerd", titel: "Je verlof is geannuleerd", status: "Geannuleerd", toon: "neutraal", zin: (door) => `${door} heeft je goedgekeurde verlof geannuleerd.` },
};

/** Onderwerp, HTML en tekst van een mail. Elke mail heeft één bouwer; de
 *  verzendfunctie én het voorbeeld in Beheer › Mails (mailVoorbeelden.ts)
 *  gebruiken dezelfde, zodat het voorbeeld nooit van de echte mail afwijkt. */
export type MailTekst = { onderwerp: string; html: string; text: string };

export const bouwVerlofBeslissingMail = (ctx: Omit<LeaveDecisionEmailContext, "to">): MailTekst => {
  const config = ACTION_CONFIG[ctx.action];
  const period = PERIODE_DMJ(ctx.startDate, ctx.endDate);
  // Reden bij een afwijzing (wens Jarno 22-09): als blok onder de feiten,
  // met behoud van regeleinden.
  const reden = ctx.action === "rejected" ? String(ctx.reden ?? "").trim() : "";

  const { html, text } = mailOpbouw({
    kicker: "Verlof",
    titel: config.titel,
    status: { label: config.status, toon: config.toon },
    // Bij een afwijzing staat de reden meteen in de inbox.
    voorbeeld: reden ? `Reden: ${reden}` : config.zin(ctx.decidedByName),
    aanhef: `Hallo ${ctx.recipientName},`,
    alineas: [
      config.zin(ctx.decidedByName),
      ...(ctx.action === "cancelled" ? ["Neem contact op met de planning als hier vragen over zijn."] : []),
    ],
    feiten: [
      { label: "Periode", waarde: period },
      { label: "Type", waarde: ctx.typeLabel },
    ],
    ...(reden ? { blok: { kop: "Reden", tekst: reden } } : {}),
    knop: { tekst: "Bekijk je verlof", url: `${portalUrl()}/verlof` },
    ...(ctx.action === "rejected" ? { voet: "Een andere periode aanvragen? Dat doe je in het portaal onder Verlof." } : {}),
  });
  return { onderwerp: `${config.subject}, ${period}`, html, text };
};

export const sendLeaveDecisionEmail = async (ctx: LeaveDecisionEmailContext) => {
  const { onderwerp, html, text } = bouwVerlofBeslissingMail(ctx);
  await sendEmail({
    to: [ctx.to],
    subject: onderwerp,
    text,
    html,
    context: `leave:${ctx.action}:${ctx.to}`,
    soort: "verlof-beslissing",
    door: ctx.decidedByName,
  });
};

// --- Welkomstmail voor nieuwe accounts ---

/** "07/10/2026 om 16:05", in Belgische tijd. */
const momentDmj = (iso: string) =>
  `${DAG_DMJ(brusselsDay(iso))} om ${new Date(iso).toLocaleTimeString("en-GB", { hour12: false, timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit" })}`;

/**
 * Welkomstmail voor een net aangemaakt Auth-account. Met `actionLink` kiest
 * de nieuwe gebruiker direct een eigen wachtwoord: sinds 30-09 de link van
 * een uitnodiging (zeven dagen, `geldigTot`), met de herstellink van Supabase
 * (één uur) als terugval. Zonder link (bv. als de service-role-key ontbrak)
 * verwijst de mail naar "Wachtwoord vergeten" op het loginscherm.
 */
export const bouwWelkomMail = (ctx: { name: string; actionLink?: string | null; geldigTot?: string | null }): MailTekst => {
  const url = portalUrl();
  const { html, text } = mailOpbouw({
    kicker: "Welkom",
    titel: "Je account op het VHB Portaal",
    aanhef: `Hallo ${ctx.name},`,
    alineas: [
      "Er is een account voor je aangemaakt op het VHB Portaal. Daar vind je je rooster, verlofaanvragen, dienstruilen en updates van de planning. Je logt in met dit e-mailadres.",
      ...(ctx.actionLink ? [] : [`Stel je wachtwoord in via "Wachtwoord vergeten" op het loginscherm: ${url}`]),
    ],
    ...(ctx.actionLink && ctx.geldigTot ? { feiten: [{ label: "Link geldig tot", waarde: momentDmj(ctx.geldigTot) }] } : {}),
    ...(ctx.actionLink ? { knop: { tekst: "Wachtwoord instellen", url: ctx.actionLink, actie: true } } : {}),
    voet: `Tip: open ${url} op je telefoon en kies "Zet op beginscherm", dan werkt het portaal als app.`,
  });
  return { onderwerp: "Welkom op het VHB Portaal, stel je wachtwoord in", html, text };
};

export const sendWelcomeEmail = async (ctx: { to: string; name: string; actionLink?: string | null; geldigTot?: string | null; door?: string | null }) => {
  const { onderwerp, html, text } = bouwWelkomMail(ctx);
  return sendEmail({
    to: [ctx.to],
    subject: onderwerp,
    text,
    html,
    context: `welcome:${ctx.to}`,
    soort: "welkom",
    door: ctx.door ?? null,
  });
};

// --- Uitnodiging voor een bestaand account (30-09) ---

/**
 * Uitnodiging voor iemand die al een account heeft maar nog nooit aanmeldde
 * (Gebruikers › Uitnodigen). De link is een eigen code die zeven dagen werkt
 * (api/_lib/uitnodiging.ts), geen link van Supabase die na een uur vervalt.
 */
export const bouwUitnodigingMail = (ctx: { naam: string; email: string; link: string; geldigTot: string }): MailTekst => {
  const { html, text } = mailOpbouw({
    kicker: "Uitnodiging",
    titel: "Je bent uitgenodigd voor het VHB Portaal",
    aanhef: `Hallo ${ctx.naam},`,
    alineas: [
      "Op het VHB Portaal vind je je rooster, verlofaanvragen, dienstruilen en de updates van de planning.",
      "Kies eerst een eigen wachtwoord met de knop hieronder. Daarna log je in met je e-mailadres en dat wachtwoord.",
    ],
    feiten: [
      { label: "Je e-mailadres", waarde: ctx.email },
      { label: "Link geldig tot", waarde: momentDmj(ctx.geldigTot) },
    ],
    knop: { tekst: "Wachtwoord kiezen", url: ctx.link, actie: true },
    voet: `Werkt de link niet meer? Vraag de planning om een nieuwe uitnodiging. Tip: open ${portalUrl()} op je telefoon en kies "Zet op beginscherm", dan werkt het portaal als app.`,
  });
  return { onderwerp: "Uitnodiging voor het VHB Portaal, kies je wachtwoord", html, text };
};

// --- Vervaldata-herinnering (Code 95 / medische schifting) ---

/**
 * Herinnert de chauffeur zélf per e-mail dat een document bijna verloopt.
 * De push op de mijlpalen (90/30/7/0 dagen) bereikt alleen wie meldingen aan
 * heeft — dat zijn er nauwelijks — dus dit is het kanaal dat wél aankomt.
 * De planner ziet de vervaldata sowieso al in het ochtenddigest.
 */
export const bouwVervaldatumMail = (ctx: { name: string; soortLabel: string; validUntil: string; dagen: number }): MailTekst => {
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
  return { onderwerp: `Herinnering: je ${soort} ${wanneer}`, html, text };
};

export const sendExpiryReminderEmail = async (ctx: {
  to: string;
  name: string;
  soortLabel: string;
  validUntil: string;
  dagen: number;
}) => {
  const { onderwerp, html, text } = bouwVervaldatumMail(ctx);
  return sendEmail({
    to: [ctx.to],
    subject: onderwerp,
    text,
    html,
    context: `expiry:${ctx.to}:${ctx.dagen}`,
    soort: "vervaldatum",
  });
};
