import { bouwVerlofBeslissingMail, bouwVervaldatumMail, bouwWelkomMail, portalUrl, type MailTekst } from "../email.js";
import { bouwBackupIntegriteitMail, bouwBackupWeekkopieMail, bouwDringendeUpdateMail, bouwOverzichtMail, bouwRestoreProefMail, bouwTestMail, bouwWachtwoordMail, bouwZiekmeldingMail } from "./mailTeksten.js";

/**
 * Voorbeeld van elke mailsoort voor Beheer › Mails: de échte bouwer van die
 * mail (api/email.ts en mailTeksten.ts), met vaste voorbeeldgegevens. Hier
 * staat dus geen mailtekst meer, alleen de gegevens; vroeger was dit een
 * handgeschreven spiegel van de echte teksten en liep die stil achter
 * (nr. 34). src/mailVoorbeelden.test.ts bewaakt dat het zo blijft.
 */
export const voorbeeldMail = (soort: string): MailTekst | null => {
  const url = portalUrl();
  switch (soort) {
    case "welkom":
      return bouwWelkomMail({ name: "Sofie", actionLink: url });
    case "wachtwoord":
      return bouwWachtwoordMail({ link: url });
    case "verlof-beslissing":
      return bouwVerlofBeslissingMail({
        recipientName: "Jan",
        decidedByName: "Els Goossens",
        typeLabel: "Betaald verlof",
        startDate: "2026-10-06",
        endDate: "2026-10-10",
        action: "rejected",
        reden: "Die week zijn er al te veel collega's vrij. Probeer de week erna.",
      });
    case "ziekmelding":
      return bouwZiekmeldingMail({ naam: "Dirk Maes", periode: "02/09/2026 t/m 03/09/2026", gemeldDoor: "Els Goossens", openDiensten: ["wo 2 sep, 4407", "do 3 sep, 4408"] });
    case "dringende-update":
      return bouwDringendeUpdateMail({
        titel: "Onderhoud aan boordcomputers",
        inhoud: "Alle bussen krijgen dit weekend een software-update. Laat de bus na je dienst aan de laadpaal staan.",
        doelPad: "/updates",
      });
    case "vervaldatum":
      return bouwVervaldatumMail({ name: "Dirk", soortLabel: "Code 95", validUntil: "2026-10-25", dagen: 30 });
    case "weekoverzicht":
      return bouwOverzichtMail({
        naam: "weekoverzicht",
        impact: "3 meldingen, 2 toestellen",
        toon: "aandacht",
        alineas: ["In de afgelopen 7 dagen: 3 meldingen van 2 toestellen (2 unieke soorten)."],
        lijsten: [
          { kop: "Meldingen", items: ["2× [error-toast] Kon planning niet laden (/)", "1× [window.onerror] TypeError: x is undefined (/rooster)"] },
          { kop: "Cijfers van de afgelopen 7 dagen", items: ["Actieve gebruikers: 31", "Verlof: 4 nieuw, 3 beslist, 2 open", "Dienstruil: 2 nieuw, 1 uitgevoerd, 1 open"] },
          { kop: "Documenten (binnen 60 dagen)", items: ["Dirk Maes, Code 95 verloopt over 12 dagen (07/10/2026)"] },
        ],
      });
    case "testmail":
      return bouwTestMail({ afzender: "\"VHB Portaal\" <noreply@vhbportaal.com>", verstuurdOp: "25/09/2026 14:02" });
    case "backup-integriteit":
      return bouwBackupIntegriteitMail({ filename: "vhb-backup-2026-09-25.json", bevindingen: ["collectie users is leeg", "geen admin-account in de export"] });
    case "backup-weekkopie":
      return bouwBackupWeekkopieMail({ filename: "vhb-backup-2026-09-27.json", exportedAt: "2026-09-27T01:30:00.000Z" });
    case "restore-proef":
      return bouwRestoreProefMail({ filename: "vhb-backup-2026-09-30.json", bevindingen: ["teruglezen mislukt: Unexpected end of JSON input"] });
    default:
      return null;
  }
};
