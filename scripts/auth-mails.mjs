#!/usr/bin/env node
/**
 * Supabase-Auth-mails in VHB-huisstijl (verbeterronde 07-09, nr. 7).
 *
 * De mails die Supabase zelf verstuurt (wachtwoord vergeten, uitnodiging,
 * e-mailwijziging, …) kwamen als de Engelse standaardtemplates aan, naast
 * een portaal dat verder volledig in huisstijl is. Dit script bouwt uit één
 * lay-out (zelfde recept als de welkomstmail in api/email.ts) zes templates
 * en schrijft ze naar supabase/auth-mails/*.html (gecommit, plakbaar in het
 * dashboard: Authentication › Emails › Templates).
 *
 *   node scripts/auth-mails.mjs            schrijft de HTML-bestanden
 *   node scripts/auth-mails.mjs --push     zet ze via de Management API
 *       vereist SUPABASE_ACCESS_TOKEN (persoonlijk token, supabase.com/dashboard/account/tokens)
 *       en SUPABASE_PROJECT_REF (bv. nbupdofxuoxvgeiedzkk); nooit in git.
 *
 * Variabelen zijn Supabase-Go-templates ({{ .ConfirmationURL }} enz.); de
 * tekst is bewust kort en zonder em dash (komma, zie CLAUDE.md).
 */
import fs from 'node:fs';
import path from 'node:path';

const UIT = path.resolve('supabase/auth-mails');
const GOUD = '#E2A323';
const CARBON = '#0D0D0F';

const knop = (url, tekst) =>
  `<a href="${url}" style="background-color: ${GOUD}; color: ${CARBON}; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">${tekst}</a>`;

const layout = ({ kicker, titel, alinea, actie, voet }) => `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
  <div style="background-color: ${CARBON}; color: white; padding: 22px 30px; text-align: center;">
    <p style="margin: 0; font-size: 12px; font-weight: 800; letter-spacing: 0.18em; color: ${GOUD};">${kicker}</p>
    <h1 style="margin: 8px 0 0; font-size: 22px; font-weight: 800;">VHB Portaal</h1>
  </div>
  <div style="padding: 30px;">
    <p style="color: #1e293b; font-size: 16px; margin-top: 0;">${titel}</p>
    <p style="color: #475569; line-height: 1.6;">${alinea}</p>
    ${actie ? `<div style="margin-top: 26px; text-align: center;">${actie}</div>` : ''}
    <p style="margin-top: 26px; color: #94a3b8; font-size: 12px; line-height: 1.6;">${voet}</p>
  </div>
  <div style="background-color: #f8fafc; padding: 14px 30px; text-align: center; font-size: 11px; color: #94a3b8;">
    Automatisch bericht van het VHB Portaal, niet beantwoorden. Vragen? Contacteer de planning.
  </div>
</div>
`.trim();

const NIET_JIJ = 'Vroeg je dit niet aan? Dan kun je deze mail negeren, er verandert niets aan je account.';
const LINK_DUUR = 'De link werkt één uur en is eenmalig.';

export const MAILS = {
  recovery: {
    onderwerp: 'VHB Portaal: nieuw wachtwoord instellen',
    html: layout({
      kicker: 'WACHTWOORD',
      titel: 'Hallo,',
      alinea: 'Je vroeg een nieuw wachtwoord aan voor het VHB Portaal. Kies er hieronder een; je huidige wachtwoord blijft werken tot je dat doet.',
      actie: knop('{{ .ConfirmationURL }}', 'Nieuw wachtwoord kiezen'),
      voet: `${LINK_DUUR} ${NIET_JIJ}`,
    }),
  },
  invite: {
    onderwerp: 'Welkom op het VHB Portaal, stel je wachtwoord in',
    html: layout({
      kicker: 'WELKOM',
      titel: 'Hallo,',
      alinea: 'Er is een account voor je aangemaakt op het VHB Portaal. Daar vind je je rooster, verlofaanvragen, dienstruilen en updates van de planning. Je logt in met dit e-mailadres.',
      actie: knop('{{ .ConfirmationURL }}', 'Wachtwoord instellen'),
      voet: 'Tip: open {{ .SiteURL }} op je telefoon en kies “Zet op beginscherm”, dan werkt het portaal als app.',
    }),
  },
  magic_link: {
    onderwerp: 'VHB Portaal: je aanmeldlink',
    html: layout({
      kicker: 'AANMELDEN',
      titel: 'Hallo,',
      alinea: 'Met de knop hieronder meld je je in één keer aan op het VHB Portaal, zonder wachtwoord.',
      actie: knop('{{ .ConfirmationURL }}', 'Aanmelden'),
      voet: `${LINK_DUUR} ${NIET_JIJ}`,
    }),
  },
  confirmation: {
    onderwerp: 'VHB Portaal: bevestig je e-mailadres',
    html: layout({
      kicker: 'BEVESTIGEN',
      titel: 'Hallo,',
      alinea: 'Bevestig dat dit e-mailadres bij jou hoort, dan is je account op het VHB Portaal klaar voor gebruik.',
      actie: knop('{{ .ConfirmationURL }}', 'E-mailadres bevestigen'),
      voet: NIET_JIJ,
    }),
  },
  email_change: {
    onderwerp: 'VHB Portaal: bevestig je nieuwe e-mailadres',
    html: layout({
      kicker: 'E-MAILADRES',
      titel: 'Hallo,',
      alinea: 'Je e-mailadres op het VHB Portaal wordt gewijzigd naar <strong>{{ .NewEmail }}</strong>. Bevestig de wijziging met de knop hieronder; tot dan blijft <strong>{{ .Email }}</strong> je aanmeldadres.',
      actie: knop('{{ .ConfirmationURL }}', 'Wijziging bevestigen'),
      voet: `${LINK_DUUR} Vroeg je dit niet aan? Neem dan meteen contact op met de planning.`,
    }),
  },
  reauthentication: {
    onderwerp: 'VHB Portaal: je bevestigingscode',
    html: layout({
      kicker: 'BEVESTIGING',
      titel: 'Hallo,',
      alinea: 'Voor deze wijziging vraagt het portaal een extra bevestiging. Vul deze code in:',
      actie: `<p style="font-size: 28px; font-weight: 800; letter-spacing: 0.3em; color: #1e293b; margin: 0;">{{ .Token }}</p>`,
      voet: `De code is kort geldig. ${NIET_JIJ}`,
    }),
  },
};

const schrijf = () => {
  fs.mkdirSync(UIT, { recursive: true });
  for (const [naam, m] of Object.entries(MAILS)) {
    fs.writeFileSync(path.join(UIT, `${naam}.html`), `${m.html}\n`);
  }
  fs.writeFileSync(path.join(UIT, 'onderwerpen.json'), `${JSON.stringify(Object.fromEntries(Object.entries(MAILS).map(([k, m]) => [k, m.onderwerp])), null, 2)}\n`);
  console.log(`✓ ${Object.keys(MAILS).length} templates geschreven naar ${path.relative(process.cwd(), UIT)}/`);
};

const push = async () => {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    console.error('SUPABASE_ACCESS_TOKEN en SUPABASE_PROJECT_REF zijn nodig voor --push (niet in git zetten).');
    process.exit(1);
  }
  const body = {};
  for (const [naam, m] of Object.entries(MAILS)) {
    body[`mailer_subjects_${naam}`] = m.onderwerp;
    body[`mailer_templates_${naam}_content`] = m.html;
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Management API antwoordde ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`✓ auth-mails gezet op project ${ref}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  schrijf();
  if (process.argv.includes('--push')) await push();
}
