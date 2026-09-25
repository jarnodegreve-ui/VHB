# Auth-mails in huisstijl

De mails die Supabase Auth zelf verstuurt (wachtwoord vergeten, uitnodiging,
e-mailwijziging, aanmeldlink, bevestiging, bevestigingscode) in dezelfde
lay-out als de welkomstmail van het portaal. Bron: `scripts/auth-mails.mjs`;
de `.html`-bestanden hier zijn gegenereerd, niet met de hand bewerken.

## Toepassen

**Optie 1, plakken (per project):** Supabase-dashboard › Authentication ›
Emails › Templates. Per template het onderwerp uit `onderwerpen.json` en de
inhoud van het bijbehorende `.html`-bestand plakken en opslaan:

| Dashboard-tab | Bestand |
|---|---|
| Reset password | `recovery.html` |
| Invite user | `invite.html` |
| Magic link | `magic_link.html` |
| Confirm signup | `confirmation.html` |
| Change email address | `email_change.html` |
| Reauthentication | `reauthentication.html` |

**Optie 2, script:** een persoonlijk toegangstoken aanmaken op
supabase.com/dashboard/account/tokens en dan

```sh
SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=nbupdofxuoxvgeiedzkk npx tsx scripts/auth-mails.mjs --push
```

Herhalen voor staging (`bzxnkjswfhaiqqbxbmky`). Het token nooit in git of in
`.env.example` zetten.

## Welke mails gebruikt het portaal echt

- **Reset password**: via “Wachtwoord vergeten” op het loginscherm.
- **Change email address**: als een gebruiker zelf zijn adres wijzigt.
- **Invite / Confirm signup / Magic link / Reauthentication**: nu niet in
  gebruik (nieuwe accounts krijgen de welkomstmail van het portaal zelf via
  SMTP), maar staan klaar in huisstijl voor als dat ooit aan gaat.
