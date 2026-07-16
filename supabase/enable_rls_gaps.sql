-- =============================================================================
-- RLS aanzetten op de drie tabellen zonder RLS-migratie in de repo
-- =============================================================================
-- Uit de security-review: push_subscriptions, client_errors en
-- coverage_expectations zijn buiten de repo om aangemaakt (Table Editor /
-- losse SQL) en hebben — anders dan alle andere tabellen — geen
-- `enable row level security` in supabase/. Staat RLS uit, dan kan de
-- publieke anon-key deze tabellen rechtstreeks via PostgREST lezen:
-- push-keys (p256dh/auth), client-foutmeldingen + user-ids, en de
-- dekking-config.
--
-- Bewust GEEN policies: alle toegang loopt via de Express-API met de
-- service_role-key, en die bypast RLS. RLS-aan-zonder-policies = dicht voor
-- anon/authenticated, open voor de server — zelfde patroon als de
-- OCPI-tabellen.
--
-- Idempotent: RLS nogmaals aanzetten is een no-op, en de to_regclass-guards
-- slaan tabellen over die (in een verse omgeving) nog niet bestaan.

begin;

do $$
begin
  if to_regclass('public.push_subscriptions') is not null then
    alter table public.push_subscriptions enable row level security;
  end if;
  if to_regclass('public.client_errors') is not null then
    alter table public.client_errors enable row level security;
  end if;
  if to_regclass('public.coverage_expectations') is not null then
    alter table public.coverage_expectations enable row level security;
  end if;
  -- Vierde vondst van de reviewer: activity_log (auditlog met namen/rollen/
  -- acties) is wél via de repo aangemaakt maar kreeg ook nooit RLS.
  if to_regclass('public.activity_log') is not null then
    alter table public.activity_log enable row level security;
  end if;
end $$;

commit;

-- Verifieer daarna (verwacht: rowsecurity = true voor alle vier):
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public'
--     and tablename in ('push_subscriptions', 'client_errors', 'coverage_expectations', 'activity_log');
