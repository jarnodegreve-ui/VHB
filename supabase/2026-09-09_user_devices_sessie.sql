-- Toestel-intrekking vastmaken aan de auth-sessie (controle-ronde 09-09, nr. 2)
--
-- Probleem: de gate herkende een toestel uitsluitend aan de client-header
-- X-Device-Token. Wie die header wegliet, viel voor staf volledig buiten de
-- gate en werd voor chauffeurs een "onbekend" i.p.v. een ingetrokken toestel.
-- Een ingetrokken toestel (gestolen telefoon, vertrokken planner) kreeg zo met
-- één weggelaten header de volledige API terug.
--
-- Oplossing: bij registratie leggen we de Supabase-sessie (claim `session_id`
-- uit het JWT) vast op de toestelrij. De server leest die claim uit het al
-- geverifieerde token, dus de client kan hem niet weglaten of vervalsen. Wordt
-- een toestel ingetrokken, dan blokkeert de API elk verzoek van die sessie,
-- ongeacht welke headers meekomen.
--
-- Idempotent; plakken en draaien in de Supabase SQL Editor.

begin;

alter table public.user_devices
  add column if not exists session_id text;

comment on column public.user_devices.session_id is
  'Supabase auth session_id van de laatste aanmelding op dit toestel. Server-only; gevuld door /api/devices/register. Maakt intrekken onafhankelijk van de X-Device-Token-header.';

-- De gate leest de lijst "sessies van ingetrokken toestellen" (30 s gecacht
-- per instantie, zelfde cache en epoch als de toestel-lookup in
-- api/_lib/deviceCache.ts). Partieel: alleen ingetrokken rijen met een sessie
-- zijn relevant, dus de index blijft klein.
create index if not exists user_devices_revoked_session_idx
  on public.user_devices (session_id)
  where status = 'revoked' and session_id is not null;

commit;
