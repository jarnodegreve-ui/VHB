-- Diepteverdediging op ocpi_power_snapshots (controle-ronde 06-08-2026):
-- de aanmaakmigratie deed grant select aan authenticated, maar zonder
-- expliciete revoke op insert/update/delete leunt de schrijfbescherming
-- volledig op RLS (aan, 0 policies). Riemen én bretellen: trek alle
-- schrijfrechten voor anon/authenticated expliciet in. Idempotent — revoke
-- van een niet-verleend recht is een no-op.
begin;

revoke insert, update, delete, truncate, references, trigger
  on table public.ocpi_power_snapshots
  from anon, authenticated;

-- Lezen blijft zoals de aanmaakmigratie het zette: select voor
-- authenticated, alles voor service_role.

commit;
