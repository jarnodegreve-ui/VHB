-- Schrijfrechten van anon en authenticated intrekken op alle publieke tabellen.
-- Draaien in de Supabase SQL Editor.
--
-- Waarom: anon én authenticated hebben nu SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES en TRIGGER op álle 32 tabellen in public. Alleen RLS
-- houdt dat tegen. Dat is één laag, en de SQL-reviews van 31-07 en 02-08 wezen
-- er allebei op: RLS ooit uitzetten "om te debuggen", of één policy die per
-- ongeluk `to public` krijgt, legt een tabel meteen open. Met deze migratie is
-- er een tweede laag die daar los van staat.
--
-- WAT BLIJFT STAAN, en waarom:
--
--   authenticated → SELECT blijft.
--     Realtime doet de RLS-check als de abonnee zelf: het draait
--     `select exists(select 1 from <tabel> where pk = …)` met diens rol. Zonder
--     SELECT-privilege komt er geen enkel postgres_changes-event meer aan en
--     is de auto-verversing stil dood. RLS bepaalt nog steeds wélke rijen.
--
--   service_role → alles blijft.
--     De hele Express-API draait hierop; dit is het enige pad dat schrijft.
--
--   anon → niets blijft.
--     Er is geen enkel scherm dat vóór het inloggen een tabel leest; de
--     frontend doet nergens supabase.from() (0 treffers in src/). Inloggen
--     zelf loopt via auth, niet via een tabel.
--
-- Vandaag verandert er functioneel niets — dat is precies de bedoeling. Dit is
-- diepteverdediging, geen bugfix.
--
-- WAT DIT NIET DICHT KRIJGT: er staat een tweede regel in pg_default_acl, van
-- de rol supabase_admin. Een tabel die het platform zelf ooit in public
-- aanmaakt, krijgt daardoor alsnog volledige rechten voor anon. Die regel is
-- niet aan te passen zonder lidmaatschap van supabase_admin, en dat heeft
-- postgres op Supabase niet. Vandaar de controlequery onderaan: draai die af
-- en toe, dan valt zo'n tabel meteen op.
--
-- VOORAF CONTROLEREN: api/db.ts doet `export const db = supabaseAdmin ?? supabase`
-- — ontbreekt SUPABASE_SERVICE_ROLE_KEY, dan draait de hele Express-API op de
-- anon-key. Vandaag werkt dat nog half (anon heeft alles, RLS filtert); ná deze
-- migratie valt de API in één klap om met "permission denied". Bewijs dat de
-- key gezet is: /api/month-planning geeft een chauffeur de volledige
-- planningmatrix terug, en die is staff-only onder RLS — dat kán alleen met de
-- service-role. Geverifieerd op 02-08-2026.
--
-- Idempotent: revoke op een recht dat er al niet is, is een no-op.

begin;

-- anon: geen enkele tabeltoegang meer.
revoke all privileges on all tables in schema public from anon;

-- authenticated: lezen mag (Realtime heeft het nodig), schrijven niet.
-- 'maintain' hoort in deze lijst: de live-ACL is arwdDxtm, en die m is het
-- PG17-privilege MAINTAIN (VACUUM/ANALYZE/CLUSTER/REINDEX). Alleen te
-- gebruiken met een directe DB-verbinding, niet via PostgREST — maar het doel
-- is "lezen mag, de rest niet", dus laat hem er niet per ongeluk in staan.
revoke insert, update, delete, truncate, references, trigger, maintain
  on all tables in schema public from authenticated;

-- Nieuwe tabellen krijgen anders opnieuw de volledige set mee, en dan staat
-- deze migratie er over een maand voor niets. Alleen de default privileges van
-- postgres (de rol die migraties draait) aanpassen.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger, maintain on tables from authenticated;

-- Groter restrisico dan de tabelrechten hierboven: de default privileges geven
-- anon standaard EXECUTE op nieuwe functies. De bestaande RPC's zijn toevallig
-- al dichtgezet, maar de eerstvolgende SECURITY DEFINER-functie zou by default
-- met de anon-key aanroepbaar zijn. NIET voor authenticated: die moet
-- current_app_user_role() kunnen aanroepen, want de RLS-policies leunen erop.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

commit;

-- === Controle na het draaien ===
--
-- 1) anon heeft nergens meer iets, authenticated alleen SELECT.
--    Verwacht: anon = 0 rijen, authenticated alleen 'SELECT'.
--
-- select grantee, string_agg(distinct privilege_type, ',' order by privilege_type) as rechten,
--        count(distinct table_name) as tabellen
-- from information_schema.role_table_grants
-- where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
-- group by grantee order by grantee;
--
-- 2) De app werkt nog: log in, open Mijn rooster, keur in een tweede venster
--    een verlofaanvraag goed en kijk of het eerste venster live bijwerkt.
--    Werkt dat laatste niet meer, dan is er tóch een SELECT te veel ingetrokken.
