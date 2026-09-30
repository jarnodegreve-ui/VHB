/**
 * Eén lay-out voor elke mail die het portaal verstuurt (mailtranche PR 2,
 * 25-09): de systeemmails in api/email.ts en de routes, én de Supabase-
 * authmails (scripts/auth-mails.mjs bouwt daar dezelfde opbouw mee).
 *
 * Bewust ouderwets: tabellen en inline stijlen, want mailclients (Outlook,
 * Gmail-app) kennen geen flex en geen externe CSS. Eén kolom van 600 px op
 * wit, zonder kaart eromheen: op een telefoon gaat de volle breedte naar de
 * tekst. Het echte logo als PNG (public/mail/vhb-logo.png, links; op een
 * witte tegel die in de afbeelding zelf zit, zie scripts/mail-logo.mjs:
 * Gmail en Outlook keren in dark mode de achtergrond om maar laten
 * afbeeldingen staan. De tegel heeft 8 px marge rond het logo bij 160 px
 * breed; de cel eromheen heeft er 8 minder, zodat het logo op één lijn staat
 * met de tekst). Daaronder het label met de status als pil, de titel in
 * Manrope (zoals de koppen van het portaal), de feiten in een vlak, lijsten
 * met fijne lijnen, een blok met een gouden streep (bv. de reden van een
 * afwijzing), hoogstens één gouden knop (de hoofdknop van het portaal) en een
 * vaste voet. Onderwerpen zijn zakelijk en zonder emoji (die zet
 * Outlook als vraagtekens en spamfilters wegen ze mee).
 *
 * Wat alleen sommige clients kunnen, is een aanvulling en nooit nodig om de
 * mail te lezen: Manrope laadt Apple Mail van vhbportaal.com zelf (nooit van
 * Google), de smalle opmaak (minder marge, knop over de volle breedte) lezen
 * Apple Mail en de Gmail-app, de rest valt terug op de systeemletter en de
 * brede opmaak. Elk <style>-blok staat apart, want Gmail gooit een heel blok
 * weg als het één regel niet kent.
 *
 * Voorbeeldregel: de tekst die de inbox naast het onderwerp toont staat
 * verborgen bovenaan (`voorbeeld`, anders de eerste alinea), gevolgd door
 * lege tekens, zodat de inbox niet "VERLOF Verlofaanvraag afgewezen Hallo
 * Jan," toont.
 *
 * Tekstversie: dezelfde opbouw in platte tekst, zodat wie HTML uitzet (of
 * een spamfilter dat de tekst leest) hetzelfde krijgt.
 *
 * Alle teksten worden hier ge-escaped; wie bewust HTML wil (bv. een
 * <pre>-blok met een commando) gebruikt `html` in een alinea. Geen em dash
 * als zinsscheiding (CLAUDE.md), ook niet in de vaste teksten hier.
 *
 * Kleurenschema: de mail is licht ontworpen en zegt dat ook (`color-scheme`
 * en `supported-color-schemes` = light), zodat clients die het respecteren
 * (Apple Mail) hem niet zelf omkeren. Gmail en Outlook negeren dat; daar
 * vangt de tegel achter het logo het op.
 */

/** Het palet van het portaal (src/index.css), op wit. */
export const MAIL_KLEUR = {
  carbon: "#0D0D0F",
  /** Titels en waarden (slate-900). */
  inkt: "#14181B",
  /** Lopende tekst (slate-700). */
  tekst: "#2C3137",
  /** Labels en voetregels (slate-500, 5,25:1 op wit). */
  gedempt: "#656D76",
  /** Fijne lijnen (slate-200). */
  hairline: "#E4E6E8",
  /** De rand van een label zoals "PDF" (slate-300). */
  regel: "#CDD1D5",
  /** Het vlak achter de feiten (slate-50). */
  vlak: "#F7F8F8",
  /** De hoofdknop, zoals .btn-primary in het portaal (oker-500). */
  goud: "#E2A323",
  /** De binnenrand van .btn-primary, uitgerekend op goud. */
  goudRand: "#C58B1D",
  wit: "#FFFFFF",
} as const;

/** Status als pil naast het label: vlak, tekst en stip uit het portaal-palet. */
export const STATUS_KLEUR = {
  neutraal: { vlak: "#F2F3F4", tekst: "#4F575F", stip: "#9AA1A9" },
  goed: { vlak: "#EEF6F1", tekst: "#1A6650", stip: "#2E9E78" },
  aandacht: { vlak: "#FCF7ED", tekst: "#8F5C17", stip: "#E2A323" },
  fout: { vlak: "#FAEEF1", tekst: "#8B344A", stip: "#C94F6D" },
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

/** Een opsomming. `tag` staat vóór elk item (bv. "PDF" bij bijlagen);
 *  `technisch` zet de items klein in een vaste breedte (foutmeldingen). */
export interface MailLijst {
  kop?: string;
  items: string[];
  tag?: string;
  technisch?: boolean;
}

/** De inhoud onder de aanhef, in de volgorde van `volgorde`. */
export type MailSectie = "alineas" | "feiten" | "lijsten" | "blok";
const STANDAARD_VOLGORDE: readonly MailSectie[] = ["alineas", "feiten", "lijsten", "blok"];

export interface MailOpbouw {
  /** Klein label boven de titel, bv. "VERLOF" of "SYSTEEM". */
  kicker?: string;
  /** De kop van de mail. */
  titel: string;
  /** Uitkomst als pil naast het label, bv. { label: "Goedgekeurd", toon: "goed" }. */
  status?: { label: string; toon: MailStatusToon };
  /** Wat de inbox naast het onderwerp toont; zonder: de eerste alinea. */
  voorbeeld?: string;
  /** "Hallo Jan," */
  aanhef?: string;
  /** Alinea's onder de aanhef. */
  alineas?: MailAlinea[];
  /** Kerngegevens als label/waarde, bv. Periode, Type. */
  feiten?: Array<{ label: string; waarde: string }>;
  /** Klein kopje boven de feiten, bv. "Afgelopen 7 dagen". */
  feitenKop?: string;
  /** Opsomming, bv. openstaande diensten of foutsoorten. */
  lijst?: MailLijst;
  /** Extra opsommingen ná de eerste (digest). */
  lijsten?: MailLijst[];
  /** Blok met kop, in een vlak met een gouden streep links, bv. de reden van een afwijzing (regeleinden blijven). */
  blok?: { kop: string; tekst: string };
  /** Volgorde van alinea's, feiten, lijsten en blok; standaard in die volgorde. */
  volgorde?: MailSectie[];
  /** Eén knop, goud. `actie`: de knop voert iets uit met een eenmalige link
   *  (wachtwoord instellen, adres bevestigen) in plaats van een scherm van
   *  het portaal te openen; de iPhone-regel eronder past zich daaraan aan. */
  knop?: { tekst: string; url: string; actie?: boolean };
  /** Kleine tekst onder de knop. */
  voet?: string;
  /** "beheer": systeemmail voor admins, zonder iPhone-regel en met een
   *  kortere voetregel (wie hem leest ís de planning). Standaard "medewerker". */
  doelgroep?: "medewerker" | "beheer";
  /** Vaste voetregel; standaard "niet beantwoorden". `false` laat de regel weg. */
  nietBeantwoorden?: boolean;
  /** Publieke basis-URL van het portaal (voor logo, letter en voet). */
  portaalUrl: string;
}

/**
 * Onder elke knop, in de stijl van de voetregels (nr. 16): op een iPhone
 * opent een link uit de mail altijd in Safari, nooit in de app op het
 * beginscherm, en daar is de gebruiker niet aangemeld. Technisch niet op te
 * lossen, dus zeggen we het. Een knop met een eenmalige link (`actie`) moet
 * wél gevolgd worden; daar zegt de regel waar je daarna verder gaat.
 */
export const IPHONE_REGEL = {
  portaal: "Op iPhone open je beter de app op je beginscherm, daar ben je al aangemeld.",
  actie: "Op iPhone opent deze knop in Safari, ga daarna verder in de app op je beginscherm.",
} as const;
const iphoneRegel = (knop: NonNullable<MailOpbouw["knop"]>) => (knop.actie ? IPHONE_REGEL.actie : IPHONE_REGEL.portaal);

/** Vaste voetregels. */
export const VOET = {
  bedrijf: "VHB · Van Hoorebeke & Zoon",
  medewerker: "Automatisch bericht van het VHB Portaal, niet beantwoorden. Vragen? Contacteer de planning.",
  beheer: "Automatisch bericht van het VHB Portaal, niet beantwoorden.",
} as const;

/** Binnenmarge van de knop; op de link én (voor Outlook) op de cel. */
const KNOP_MARGE = "13px 24px";

const LETTER = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const KOPLETTER = `Manrope, ${LETTER}`;
const VASTE_LETTER = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Zelfde bestanden en tekenbereiken als de @font-face-regels van het portaal
 *  (src/index.css); de server geeft ze met Access-Control-Allow-Origin: *. */
const MANROPE = [
  { bestand: "manrope-latin.woff2", bereik: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  { bestand: "manrope-latin-ext.woff2", bereik: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
] as const;

const K = MAIL_KLEUR;

const P = (inhoud: string, extra = "") =>
  `<p style="margin: 0 0 14px; font-size: 15px; line-height: 24px; color: ${K.tekst};${extra}">${inhoud}</p>`;

/** Klein kopje in hoofdletters, voor feiten, lijsten en blok. De hoofdletters
 *  komen uit CSS: in de bron blijft "Bericht van Els Goossens" gewoon leesbaar
 *  (schermlezer, kopiëren), ook Outlook kent text-transform. */
const kopHtml = (kop: string, marge = "22px 0 8px") =>
  `<p style="margin: ${marge}; font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: ${K.gedempt};">${escapeMailHtml(kop)}</p>`;

// Een regeleinde in een gewone alinea blijft een regeleinde (eigen mail van
// een admin, meerregelige omschrijving).
const alineaHtml = (a: MailAlinea) => (typeof a === "string" ? P(escapeMailHtml(a).replace(/\n/g, "<br>")) : a.html);
const alineaTekst = (a: MailAlinea) => (typeof a === "string" ? a : a.tekst);

const lijstHtml = (l: MailLijst) => {
  if (l.items.length === 0) return "";
  const letter = l.technisch
    ? `font-family: ${VASTE_LETTER}; font-size: 12px; line-height: 18px; color: ${K.tekst};`
    : `font-size: 14px; line-height: 20px; color: ${K.tekst};`;
  const rijen = l.items.map((item, i) => {
    const lijn = `border-top: 1px solid ${K.hairline};${i === l.items.length - 1 ? ` border-bottom: 1px solid ${K.hairline};` : ""}`;
    const tag = l.tag
      ? `<td width="48" style="${lijn} padding: 10px 0 8px; width: 48px; vertical-align: top;"><span style="display: inline-block; padding: 0 5px; border: 1px solid ${K.regel}; border-radius: 4px; font-size: 10px; line-height: 16px; font-weight: 700; letter-spacing: 0.6px; color: ${K.gedempt};">${escapeMailHtml(l.tag.toUpperCase())}</span></td>`
      : "";
    return `<tr>${tag}<td style="${lijn} padding: 9px 0; ${letter} vertical-align: top; word-break: break-word; overflow-wrap: anywhere;">${escapeMailHtml(item)}</td></tr>`;
  }).join("\n");
  return `${l.kop ? kopHtml(l.kop) : ""}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 18px; border-collapse: collapse;">
${rijen}
</table>`;
};
const lijstTekst = (l: MailLijst) =>
  l.items.length === 0 ? "" : `${l.kop ? `${l.kop}\n` : ""}${l.items.map((i) => `- ${i}`).join("\n")}`;

/** Bouwt de HTML- en tekstversie van een mail uit één opbouw. */
export function bouwMail(o: MailOpbouw): { html: string; text: string } {
  const basis = o.portaalUrl.replace(/\/$/, "");
  const logo = `${basis}/mail/vhb-logo.png`;
  const lijsten = [...(o.lijst ? [o.lijst] : []), ...(o.lijsten ?? [])];
  const beheer = o.doelgroep === "beheer";
  const nietBeantwoorden = o.nietBeantwoorden !== false;
  const volgorde = o.volgorde ?? STANDAARD_VOLGORDE;
  const eersteAlinea = (o.alineas ?? []).map(alineaTekst).find((t) => t.trim() !== "");
  const voorbeeld = (o.voorbeeld ?? eersteAlinea ?? o.status?.label ?? "").replace(/\s+/g, " ").trim();

  const kicker = o.kicker
    ? `<td style="padding: 0 10px 0 0; font-size: 11px; line-height: 22px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: ${K.gedempt}; white-space: nowrap;">${escapeMailHtml(o.kicker)}</td>`
    : "";
  const t = o.status ? STATUS_KLEUR[o.status.toon] : null;
  const pil = o.status && t
    ? `<td style="padding: 0;"><span style="display: inline-block; padding: 2px 10px 2px 8px; border-radius: 11px; background-color: ${t.vlak}; font-size: 12px; line-height: 18px; font-weight: 600; color: ${t.tekst};"><span style="color: ${t.stip}; font-size: 10px;">&#9679;</span>&nbsp;&nbsp;${escapeMailHtml(o.status.label)}</span></td>`
    : "";
  const labelRij = kicker || pil
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 12px;"><tr>${kicker}${pil}</tr></table>`
    : "";

  const feiten = o.feiten && o.feiten.length > 0
    ? `${o.feitenKop ? kopHtml(o.feitenKop, "4px 0 8px") : ""}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: ${o.feitenKop ? "0" : "4px"} 0 20px; border-collapse: separate; border-spacing: 0; background-color: ${K.vlak}; border: 1px solid ${K.hairline}; border-radius: 12px;">
${o.feiten.map((f, i) => {
    const lijn = i > 0 ? `border-top: 1px solid ${K.hairline}; ` : "";
    return `<tr>
  <td class="vhb-feit" width="30%" style="${lijn}padding: 11px 12px 11px 16px; width: 30%; font-size: 13px; line-height: 20px; color: ${K.gedempt}; vertical-align: top;">${escapeMailHtml(f.label)}</td>
  <td style="${lijn}padding: 11px 16px 11px 0; font-size: 14px; line-height: 20px; font-weight: 600; color: ${K.inkt}; vertical-align: top;">${escapeMailHtml(f.waarde)}</td>
</tr>`;
  }).join("\n")}
</table>`
    : "";
  // Het blok houdt zijn vlak met de gouden streep links (Jarno 30-09: "de
  // redenmarkering zoals het nu is"), het enige goud in de mail naast knop en logo.
  const blok = o.blok
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 4px 0 20px; border-collapse: collapse;"><tr><td style="padding: 14px 18px; background-color: ${K.vlak}; border-left: 3px solid ${K.goud}; border-radius: 8px;">
  ${kopHtml(o.blok.kop, "0 0 4px")}
  <p style="margin: 0; font-size: 15px; line-height: 24px; color: ${K.inkt}; white-space: pre-wrap;">${escapeMailHtml(o.blok.tekst)}</p>
</td></tr></table>`
    : "";
  const sectieHtml: Record<MailSectie, string> = {
    alineas: (o.alineas ?? []).map(alineaHtml).join("\n  "),
    feiten,
    lijsten: lijsten.map(lijstHtml).join("\n  "),
    blok,
  };

  // Outlook op Windows (Word-motor) negeert padding op een <a>: de knop was
  // daar een vlak strak om de tekst. De marge staat daarom óók op de cel,
  // als `mso-padding-alt` (alleen Outlook leest dat), met de achtergrond op
  // de cel (`bgcolor` + stijl). Andere clients houden de padding op de link
  // zelf, zodat de hele knop aanklikbaar blijft en er niets verschuift. Goud
  // met inkt, zoals .btn-primary: wit op goud haalt maar 2,2:1.
  const knop = o.knop
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="vhb-knop" style="margin: 10px 0 12px;"><tr><td align="center" bgcolor="${K.goud}" style="background-color: ${K.goud}; border: 1px solid ${K.goudRand}; border-radius: 10px; mso-padding-alt: ${KNOP_MARGE};">
  <a href="${escapeMailHtml(o.knop.url)}" class="vhb-knop-link" style="display: inline-block; padding: ${KNOP_MARGE}; mso-padding-alt: 0; font-size: 15px; line-height: 20px; font-weight: 700; color: ${K.inkt}; text-decoration: none; border-radius: 10px;">${escapeMailHtml(o.knop.tekst)}</a>
</td></tr></table>${beheer ? "" : `
  <p style="margin: 0 0 6px; font-size: 12px; line-height: 18px; color: ${K.gedempt};">${escapeMailHtml(iphoneRegel(o.knop))}</p>`}`
    : "";
  const voet = o.voet ? `<p style="margin: 0 0 6px; font-size: 12px; line-height: 18px; color: ${K.gedempt};">${escapeMailHtml(o.voet)}</p>` : "";
  const melding = nietBeantwoorden ? (beheer ? VOET.beheer : VOET.medewerker) : "";
  const voetregels = [
    `<span style="font-weight: 600; color: ${K.tekst};">VHB</span> &middot; Van Hoorebeke &amp; Zoon`,
    melding ? escapeMailHtml(melding) : "",
    `<a href="${escapeMailHtml(o.portaalUrl)}" style="color: ${K.gedempt}; text-decoration: underline;">${escapeMailHtml(o.portaalUrl.replace(/^https?:\/\//, ""))}</a>`,
  ].filter(Boolean);

  // Lege tekens na de voorbeeldregel, zodat de inbox daarna niet de rest van
  // de mail ("VERLOF Verlofaanvraag …") als voorbeeld aanvult.
  const voorbeeldHtml = voorbeeld
    ? `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: ${K.wit}; opacity: 0;">${escapeMailHtml(voorbeeld)}${"&#847;&zwnj;&nbsp;".repeat(90)}</div>\n`
    : "";

  const html = `<!DOCTYPE html>
<html lang="nl" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeMailHtml(o.titel)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if mso]><style>body, table, td, p, a, h1, span { font-family: 'Segoe UI', Arial, sans-serif !important; }</style><![endif]-->
<style>
@media screen {
${MANROPE.map((f) => `  @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 500 800; font-display: swap; src: url('${basis}/fonts/${f.bestand}') format('woff2'); unicode-range: ${f.bereik}; }`).join("\n")}
}
</style>
<style>
@media only screen and (max-width: 520px) {
  .vhb-kolom { padding-left: 20px !important; padding-right: 20px !important; }
  .vhb-logo { padding: 20px 12px 0 !important; }
  .vhb-titel { font-size: 23px !important; line-height: 29px !important; }
  .vhb-knop { width: 100% !important; }
  .vhb-knop-link { display: block !important; }
  .vhb-feit { width: 38% !important; }
}
</style>
<style>
a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
</style>
</head>
<body style="margin: 0; padding: 0; width: 100%; background-color: ${K.wit}; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
${voorbeeldHtml}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${K.wit};">
<tr><td align="center" style="padding: 0;">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 600px; font-family: ${LETTER};">
<tr><td class="vhb-logo" style="padding: 32px 32px 0;">
  <img src="${logo}" width="160" height="45" alt="VHB, Van Hoorebeke &amp; Zoon" style="display: block; width: 160px; height: auto; border: 0;">
</td></tr>
<tr><td class="vhb-kolom" style="padding: 28px 40px 8px;">
  ${labelRij}
  <h1 class="vhb-titel" style="margin: 0 0 16px; font-family: ${KOPLETTER}; font-size: 26px; line-height: 32px; font-weight: 800; letter-spacing: -0.4px; color: ${K.inkt};">${escapeMailHtml(o.titel)}</h1>
  ${o.aanhef ? P(escapeMailHtml(o.aanhef)) : ""}
  ${volgorde.map((s) => sectieHtml[s]).filter(Boolean).join("\n  ")}
  ${knop}
  ${voet}
</td></tr>
<tr><td class="vhb-kolom" style="padding: 20px 40px 40px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding: 20px 0 0; border-top: 1px solid ${K.hairline}; font-size: 12px; line-height: 19px; color: ${K.gedempt};">
  ${voetregels.join("<br>\n  ")}
  </td></tr></table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  // Tekstversie: dezelfde secties in dezelfde volgorde, gescheiden door een witregel.
  const sectieTekst: Record<MailSectie, string[]> = {
    alineas: (o.alineas ?? []).map(alineaTekst),
    feiten: o.feiten && o.feiten.length > 0 ? [`${o.feitenKop ? `${o.feitenKop}\n` : ""}${o.feiten.map((f) => `${f.label}: ${f.waarde}`).join("\n")}`] : [],
    lijsten: lijsten.map(lijstTekst),
    blok: o.blok ? [`${o.blok.kop}: ${o.blok.tekst}`] : [],
  };
  const secties: string[] = [
    [o.kicker ? o.kicker.toUpperCase() : "", o.titel, o.status ? `Status: ${o.status.label}` : ""].filter(Boolean).join("\n"),
    o.aanhef ?? "",
    ...volgorde.flatMap((s) => sectieTekst[s]),
    o.knop ? `${o.knop.tekst}: ${o.knop.url}${beheer ? "" : `\n${iphoneRegel(o.knop)}`}` : "",
    o.voet ?? "",
    [VOET.bedrijf, melding, o.portaalUrl].filter(Boolean).join("\n"),
  ];
  const text = secties.filter((r) => r.trim() !== "").join("\n\n");

  return { html, text };
}
