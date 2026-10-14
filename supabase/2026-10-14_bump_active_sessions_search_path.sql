-- 2026-10-14 — bump_active_sessions krijgt een vast zoekpad (verbeterronde 14-10, punt 9, keuze Jarno).
--
-- De Supabase-advisor "function_search_path_mutable" meldde dat deze functie
-- (de atomaire teller van actieve sessies, door de server aangeroepen via
-- rpc('bump_active_sessions'), zie api/_lib/opslag/gebruikers.ts) zonder vast
-- search_path draait. Wie objecten kan maken in een schema dat vóór public in
-- het zoekpad staat, zou er theoretisch een eigen `users` onder kunnen
-- schuiven. Nu: search_path leeg en de tabel schemagekwalificeerd, zoals de
-- vier helperfuncties van de RLS-policies (current_app_user_*) al hadden.
-- Handtekening en gedrag ongewijzigd: api/schemaProbes.ts en de opslaglaag
-- roepen hem met (uid, delta) aan.
--
-- Raakt geen RLS, policies, grants of security-definer-functies: geen
-- beleidssnapshot-update. Idempotent: create or replace.

begin;

create or replace function public.bump_active_sessions(uid text, delta integer)
returns void
language sql
set search_path = ''
as $$
  update public.users
  set activesessions = greatest(0, coalesce(activesessions, 0) + delta)
  where id = uid;
$$;

-- === register ===
insert into public.schema_migraties (bestand)
values ('2026-10-14_bump_active_sessions_search_path.sql')
on conflict (bestand) do nothing;

commit;
