-- De weestabel public.subscriptions verwijderen. Draaien in de SQL Editor.
--
-- Waarom: deze tabel hoort niet bij het VHB-portaal. Kolommen: id, user_id,
-- name, amount, cycle, category, next_renewal, active, note — een
-- abonnementen-kostentracker, geen onderdeel van dit product. Geen enkele
-- codepad raakt hem aan (0 treffers op `.from("subscriptions")` in src/, api/
-- en scripts/); de app gebruikt uitsluitend push_subscriptions, en die blijft.
--
-- Er staan wel vier RLS-policies op (subs_*_own, aangemaakt in
-- 2026-07-30_rls_initplan.sql), die daarmee ook meegaan. Beleid van dit
-- project is dat de tabelgrants voor anon/authenticated wijd openstaan en RLS
-- de enige laag is — een tabel die niemand kent maar die wél in het schema
-- staat, is dan precies het soort oppervlak dat je niet wil hebben.
--
-- Beslissing Jarno, 02-08-2026.
--
-- VEILIGHEIDSGREP: alleen droppen als de tabel leeg is. Staat er tóch data in,
-- dan stopt de migratie met een duidelijke melding in plaats van hem weg te
-- gooien. Idempotent: bestaat de tabel niet (meer), dan is dit een no-op.

begin;

do $$
declare aantal bigint;
begin
  if to_regclass('public.subscriptions') is null then
    raise notice 'public.subscriptions bestaat niet (meer) — niets te doen';
    return;
  end if;

  -- Lock vóór de telling: tussen count en drop kan anders nog een rij
  -- binnenkomen die dan alsnog meegaat. Kans is nul (geen codepad raakt de
  -- tabel), de grendel is gratis.
  execute 'lock table public.subscriptions in access exclusive mode';
  execute 'select count(*) from public.subscriptions' into aantal;
  if aantal > 0 then
    raise exception 'public.subscriptions bevat % rij(en) — niet gedropt. Kijk eerst wat erin staat.', aantal;
  end if;

  execute 'drop table public.subscriptions';
  raise notice 'public.subscriptions gedropt (was leeg)';
end $$;

commit;

-- Harde post-conditie: raise notice is in de SQL Editor niet altijd zichtbaar,
-- dus laat de migratie zelf gillen als de uitkomst niet klopt.
do $$
begin
  if to_regclass('public.subscriptions') is not null then
    raise exception 'post-conditie faalt: public.subscriptions bestaat nog';
  end if;
  if to_regclass('public.push_subscriptions') is null then
    raise exception 'ALARM: push_subscriptions is weg — dat had niet mogen gebeuren';
  end if;
end $$;

-- === Structuur vóór het droppen (live afgelezen 02-08-2026, tabel was leeg) ===
--
-- Deze tabel is buiten de migratiehistorie om ontstaan: geen enkel .sql-bestand
-- in deze map bevat zijn create table. Na de drop is de definitie dus nergens
-- meer terug te vinden — vandaar dat ze hier staat. Er ging geen data verloren.
--
-- create table public.subscriptions (
--   id           uuid primary key default gen_random_uuid(),
--   user_id      uuid not null default auth.uid()
--                  references auth.users(id) on delete cascade,
--   name         text not null,
--   amount       numeric not null default 0,
--   cycle        text not null default 'maandelijks'
--                  check (cycle = any (array['maandelijks', 'jaarlijks'])),
--   category     text,
--   next_renewal date,
--   active       boolean not null default true,
--   note         text,
--   created_at   timestamptz not null default now(),
--   updated_at   timestamptz not null default now()
-- );
-- create index subscriptions_user_idx on public.subscriptions using btree (user_id);
-- RLS aan, 4 policies subs_{select,insert,update,delete}_own op
-- (select auth.uid()) = user_id.
