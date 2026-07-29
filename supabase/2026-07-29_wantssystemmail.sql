-- Systeemmail-voorkeur per account (verzoek Jarno 2026-07-29): admins kunnen
-- in Gebruikersbeheer de foutendigest- en back-up-mails uitzetten. Default
-- true = huidige gedrag; de code behandelt een ontbrekende kolom als true,
-- dus deze migratie kan zonder haast draaien. Idempotent.
alter table public.users
  add column if not exists wantssystemmail boolean not null default true;
