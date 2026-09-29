import { mailOpbouw, portalUrl, type MailTekst } from "../email.js";
import type { MailStatusToon } from "./mailLayout.js";

/**
 * De teksten van de mails die een route of een cron opbouwt (nr. 34, 29-09):
 * één bouwer per mail, gebruikt door de route die hem verstuurt én door het
 * voorbeeld in Beheer › Mails (mailVoorbeelden.ts). Vroeger stond elke tekst
 * twee keer, in de route en als handgeschreven kopie in de voorbeelden, en
 * liepen die stil uit elkaar. De drie mails met een eigen verzendfunctie
 * (verlofbeslissing, welkom, vervaldatum) hebben hun bouwer in api/email.ts;
 * src/mailVoorbeelden.test.ts bewaakt dat geen route of voorbeeld nog zelf
 * een mail opbouwt.
 *
 * Een bouwer is puur: hij krijgt de gegevens en geeft onderwerp, HTML en
 * tekst terug. Ontvangers, logregel en verzending blijven in de route.
 */

/** Ziekmelding aan planners en admins. De medische toelichting gaat bewust
 *  niet mee (mailtranche 25-09); `openDiensten` = "do 6 aug, 4407". */
export const bouwZiekmeldingMail = (o: { naam: string; periode: string; gemeldDoor: string; openDiensten: string[] }): MailTekst => {
  const { html, text } = mailOpbouw({
    kicker: "Ziekmelding",
    titel: `${o.naam} is ziek gemeld`,
    status: { label: "Afwezig", toon: "aandacht" },
    alineas: o.openDiensten.length > 0
      ? ["De diensten hieronder staan nu als onbeschikbaar in de Maandplanning en Dekking."]
      : ["Geen ingeplande diensten in deze periode."],
    feiten: [
      { label: "Chauffeur", waarde: o.naam },
      { label: "Periode", waarde: o.periode },
      { label: "Gemeld door", waarde: o.gemeldDoor },
    ],
    ...(o.openDiensten.length > 0 ? { lijst: { kop: "Openstaande dienst(en)", items: o.openDiensten } } : {}),
    knop: { tekst: "Open Vandaag", url: `${portalUrl()}/vandaag` },
  });
  return { onderwerp: `Ziekmelding, ${o.naam} (${o.periode})`, html, text };
};

/** Dringende update aan alle actieve gebruikers; `doelPad` = het bericht zelf
 *  zodra er een id is (begint met een schuine streep). */
export const bouwDringendeUpdateMail = (o: { titel: string; inhoud: string; doelPad: string }): MailTekst => {
  const { html, text } = mailOpbouw({
    kicker: "Dringende update",
    titel: o.titel,
    status: { label: "Dringend, lees dit vandaag", toon: "aandacht" },
    // Regeleinden uit het bericht blijven alinea's.
    alineas: o.inhoud.split(/\n{2,}/).map((a) => a.trim()).filter(Boolean),
    knop: { tekst: "Open de update", url: `${portalUrl()}${o.doelPad}` },
    voet: "Bevestig in het portaal met de knop \"Gelezen en begrepen\".",
  });
  return { onderwerp: `Dringende update: ${o.titel}`, html, text };
};

/** Week- of dagoverzicht (de digest). Neutrale toon, bewust zonder
 *  waarschuwingsteken (verzoek Jarno, 02-08): dit is een overzicht dat élke
 *  week komt, geen alarm. `impact` staat in de onderwerpregel. */
export const bouwOverzichtMail = (o: {
  naam: "weekoverzicht" | "dagoverzicht";
  impact: string;
  toon: MailStatusToon;
  alineas: string[];
  lijsten: Array<{ kop?: string; items: string[] }>;
}): MailTekst => {
  const Overzicht = `${o.naam[0].toUpperCase()}${o.naam.slice(1)}`;
  const { html, text } = mailOpbouw({
    kicker: "Systeem",
    titel: `${Overzicht} van het portaal`,
    status: { label: o.impact, toon: o.toon },
    alineas: o.alineas,
    lijsten: o.lijsten,
    // Zelfde vorm als viewUrl("beheer-debug") in collectie.ts; hier
    // uitgeschreven zodat de bouwers niets van de routes hoeven te laden.
    knop: { tekst: "Open Systeemstatus", url: `${portalUrl()}/?view=beheer-debug` },
    voet: "Details staan in het portaal onder Systeemstatus en in de Vercel-logs.",
  });
  return { onderwerp: `${Overzicht} portaal: ${o.impact}`, html, text };
};

/** Testmail naar de admin zelf; toont de gebruikte afzender. */
export const bouwTestMail = (o: { afzender: string; antwoordadres?: string; verstuurdOp: string }): MailTekst => {
  const { html, text } = mailOpbouw({
    kicker: "Systeem",
    titel: "Testmail van het portaal",
    status: { label: "Mailinstellingen werken", toon: "goed" },
    alineas: ["Deze testmail bevestigt dat het portaal mails kan versturen. Komt ze in je spam-map terecht, controleer dan de domeinverificatie bij de mailprovider."],
    feiten: [
      { label: "Afzender", waarde: o.afzender },
      { label: "Antwoordadres", waarde: o.antwoordadres ?? "geen (niet beantwoorden)" },
      { label: "Verstuurd op", waarde: o.verstuurdOp },
    ],
  });
  return { onderwerp: "Testmail van het VHB Portaal", html, text };
};

/** De nachtelijke back-up haalde de integriteitscheck niet. */
export const bouwBackupIntegriteitMail = (o: { filename: string; bevindingen: string[] }): MailTekst => {
  const { html, text } = mailOpbouw({
    kicker: "Back-up",
    titel: "Back-up faalde de integriteitscheck",
    status: { label: "Controleer de portaal-data", toon: "fout" },
    alineas: [`De back-up ${o.filename} is opgeslagen, maar de integriteitscheck vond problemen. Controleer of de portaal-data compleet is.`],
    lijst: { kop: "Bevindingen", items: o.bevindingen },
  });
  return { onderwerp: `Back-up-integriteit: controleer ${o.filename}`, html, text };
};

/** Wekelijkse off-site kopie, versleuteld als bijlage. `dag` = de dag van de
 *  export zoals hij in de mail staat; de bestandsnaam houdt zijn eigen vorm. */
export const bouwBackupWeekkopieMail = (o: { filename: string; dag: string }): MailTekst => {
  const commando = `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ${o.filename}.enc -out ${o.filename}`;
  const { html, text } = mailOpbouw({
    kicker: "Back-up",
    titel: `Wekelijkse back-up ${o.dag}`,
    status: { label: "Versleuteld, bewaar buiten Supabase en Vercel", toon: "neutraal" },
    alineas: [
      "In bijlage de wekelijkse off-site kopie van de portaal-back-up, AES-256-versleuteld. Bewaar deze mail buiten Supabase en Vercel.",
      "Ontsleutelen (vraagt om de wachtwoordzin uit je wachtwoordmanager):",
      { html: `<pre style="margin: 0 0 14px; padding: 12px 14px; background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; font-size: 12px; white-space: pre-wrap;">${commando.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`, tekst: `  ${commando}` },
      "Zie ook docs/RESTORE.md in de repo.",
    ],
  });
  return { onderwerp: `Wekelijkse back-up ${o.dag}, versleuteld`, html, text };
};

/** De maandelijkse restore-proef vond problemen. */
export const bouwRestoreProefMail = (o: { filename: string | null | undefined; bevindingen: string[] }): MailTekst => {
  const { html, text } = mailOpbouw({
    kicker: "Back-up",
    titel: "Restore-proef gefaald",
    status: { label: "Controleer de back-ups zo snel mogelijk", toon: "fout" },
    alineas: [`De maandelijkse restore-proef${o.filename ? ` van ${o.filename}` : ""} vond problemen. Dit is je herstelpad, dus controleer de back-ups zo snel mogelijk.`],
    lijst: { kop: "Bevindingen", items: o.bevindingen },
  });
  return { onderwerp: `Restore-proef gefaald${o.filename ? `, ${o.filename}` : ""}`, html, text };
};

/** Wachtwoord vergeten: Supabase verstuurt hem (scripts/auth-mails.mjs bouwt
 *  de template, `recovery`); dit is dezelfde tekst voor het voorbeeld.
 *  src/mailVoorbeelden.test.ts houdt de twee tegen elkaar. */
export const bouwWachtwoordMail = (o: { link: string }): MailTekst => {
  const { html, text } = mailOpbouw({
    kicker: "Wachtwoord",
    titel: "Nieuw wachtwoord instellen",
    aanhef: "Hallo,",
    alineas: ["Je vroeg een nieuw wachtwoord aan voor het VHB Portaal. Kies er hieronder een; je huidige wachtwoord blijft werken tot je dat doet."],
    knop: { tekst: "Nieuw wachtwoord kiezen", url: o.link, actie: true },
    voet: "De link werkt één uur en is eenmalig. Vroeg je dit niet aan? Dan kun je deze mail negeren, er verandert niets aan je account.",
  });
  return { onderwerp: "VHB Portaal: nieuw wachtwoord instellen", html, text };
};
