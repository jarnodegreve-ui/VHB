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
 *   npx tsx scripts/auth-mails.mjs            schrijft de HTML-bestanden
 *   npx tsx scripts/auth-mails.mjs --push     zet ze via de Management API
 *       (tsx, want de lay-out is de TypeScript-module api/_lib/mailLayout.ts;
 *       sinds 25-09 dezelfde opbouw als alle portaalmails)
 *       vereist SUPABASE_ACCESS_TOKEN (persoonlijk token, supabase.com/dashboard/account/tokens)
 *       en SUPABASE_PROJECT_REF (bv. nbupdofxuoxvgeiedzkk); nooit in git.
 *
 * Variabelen zijn Supabase-Go-templates ({{ .ConfirmationURL }} enz.); de
 * tekst is bewust kort en zonder em dash (komma, zie CLAUDE.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { bouwMail } from '../api/_lib/mailLayout.ts';

const UIT = path.resolve('supabase/auth-mails');
// Supabase vult {{ .SiteURL }} in; dezelfde basis als het logo in de mail.
const SITE = '{{ .SiteURL }}';

/** Zelfde lay-out als de portaalmails (api/_lib/mailLayout.ts); alleen de
 *  HTML gaat naar Supabase, de tekstversie maakt Supabase niet. */
const layout = ({ kicker, titel, alinea, knop, code, voet }) =>
  bouwMail({
    portaalUrl: SITE,
    kicker,
    titel,
    aanhef: 'Hallo,',
    alineas: [
      { html: `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: #1F2937;">${alinea}</p>`, tekst: alinea },
      ...(code ? [{ html: `<p style="margin: 8px 0 18px; font-size: 28px; font-weight: 700; letter-spacing: 0.3em; color: #0D0D0F;">${code}</p>`, tekst: code }] : []),
    ],
    ...(knop ? { knop } : {}),
    voet,
  }).html;

const NIET_JIJ = 'Vroeg je dit niet aan? Dan kun je deze mail negeren, er verandert niets aan je account.';
const LINK_DUUR = 'De link werkt één uur en is eenmalig.';

export const MAILS = {
  recovery: {
    onderwerp: 'VHB Portaal: nieuw wachtwoord instellen',
    html: layout({
      kicker: 'Wachtwoord',
      titel: 'Nieuw wachtwoord instellen',
      alinea: 'Je vroeg een nieuw wachtwoord aan voor het VHB Portaal. Kies er hieronder een; je huidige wachtwoord blijft werken tot je dat doet.',
      knop: { tekst: 'Nieuw wachtwoord kiezen', url: '{{ .ConfirmationURL }}' },
      voet: `${LINK_DUUR} ${NIET_JIJ}`,
    }),
  },
  invite: {
    onderwerp: 'Welkom op het VHB Portaal, stel je wachtwoord in',
    html: layout({
      kicker: 'Welkom',
      titel: 'Je account op het VHB Portaal',
      alinea: 'Er is een account voor je aangemaakt op het VHB Portaal. Daar vind je je rooster, verlofaanvragen, dienstruilen en updates van de planning. Je logt in met dit e-mailadres.',
      knop: { tekst: 'Wachtwoord instellen', url: '{{ .ConfirmationURL }}' },
      voet: 'Tip: open {{ .SiteURL }} op je telefoon en kies “Zet op beginscherm”, dan werkt het portaal als app.',
    }),
  },
  magic_link: {
    onderwerp: 'VHB Portaal: je aanmeldlink',
    html: layout({
      kicker: 'Aanmelden',
      titel: 'Je aanmeldlink',
      alinea: 'Met de knop hieronder meld je je in één keer aan op het VHB Portaal, zonder wachtwoord.',
      knop: { tekst: 'Aanmelden', url: '{{ .ConfirmationURL }}' },
      voet: `${LINK_DUUR} ${NIET_JIJ}`,
    }),
  },
  confirmation: {
    onderwerp: 'VHB Portaal: bevestig je e-mailadres',
    html: layout({
      kicker: 'Bevestigen',
      titel: 'Bevestig je e-mailadres',
      alinea: 'Bevestig dat dit e-mailadres bij jou hoort, dan is je account op het VHB Portaal klaar voor gebruik.',
      knop: { tekst: 'E-mailadres bevestigen', url: '{{ .ConfirmationURL }}' },
      voet: NIET_JIJ,
    }),
  },
  email_change: {
    onderwerp: 'VHB Portaal: bevestig je nieuwe e-mailadres',
    html: layout({
      kicker: 'E-mailadres',
      titel: 'Bevestig je nieuwe e-mailadres',
      alinea: 'Je e-mailadres op het VHB Portaal wordt gewijzigd naar <strong>{{ .NewEmail }}</strong>. Bevestig de wijziging met de knop hieronder; tot dan blijft <strong>{{ .Email }}</strong> je aanmeldadres.',
      knop: { tekst: 'Wijziging bevestigen', url: '{{ .ConfirmationURL }}' },
      voet: `${LINK_DUUR} Vroeg je dit niet aan? Neem dan meteen contact op met de planning.`,
    }),
  },
  reauthentication: {
    onderwerp: 'VHB Portaal: je bevestigingscode',
    html: layout({
      kicker: 'Bevestiging',
      titel: 'Je bevestigingscode',
      alinea: 'Voor deze wijziging vraagt het portaal een extra bevestiging. Vul deze code in:',
      code: '{{ .Token }}',
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
