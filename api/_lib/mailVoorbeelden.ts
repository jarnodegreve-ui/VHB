import { mailOpbouw, portalUrl } from "../email.js";

/**
 * Voorbeeld van elke mailsoort voor Beheer › Mails: dezelfde lay-out en
 * dezelfde opbouw als de echte mail, met vaste voorbeeldgegevens. Bewust
 * los van de echte verzendfuncties (die hebben records nodig); de tekst is
 * een spiegel van wat api/email.ts en de routes bouwen.
 */
export const voorbeeldMail = (soort: string): { onderwerp: string; html: string; text: string } | null => {
  const url = portalUrl();
  switch (soort) {
    case "welkom": {
      const m = mailOpbouw({
        kicker: "Welkom",
        titel: "Je account op het VHB Portaal",
        aanhef: "Hallo Sofie,",
        alineas: ["Er is een account voor je aangemaakt op het VHB Portaal. Daar vind je je rooster, verlofaanvragen, dienstruilen en updates van de planning. Je logt in met dit e-mailadres."],
        knop: { tekst: "Wachtwoord instellen", url },
        voet: `Tip: open ${url} op je telefoon en kies "Zet op beginscherm", dan werkt het portaal als app.`,
      });
      return { onderwerp: "Welkom op het VHB Portaal, stel je wachtwoord in", ...m };
    }
    case "wachtwoord": {
      const m = mailOpbouw({
        kicker: "Wachtwoord",
        titel: "Nieuw wachtwoord instellen",
        aanhef: "Hallo,",
        alineas: ["Je vroeg een nieuw wachtwoord aan voor het VHB Portaal. Kies er hieronder een; je huidige wachtwoord blijft werken tot je dat doet."],
        knop: { tekst: "Nieuw wachtwoord kiezen", url },
        voet: "De link werkt één uur en is eenmalig. Vroeg je dit niet aan? Dan kun je deze mail negeren, er verandert niets aan je account.",
      });
      return { onderwerp: "VHB Portaal: nieuw wachtwoord instellen", ...m };
    }
    case "verlof-beslissing": {
      const m = mailOpbouw({
        kicker: "Verlof",
        titel: "Verlofaanvraag afgewezen",
        status: { label: "Afgewezen", toon: "fout" },
        aanhef: "Hallo Jan,",
        alineas: ["Je verlofaanvraag is afgewezen door Els Goossens."],
        feiten: [{ label: "Periode", waarde: "06/10/2026 t/m 10/10/2026" }, { label: "Type", waarde: "Betaald verlof" }, { label: "Beslist door", waarde: "Els Goossens" }],
        blok: { kop: "Reden", tekst: "Die week zijn er al te veel collega's vrij. Probeer de week erna." },
        knop: { tekst: "Bekijk in het portaal", url: `${url}/verlof` },
      });
      return { onderwerp: "Verlofaanvraag afgewezen, 06/10/2026 t/m 10/10/2026", ...m };
    }
    case "ziekmelding": {
      const m = mailOpbouw({
        kicker: "Ziekmelding",
        titel: "Dirk Maes is ziek gemeld",
        status: { label: "Afwezig", toon: "aandacht" },
        alineas: ["De diensten hieronder staan nu als onbeschikbaar in de Maandplanning en Dekking."],
        feiten: [{ label: "Chauffeur", waarde: "Dirk Maes" }, { label: "Periode", waarde: "02/09/2026 t/m 03/09/2026" }, { label: "Gemeld door", waarde: "Els Goossens" }],
        lijst: { kop: "Openstaande dienst(en)", items: ["wo 2 sep, 4407", "do 3 sep, 4408"] },
        knop: { tekst: "Open Vandaag", url: `${url}/vandaag` },
      });
      return { onderwerp: "Ziekmelding, Dirk Maes (02/09/2026 t/m 03/09/2026)", ...m };
    }
    case "dringende-update": {
      const m = mailOpbouw({
        kicker: "Dringende update",
        titel: "Onderhoud aan boordcomputers",
        status: { label: "Dringend, lees dit vandaag", toon: "aandacht" },
        alineas: ["Alle bussen krijgen dit weekend een software-update. Laat de bus na je dienst aan de laadpaal staan."],
        knop: { tekst: "Open de update", url: `${url}/updates` },
        voet: "Bevestig in het portaal met de knop \"Gelezen en begrepen\".",
      });
      return { onderwerp: "Dringende update: Onderhoud aan boordcomputers", ...m };
    }
    case "vervaldatum": {
      const m = mailOpbouw({
        kicker: "Herinnering",
        titel: "Je code 95 verloopt over 30 dagen",
        status: { label: "Tijdig regelen", toon: "aandacht" },
        aanhef: "Hallo Dirk,",
        alineas: ["Regel de vernieuwing tijdig en geef de nieuwe datum door aan de planning, dan blijf je zonder onderbreking inzetbaar."],
        feiten: [{ label: "Document", waarde: "Code 95" }, { label: "Geldig tot", waarde: "25/10/2026" }],
        knop: { tekst: "Open het portaal", url },
      });
      return { onderwerp: "Herinnering: je code 95 verloopt over 30 dagen", ...m };
    }
    case "weekoverzicht": {
      const m = mailOpbouw({
        kicker: "Systeem",
        titel: "Weekoverzicht van het portaal",
        status: { label: "3 meldingen, 2 toestellen", toon: "aandacht" },
        alineas: ["In de afgelopen 7 dagen: 3 meldingen van 2 toestellen (2 unieke soorten)."],
        lijsten: [
          { kop: "Meldingen", items: ["2× [error-toast] Kon planning niet laden (/)", "1× [window.onerror] TypeError: x is undefined (/rooster)"] },
          { kop: "Cijfers van de afgelopen 7 dagen", items: ["Actieve gebruikers: 31", "Verlof: 4 nieuw, 3 beslist, 2 open", "Dienstruil: 2 nieuw, 1 uitgevoerd, 1 open"] },
          { kop: "Documenten (binnen 60 dagen)", items: ["Dirk Maes, Code 95 verloopt over 12 dagen (07/10/2026)"] },
        ],
        knop: { tekst: "Open Systeemstatus", url: `${url}/beheer/systeemstatus` },
        voet: "Details staan in het portaal onder Systeemstatus en in de Vercel-logs.",
      });
      return { onderwerp: "Weekoverzicht portaal: 3 meldingen, 2 toestellen", ...m };
    }
    case "testmail": {
      const m = mailOpbouw({
        kicker: "Systeem",
        titel: "Testmail van het portaal",
        status: { label: "Mailinstellingen werken", toon: "goed" },
        alineas: ["Deze testmail bevestigt dat het portaal mails kan versturen. Komt ze in je spam-map terecht, controleer dan de domeinverificatie bij de mailprovider."],
        feiten: [{ label: "Afzender", waarde: "\"VHB Portaal\" <noreply@vhbportaal.com>" }, { label: "Antwoordadres", waarde: "geen (niet beantwoorden)" }, { label: "Verstuurd op", waarde: "25/09/2026 14:02" }],
      });
      return { onderwerp: "Testmail van het VHB Portaal", ...m };
    }
    case "backup-integriteit": {
      const m = mailOpbouw({
        kicker: "Back-up",
        titel: "Back-up faalde de integriteitscheck",
        status: { label: "Controleer de portaal-data", toon: "fout" },
        alineas: ["De back-up vhb-backup-2026-09-25.json is opgeslagen, maar de integriteitscheck vond problemen. Controleer of de portaal-data compleet is."],
        lijst: { kop: "Bevindingen", items: ["collectie users is leeg", "geen admin-account in de export"] },
      });
      return { onderwerp: "Back-up-integriteit: controleer vhb-backup-2026-09-25.json", ...m };
    }
    case "backup-weekkopie": {
      const m = mailOpbouw({
        kicker: "Back-up",
        titel: "Wekelijkse back-up 2026-09-27",
        status: { label: "Versleuteld, bewaar buiten Supabase en Vercel", toon: "neutraal" },
        alineas: [
          "In bijlage de wekelijkse off-site kopie van de portaal-back-up, AES-256-versleuteld. Bewaar deze mail buiten Supabase en Vercel.",
          "Ontsleutelen (vraagt om de wachtwoordzin uit je wachtwoordmanager):",
          { html: `<pre style="margin: 0 0 14px; padding: 12px 14px; background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; font-size: 12px; white-space: pre-wrap;">openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in vhb-backup-2026-09-27.json.enc -out vhb-backup-2026-09-27.json</pre>`, tekst: "  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in vhb-backup-2026-09-27.json.enc -out vhb-backup-2026-09-27.json" },
          "Zie ook docs/RESTORE.md in de repo.",
        ],
      });
      return { onderwerp: "Wekelijkse back-up 2026-09-27, versleuteld", ...m };
    }
    case "restore-proef": {
      const m = mailOpbouw({
        kicker: "Back-up",
        titel: "Restore-proef gefaald",
        status: { label: "Controleer de back-ups zo snel mogelijk", toon: "fout" },
        alineas: ["De maandelijkse restore-proef van vhb-backup-2026-09-30.json vond problemen. Dit is je herstelpad, dus controleer de back-ups zo snel mogelijk."],
        lijst: { kop: "Bevindingen", items: ["teruglezen mislukt: Unexpected end of JSON input"] },
      });
      return { onderwerp: "Restore-proef gefaald, vhb-backup-2026-09-30.json", ...m };
    }
    default:
      return null;
  }
};
