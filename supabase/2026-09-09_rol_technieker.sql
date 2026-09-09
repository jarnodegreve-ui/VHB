-- Rol "technieker" (verzoek Jarno 09-09)
--
-- Techniekers krijgen een eigen portaalaccount: verlof aanvragen, updates,
-- documenten, meldingen en contacten. Ze hebben géén diensten, staan niet in
-- de planning en tellen niet mee in de verlofbezetting; dat blijft rijdend
-- personeel (rol 'chauffeur').
--
-- Twee CHECK-constraints kennen de rollenlijst en moeten mee. De RLS-policies
-- zelf hoeven niet: die zijn allemaal allowlists op ('planner','admin') of
-- 'admin', dus een technieker erft daar niets van.
--
-- Idempotent; plakken en draaien in de Supabase SQL Editor.

begin;

-- public.users.role
alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check
  check (role in ('chauffeur', 'technieker', 'planner', 'admin'));

-- public.activity_log.actor_role (de rol van wie de actie deed)
alter table public.activity_log drop constraint if exists activity_log_actor_role_check;
alter table public.activity_log
  add constraint activity_log_actor_role_check
  check (actor_role in ('chauffeur', 'technieker', 'planner', 'admin'));

commit;

-- Controlequery (mag na afloop gedraaid worden):
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname in ('users_role_check', 'activity_log_actor_role_check');
