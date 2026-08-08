import nodemailer from "nodemailer";

/** Escape user-invoer vóór die in HTML-e-mails belandt (injectie-preventie).
 *  Eén bron: index.ts importeert deze i.p.v. een eigen kopie. */
export const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

interface SendEmailOptions {
  to: string[];
  subject: string;
  text: string;
  html: string;
  context?: string; // for logging only
  /** Bijlagen (bv. de wekelijkse backup-JSON) — 1-op-1 doorgegeven aan nodemailer. */
  attachments?: Array<{ filename: string; content: string | Buffer }>;
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

const portalUrl = () => process.env.APP_URL || "https://vhbportaal.com";

/**
 * Generic email sender. Falls back to console-logging when SMTP credentials
 * are missing — this lets us safely test the integration in production
 * before the SMTP env vars are wired up.
 */
export const sendEmail = async (opts: SendEmailOptions): Promise<SendEmailResult> => {
  const recipients = opts.to.filter(Boolean);
  if (recipients.length === 0) return { ok: true, mocked: false };

  if (!isSmtpConfigured()) {
    console.log(`--- MOCK EMAIL${opts.context ? ` (${opts.context})` : ""} ---`);
    console.log("To:", recipients.join(", "));
    console.log("Subject:", opts.subject);
    console.log("Body:", opts.text);
    console.log("---------------------------------");
    return { ok: true, mocked: true };
  }

  try {
    const smtp = getSmtpConfig();
    const transporter = nodemailer.createTransport(smtp);
    const fromAddress = process.env.SMTP_FROM || smtp.auth.user;
    // BCC bij meerdere ontvangers: met alles in `To:` kreeg elke chauffeur bij
    // een dringende update het volledige adressenbestand van het personeel in
    // zijn mailbox (en lekte één doorgestuurde mail de hele lijst). Eén
    // ontvanger blijft gewoon in `To:` staan — dat leest normaal in de
    // mailclient en verklapt niets.
    const single = recipients.length === 1;
    await transporter.sendMail({
      from: `"VHB Portaal" <${fromAddress}>`,
      to: single ? recipients[0] : fromAddress,
      ...(single ? {} : { bcc: recipients }),
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    return { ok: true, mocked: false };
  } catch (err: any) {
    console.error(`Email send failed${opts.context ? ` (${opts.context})` : ""}:`, err);
    // Detail meebrengen: de testmail-route toont dit aan admins, zodat een
    // verkeerde poort/wachtwoord meteen te herkennen is i.p.v. "mislukt".
    return { ok: false, mocked: false, error: String(err?.message || err) };
  }
};

// --- Leave-decision template ---

export type LeaveDecisionAction = "approved" | "rejected" | "cancelled";

interface LeaveDecisionEmailContext {
  to: string;
  recipientName: string;
  decidedByName: string;
  typeLabel: string;
  startDate: string;
  endDate: string;
  action: LeaveDecisionAction;
}

const ACTION_CONFIG: Record<LeaveDecisionAction, { subject: string; bannerLabel: string; bannerColor: string; sentence: string }> = {
  approved: {
    subject: "Verlofaanvraag goedgekeurd",
    bannerLabel: "GOEDGEKEURD",
    bannerColor: "#10b981",
    sentence: "is goedgekeurd",
  },
  rejected: {
    subject: "Verlofaanvraag afgewezen",
    bannerLabel: "AFGEWEZEN",
    bannerColor: "#ef4444",
    sentence: "is afgewezen",
  },
  cancelled: {
    subject: "Goedgekeurd verlof geannuleerd",
    bannerLabel: "GEANNULEERD",
    bannerColor: "#64748b",
    sentence: "is geannuleerd",
  },
};

const formatPeriod = (start: string, end: string) => (start === end ? start : `${start} t/m ${end}`);

export const sendLeaveDecisionEmail = async (ctx: LeaveDecisionEmailContext) => {
  const config = ACTION_CONFIG[ctx.action];
  const period = formatPeriod(ctx.startDate, ctx.endDate);
  const url = portalUrl();

  const cancelledNote = ctx.action === "cancelled"
    ? "<p style=\"color: #475569; line-height: 1.6;\">Neem contact op met de planning als hier vragen over zijn.</p>"
    : "";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: ${config.bannerColor}; color: white; padding: 22px 30px; text-align: center;">
        <p style="margin: 0; font-size: 12px; font-weight: 800; letter-spacing: 0.18em;">${config.bannerLabel}</p>
        <h1 style="margin: 8px 0 0; font-size: 22px; font-weight: 800;">${config.subject}</h1>
      </div>
      <div style="padding: 30px;">
        <p style="color: #1e293b; font-size: 16px; margin-top: 0;">Hallo ${escapeHtml(ctx.recipientName)},</p>
        <p style="color: #475569; line-height: 1.6;">
          Je verlofaanvraag voor <strong>${escapeHtml(period)}</strong> (${escapeHtml(ctx.typeLabel)}) ${config.sentence} door ${escapeHtml(ctx.decidedByName)}.
        </p>
        ${cancelledNote}
        <div style="margin-top: 30px; text-align: center;">
          <a href="${url}/verlof" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Bekijk in portaal</a>
        </div>
      </div>
      <div style="background-color: #f8fafc; padding: 14px 30px; text-align: center; font-size: 11px; color: #94a3b8;">
        Automatisch bericht van het VHB Portaal — niet beantwoorden.
      </div>
    </div>
  `;

  const text = [
    `Hallo ${ctx.recipientName},`,
    "",
    `Je verlofaanvraag voor ${period} (${ctx.typeLabel}) ${config.sentence} door ${ctx.decidedByName}.`,
    ctx.action === "cancelled" ? "Neem contact op met de planning als hier vragen over zijn." : "",
    "",
    `Bekijk in portaal: ${url}/verlof`,
  ].filter(Boolean).join("\n");

  await sendEmail({
    to: [ctx.to],
    subject: `${config.subject} — ${period}`,
    text,
    html,
    context: `leave:${ctx.action}:${ctx.to}`,
  });
};

// --- Welkomstmail voor nieuwe accounts ---

/**
 * Welkomstmail voor een net aangemaakt Auth-account. Met `actionLink` (een
 * Supabase-recovery-link) kan de nieuwe gebruiker direct een eigen wachtwoord
 * instellen; zonder link (bv. als de service-role-key ontbrak) verwijst de
 * mail naar "Wachtwoord vergeten" op het loginscherm — zelfde resultaat.
 */
export const sendWelcomeEmail = async (ctx: { to: string; name: string; actionLink?: string | null }) => {
  const url = portalUrl();
  const setPassword = ctx.actionLink
    ? { text: `Stel je wachtwoord in via deze link: ${ctx.actionLink}`, html: `<a href="${ctx.actionLink}" style="background-color: #E8A33D; color: #0D0D0F; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Wachtwoord instellen</a>` }
    : { text: `Stel je wachtwoord in via "Wachtwoord vergeten" op het loginscherm: ${url}`, html: `<p style="color: #475569; line-height: 1.6;">Stel je wachtwoord in via <strong>"Wachtwoord vergeten"</strong> op het <a href="${url}">loginscherm</a>.</p>` };

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
      <div style="background-color: #0D0D0F; color: white; padding: 22px 30px; text-align: center;">
        <p style="margin: 0; font-size: 12px; font-weight: 800; letter-spacing: 0.18em; color: #E8A33D;">WELKOM</p>
        <h1 style="margin: 8px 0 0; font-size: 22px; font-weight: 800;">VHB Portaal</h1>
      </div>
      <div style="padding: 30px;">
        <p style="color: #1e293b; font-size: 16px; margin-top: 0;">Hallo ${escapeHtml(ctx.name)},</p>
        <p style="color: #475569; line-height: 1.6;">
          Er is een account voor je aangemaakt op het VHB Portaal. Daar vind je je rooster,
          verlofaanvragen, dienstruilen en updates van de planning. Je logt in met dit e-mailadres.
        </p>
        <div style="margin-top: 26px; text-align: center;">${setPassword.html}</div>
        <p style="margin-top: 26px; color: #94a3b8; font-size: 12px; line-height: 1.6;">
          Tip: open ${url} op je telefoon en kies "Zet op beginscherm" — dan werkt het portaal als app.
        </p>
      </div>
      <div style="background-color: #f8fafc; padding: 14px 30px; text-align: center; font-size: 11px; color: #94a3b8;">
        Automatisch bericht van het VHB Portaal — niet beantwoorden.
      </div>
    </div>
  `;

  const text = [
    `Hallo ${ctx.name},`,
    "",
    "Er is een account voor je aangemaakt op het VHB Portaal. Je logt in met dit e-mailadres.",
    setPassword.text,
    "",
    `Portaal: ${url}`,
  ].join("\n");

  return sendEmail({
    to: [ctx.to],
    subject: "Welkom op het VHB Portaal — stel je wachtwoord in",
    text,
    html,
    context: `welcome:${ctx.to}`,
  });
};
