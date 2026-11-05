# Mail-DNS van vhbportaal.com: SPF, DKIM en DMARC

Het portaal mailt als `noreply@vhbportaal.com` via Resend (zie CLAUDE.md › Mails).
Een ontvangende mailserver stelt drie vragen: mag deze server voor dit domein
versturen (SPF), is de mail onderweg ongewijzigd en echt van dit domein (DKIM),
en wat moet ik doen als dat niet klopt (DMARC). Zonder DMARC kan iedereen een
mail sturen die van `noreply@vhbportaal.com` lijkt te komen, en wegen Gmail en
Outlook het domein lager (sneller in de spam).

## Stand op 05-11-2026 (gemeten met `dig`)

| Record | Stand |
|---|---|
| `resend._domainkey.vhbportaal.com` TXT (DKIM) | aanwezig, in orde |
| `send.vhbportaal.com` TXT (SPF van het verzendsubdomein van Resend) | `v=spf1 include:amazonses.com ~all`, in orde (MX `feedback-smtp.eu-west-1.amazonses.com` voor de bounces) |
| `vhbportaal.com` TXT (SPF hoofddomein) | `v=spf1 include:amazonses.com -all`, gezet op 15-10 |
| `_dmarc.vhbportaal.com` TXT (DMARC) | `v=DMARC1; p=none; pct=100; rua=mailto:re+wn4qkxgl4wg@dmarc.postmarkapp.com; sp=none; aspf=r;`, gezet op 15-10 (rapporteerstand, wekelijkse samenvatting via Postmark) |
| `vhbportaal.com` MX | geen: het domein ontvangt geen mail, een antwoord op noreply@ botst |

DMARC slaagt via DKIM (de handtekening draagt `d=vhbportaal.com`) en via SPF in
de "relaxed" stand (envelop `send.vhbportaal.com` is een subdomein van het
From-domein). SPF op het hoofddomein en DMARC voegen beleid toe, geen
verzendrechten: Resend gebruikt `send.vhbportaal.com` als envelop, dus het
`-all` op het hoofddomein vangt alleen vervalsingen.

## Wat wanneer gedaan is

- 14-10: eerste meting; SPF op het hoofddomein en DMARC ontbraken, dit document
  beschreef de toe te voegen records.
- 15-10 (Jarno): beide records gezet bij de domeinbeheerder (SPF met `-all`,
  DMARC met `p=none` en `rua` naar de gratis DMARC-digest van Postmark,
  https://dmarc.postmarkapp.com). Dezelfde dag Custom SMTP in Supabase
  (Authentication › SMTP Settings) op Resend gezet en getest: werkt.
- 05-11: opnieuw gemeten, stand hierboven. De aanscherping naar `p=quarantine`
  die rond 29-10 gepland stond, is nog niet gebeurd.

## Volgende stap: `p=quarantine` (actie Jarno)

Voorwaarde uit het oorspronkelijke plan: twee weken Postmark-rapporten zonder
onverwachte verzenders (alleen Amazon SES/Resend hoort erin voor te komen). Is
dat zo, dan bij de domeinbeheerder het TXT-record op `_dmarc.vhbportaal.com`
vervangen door hetzelfde record met alleen `p=none` gewijzigd in
`p=quarantine`; `pct`, `rua`, `sp` en `aspf` blijven zoals ze staan:

```
v=DMARC1; p=quarantine; pct=100; rua=mailto:re+wn4qkxgl4wg@dmarc.postmarkapp.com; sp=none; aspf=r;
```

Daarna controleren (hieronder) en een testmail sturen. Blijven de rapporten
schoon, dan is de laatste stap `p=reject`, met hetzelfde recept.

## Controleren

```bash
dig +short TXT vhbportaal.com
dig +short TXT _dmarc.vhbportaal.com
dig +short TXT resend._domainkey.vhbportaal.com
```

Daarna een testmail sturen vanuit Beheer › Systeemstatus (Stuur testmail naar
mezelf) en in Gmail "Origineel weergeven" openen: de kop `Authentication-Results`
hoort `spf=pass`, `dkim=pass` en `dmarc=pass` te tonen.

## Hoe het portaal en Supabase versturen

- **Portaalmails** gaan via nodemailer over SMTP naar Resend (api/email.ts):
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` en `SMTP_SECURE` (alleen
  `true` voor poort 465; op andere poorten wordt STARTTLS afgedwongen). Er is
  geen aparte Resend-variabele: Resend zit achter de gewone SMTP-instellingen.
  De afzender komt uit `MAIL_FROM_NAME` en `MAIL_FROM` (valt terug op het oudere
  `SMTP_FROM`, daarna op `SMTP_USER`); `MAIL_REPLY_TO` is optioneel. Zonder
  `SMTP_USER` en `SMTP_PASS` wordt een mail alleen gelogd, niet verstuurd.
- **Supabase Auth-mails** ("Wachtwoord vergeten" op het inlogscherm; de
  welkomst- en uitnodigingsmails stuurt het portaal zelf) gaan sinds 15-10 via
  Custom SMTP op Resend. Daarmee vallen ook die mails onder de records
  hierboven, zolang het afzenderadres in Authentication › SMTP Settings op
  `vhbportaal.com` staat.
