# Mail-DNS van vhbportaal.com: SPF, DKIM en DMARC

Het portaal mailt als `noreply@vhbportaal.com` via Resend (zie CLAUDE.md › Mails).
Een ontvangende mailserver stelt drie vragen: mag deze server voor dit domein
versturen (SPF), is de mail onderweg ongewijzigd en echt van dit domein (DKIM),
en wat moet ik doen als dat niet klopt (DMARC). Zonder DMARC kan iedereen een
mail sturen die van `noreply@vhbportaal.com` lijkt te komen, en wegen Gmail en
Outlook het domein lager (sneller in de spam).

## Stand op 14-10-2026 (gemeten met `dig`)

| Record | Stand |
|---|---|
| `resend._domainkey.vhbportaal.com` TXT (DKIM) | aanwezig, in orde |
| `send.vhbportaal.com` TXT (SPF van het verzendsubdomein van Resend) | `v=spf1 include:amazonses.com ~all`, in orde |
| `vhbportaal.com` TXT (SPF hoofddomein) | ontbreekt |
| `_dmarc.vhbportaal.com` TXT (DMARC) | ontbreekt |
| `vhbportaal.com` MX | geen: het domein ontvangt geen mail, een antwoord op noreply@ botst |

DMARC slaagt via DKIM (de handtekening draagt `d=vhbportaal.com`) en via SPF in
de "relaxed" stand (envelop `send.vhbportaal.com` is een subdomein van het
From-domein). De twee ontbrekende records voegen dus beleid toe, geen
verzendrechten.

## Toe te voegen records (bij de domeinbeheerder van vhbportaal.com)

1. **SPF op het hoofddomein**, TXT op `vhbportaal.com` (naam `@`):

   ```
   v=spf1 include:amazonses.com -all
   ```

   Zegt: alleen de servers van Resend (Amazon SES) mogen namens
   `vhbportaal.com` als envelop-afzender optreden, al de rest is hard fout.
   Resend gebruikt in de praktijk `send.vhbportaal.com` als envelop, dus dit
   record vangt alleen vervalsingen.

2. **DMARC**, TXT op `_dmarc.vhbportaal.com`, eerst in de rapporteerstand:

   ```
   v=DMARC1; p=none; rua=mailto:<rapportadres>; adkim=r; aspf=r
   ```

   `p=none` = alleen rapporteren, niets blokkeren. Het rapportadres moet een
   adres zijn dat rapporten van andere domeinen mag ontvangen; een Gmail-adres
   voldoet daar niet aan (ontvangers eisen dan een extra record bij gmail.com).
   Gebruik de gratis DMARC-digest van Postmark: op https://dmarc.postmarkapp.com
   het domein en een mailadres opgeven, dat geeft een `rua`-adres op
   `@dmarc.postmarkapp.com` en stuurt elke maandag een leesbare samenvatting.

3. **Na twee weken rapporten zonder onverwachte verzenders** het beleid
   aanscherpen, telkens één stap:

   ```
   v=DMARC1; p=quarantine; rua=mailto:<rapportadres>; adkim=r; aspf=r
   ```

   en daarna `p=reject`.

## Controleren

```bash
dig +short TXT vhbportaal.com
dig +short TXT _dmarc.vhbportaal.com
dig +short TXT resend._domainkey.vhbportaal.com
```

Daarna een testmail sturen vanuit Beheer › Systeemstatus (Stuur testmail naar
mezelf) en in Gmail "Origineel weergeven" openen: de kop `Authentication-Results`
hoort `spf=pass`, `dkim=pass` en `dmarc=pass` te tonen.

## Wachtwoordmails van Supabase

De welkomst- en uitnodigingsmails stuurt het portaal zelf (via Resend), maar
"Wachtwoord vergeten" op het inlogscherm laat Supabase Auth de mail sturen.
Kijk in het Supabase-dashboard onder Authentication › SMTP Settings: staat daar
Custom SMTP met Resend en afzender `noreply@vhbportaal.com`, dan vallen die
mails onder dezelfde records. Staat Supabase's eigen mailserver aan, dan komen
ze van een Supabase-domein en raakt DMARC ze niet.
