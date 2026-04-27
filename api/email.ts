import nodemailer from "nodemailer";

interface SendEmailOptions {
  to: string[];
  subject: string;
  text: string;
  html: string;
  context?: string; // for logging only
}

interface SendEmailResult {
  ok: boolean;
  mocked: boolean;
}

const getSmtpConfig = () => ({
  host: process.env.SMTP_HOST || "smtp.example.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const isSmtpConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

const portalUrl = () => process.env.APP_URL || "https://vhb.vercel.app";

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
    await transporter.sendMail({
      from: `"VHB Portaal" <${process.env.SMTP_FROM || smtp.auth.user}>`,
      to: recipients.join(", "),
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { ok: true, mocked: false };
  } catch (err) {
    console.error(`Email send failed${opts.context ? ` (${opts.context})` : ""}:`, err);
    return { ok: false, mocked: false };
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
        <p style="color: #1e293b; font-size: 16px; margin-top: 0;">Hallo ${ctx.recipientName},</p>
        <p style="color: #475569; line-height: 1.6;">
          Je verlofaanvraag voor <strong>${period}</strong> (${ctx.typeLabel}) ${config.sentence} door ${ctx.decidedByName}.
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
