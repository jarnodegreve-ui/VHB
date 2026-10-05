-- Atomaire increment/decrement van de activeSessions-teller.
-- Voorkomt de lost-update-race wanneer meerdere gebruikers ~tegelijk
-- in- of uitloggen (de oude read-modify-write op een gecachte waarde
-- telde verkeerd). De applicatie roept dit aan via rpc('bump_active_sessions').
-- Zonder deze functie valt de app terug op een (niet-atomaire) read-modify-write.
--
-- Eénmalig uitvoeren in de Supabase SQL-editor.

create or replace function bump_active_sessions(uid text, delta int)
returns void
language sql
as $$
  update users
  set activesessions = greatest(0, coalesce(activesessions, 0) + delta)
  where id = uid;
$$;

-- Inschrijven in het register (2026-10-05_schema_migraties.sql). Op een lege
-- database draait dit bestand vóór het register bestaat: dan schrijft de
-- basislijn van het register het in.
do $$
begin
  if to_regclass('public.schema_migraties') is not null then
    insert into public.schema_migraties (bestand)
    values ('active_sessions_rpc.sql')
    on conflict (bestand) do nothing;
  end if;
end
$$;
