/**
 * Eén lay-out voor elke mail die het portaal verstuurt (mailtranche PR 2,
 * 25-09): de systeemmails in api/email.ts en de routes, én de Supabase-
 * authmails (scripts/auth-mails.mjs bouwt daar dezelfde opbouw mee).
 *
 * Bewust ouderwets: tabellen en inline stijlen, want mailclients (Outlook,
 * Gmail-app) kennen geen flex, geen externe CSS en geen webfonts. Eén kolom
 * van 600 px, het echte logo als PNG (public/mail/vhb-logo.png, links
 * uitgelijnd), een rustige kop, een statuspuntje waar een uitkomst is, een
 * feitenlijst voor de kerngegevens, hoogstens één donkere knop, en een vaste
 * voet. Onderwerpen zijn zakelijk en zonder emoji (die zet Outlook als
 * vraagtekens en spamfilters wegen ze mee).
 *
 * Tekstversie: dezelfde opbouw in platte tekst, zodat wie HTML uitzet (of
 * een spamfilter dat de tekst leest) hetzelfde krijgt.
 *
 * Alle teksten worden hier ge-escaped; wie bewust HTML wil (bv. een
 * <pre>-blok met een commando) gebruikt `html` in een alinea. Geen em dash
 * als zinsscheiding (CLAUDE.md), ook niet in de vaste teksten hier.
 */

export const MAIL_KLEUR = {
  carbon: "#0D0D0F",
  goud: "#E2A323",
  tekst: "#1F2937",
  gedempt: "#6E767F",
  hairline: "#E5E7EB",
  achtergrond: "#F3F4F6",
  vlak: "#F9FAFB",
  wit: "#FFFFFF",
} as const;

/** Toon van het statuspuntje: het portaal-palet, iets donkerder voor wit. */
export const STATUS_KLEUR = {
  neutraal: "#6E767F",
  goed: "#3E9E75",
  aandacht: "#C98A1F",
  fout: "#C64F63",
} as const;
export type MailStatusToon = keyof typeof STATUS_KLEUR;

export const escapeMailHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Een alinea: platte tekst (ge-escaped) of bewust rauwe HTML mét een tekstversie. */
export type MailAlinea = string | { html: string; tekst: string };

export interface MailOpbouw {
  /** Klein label boven de titel, bv. "VERLOF" of "SYSTEEM". */
  kicker?: string;
  /** De kop van de mail. */
  titel: string;
  /** Uitkomst met puntje, bv. { label: "Goedgekeurd", toon: "goed" }. */
  status?: { label: string; toon: MailStatusToon };
  /** "Hallo Jan," */
  aanhef?: string;
  /** Alinea's onder de aanhef. */
  alineas?: MailAlinea[];
  /** Kerngegevens als label/waarde, bv. Periode, Type, Beslist door. */
  feiten?: Array<{ label: string; waarde: string }>;
  /** Opsomming, bv. openstaande diensten of foutsoorten. */
  lijst?: { kop?: string; items: string[] };
  /** Extra opsommingen ná de eerste (digest). */
  lijsten?: Array<{ kop?: string; items: string[] }>;
  /** Grijs blok met kop, bv. de reden van een afwijzing (regeleinden blijven). */
  blok?: { kop: string; tekst: string };
  /** Eén knop, donker. */
  knop?: { tekst: string; url: string };
  /** Kleine tekst onder de knop. */
  voet?: string;
  /** Vaste voetregel; standaard "niet beantwoorden". `false` laat de regel weg. */
  nietBeantwoorden?: boolean;
  /** Publieke basis-URL van het portaal (voor het logo en de voet). */
  portaalUrl: string;
}

const P = (inhoud: string, extra = "") =>
  `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: ${MAIL_KLEUR.tekst};${extra}">${inhoud}</p>`;

// Een regeleinde in een gewone alinea blijft een regeleinde (eigen mail van
// een admin, meerregelige omschrijving).
const alineaHtml = (a: MailAlinea) => (typeof a === "string" ? P(escapeMailHtml(a).replace(/\n/g, "<br>")) : a.html);
const alineaTekst = (a: MailAlinea) => (typeof a === "string" ? a : a.tekst);

const lijstHtml = (l: { kop?: string; items: string[] }) => {
  if (l.items.length === 0) return "";
  const kop = l.kop ? `<p style="margin: 18px 0 6px; font-size: 13px; font-weight: 700; color: ${MAIL_KLEUR.carbon};">${escapeMailHtml(l.kop)}</p>` : "";
  return `${kop}<ul style="margin: 0 0 14px; padding-left: 20px; font-size: 14px; line-height: 1.6; color: ${MAIL_KLEUR.tekst};">${l.items.map((i) => `<li style="margin: 0 0 4px;">${escapeMailHtml(i)}</li>`).join("")}</ul>`;
};
const lijstTekst = (l: { kop?: string; items: string[] }) =>
  l.items.length === 0 ? "" : `${l.kop ? `${l.kop}\n` : ""}${l.items.map((i) => `- ${i}`).join("\n")}`;

/** Bouwt de HTML- en tekstversie van een mail uit één opbouw. */
export function bouwMail(o: MailOpbouw): { html: string; text: string } {
  const logo = `${o.portaalUrl.replace(/\/$/, "")}/mail/vhb-logo.png`;
  const lijsten = [...(o.lijst ? [o.lijst] : []), ...(o.lijsten ?? [])];
  const nietBeantwoorden = o.nietBeantwoorden !== false;

  const status = o.status
    ? `<p style="margin: 0 0 18px; font-size: 13px; font-weight: 600; color: ${MAIL_KLEUR.tekst};"><span style="display: inline-block; width: 10px; height: 10px; border-radius: 5px; background-color: ${STATUS_KLEUR[o.status.toon]}; vertical-align: middle; margin-right: 8px;"></span>${escapeMailHtml(o.status.label)}</p>`
    : "";
  const feiten = o.feiten && o.feiten.length > 0
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 4px 0 18px; border-collapse: collapse;">
${o.feiten.map((f) => `<tr>
  <td style="padding: 9px 12px 9px 0; border-top: 1px solid ${MAIL_KLEUR.hairline}; font-size: 13px; color: ${MAIL_KLEUR.gedempt}; width: 34%; vertical-align: top;">${escapeMailHtml(f.label)}</td>
  <td style="padding: 9px 0; border-top: 1px solid ${MAIL_KLEUR.hairline}; font-size: 14px; font-weight: 600; color: ${MAIL_KLEUR.carbon}; vertical-align: top;">${escapeMailHtml(f.waarde)}</td>
</tr>`).join("\n")}
</table>`
    : "";
  const blok = o.blok
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 4px 0 18px; border-collapse: collapse;"><tr><td style="padding: 14px 18px; background-color: ${MAIL_KLEUR.vlak}; border-left: 3px solid ${MAIL_KLEUR.goud}; border-radius: 8px;">
  <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: ${MAIL_KLEUR.gedempt};">${escapeMailHtml(o.blok.kop).toUpperCase()}</p>
  <p style="margin: 0; font-size: 14px; line-height: 1.6; color: ${MAIL_KLEUR.tekst}; white-space: pre-wrap;">${escapeMailHtml(o.blok.tekst)}</p>
</td></tr></table>`
    : "";
  const knop = o.knop
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 8px 0 18px;"><tr><td style="background-color: ${MAIL_KLEUR.carbon}; border-radius: 8px;">
  <a href="${escapeMailHtml(o.knop.url)}" style="display: inline-block; padding: 12px 22px; font-size: 14px; font-weight: 600; color: ${MAIL_KLEUR.wit}; text-decoration: none;">${escapeMailHtml(o.knop.tekst)}</a>
</td></tr></table>`
    : "";
  const voet = o.voet ? `<p style="margin: 0 0 6px; font-size: 12px; line-height: 1.6; color: ${MAIL_KLEUR.gedempt};">${escapeMailHtml(o.voet)}</p>` : "";
  const voetregels = [
    nietBeantwoorden ? "Automatisch bericht van het VHB Portaal, niet beantwoorden. Vragen? Contacteer de planning." : "",
    `<a href="${escapeMailHtml(o.portaalUrl)}" style="color: ${MAIL_KLEUR.gedempt}; text-decoration: underline;">${escapeMailHtml(o.portaalUrl.replace(/^https?:\/\//, ""))}</a>`,
  ].filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeMailHtml(o.titel)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${MAIL_KLEUR.achtergrond};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${MAIL_KLEUR.achtergrond};">
<tr><td align="center" style="padding: 24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%; background-color: ${MAIL_KLEUR.wit}; border: 1px solid ${MAIL_KLEUR.hairline}; border-radius: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
<tr><td style="padding: 22px 32px; border-bottom: 1px solid ${MAIL_KLEUR.hairline};">
  <img src="${logo}" width="180" height="36" alt="VHB, Van Hoorebeke &amp; Zoon" style="display: block; width: 180px; height: auto; border: 0;">
</td></tr>
<tr><td style="padding: 28px 32px 20px;">
  ${o.kicker ? `<p style="margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.16em; color: ${MAIL_KLEUR.gedempt};">${escapeMailHtml(o.kicker).toUpperCase()}</p>` : ""}
  <h1 style="margin: 0 0 14px; font-size: 20px; line-height: 1.3; font-weight: 700; color: ${MAIL_KLEUR.carbon};">${escapeMailHtml(o.titel)}</h1>
  ${status}
  ${o.aanhef ? P(escapeMailHtml(o.aanhef)) : ""}
  ${(o.alineas ?? []).map(alineaHtml).join("\n  ")}
  ${feiten}
  ${lijsten.map(lijstHtml).join("\n  ")}
  ${blok}
  ${knop}
  ${voet}
</td></tr>
<tr><td style="padding: 14px 32px 18px; border-top: 1px solid ${MAIL_KLEUR.hairline}; font-size: 12px; line-height: 1.6; color: ${MAIL_KLEUR.gedempt};">
  ${voetregels.join("<br>")}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  // Tekstversie: dezelfde secties, gescheiden door een witregel.
  const secties: string[] = [
    [o.kicker ? o.kicker.toUpperCase() : "", o.titel, o.status ? `Status: ${o.status.label}` : ""].filter(Boolean).join("\n"),
    o.aanhef ?? "",
    ...(o.alineas ?? []).map(alineaTekst),
    o.feiten && o.feiten.length > 0 ? o.feiten.map((f) => `${f.label}: ${f.waarde}`).join("\n") : "",
    ...lijsten.map(lijstTekst),
    o.blok ? `${o.blok.kop}: ${o.blok.tekst}` : "",
    o.knop ? `${o.knop.tekst}: ${o.knop.url}` : "",
    o.voet ?? "",
    [nietBeantwoorden ? "Automatisch bericht van het VHB Portaal, niet beantwoorden. Vragen? Contacteer de planning." : "", o.portaalUrl].filter(Boolean).join("\n"),
  ];
  const text = secties.filter((r) => r.trim() !== "").join("\n\n");

  return { html, text };
}
