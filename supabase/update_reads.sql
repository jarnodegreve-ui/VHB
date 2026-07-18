-- Leesbevestigingen op updates (verbeterronde 2026-07): de planner wil zien
-- of een (urgente) mededeling aankomt bij de chauffeurs — 'X/Y gelezen'.
--
-- Eén rij per (update, gebruiker): gezet zodra de chauffeur de Updates-
-- weergave opent. Schrijven/tellen loopt via de API met de service role, dus
-- bewust GEEN select/insert-policies (RLS aan = dicht voor anon/authenticated;
-- service role passeert) — zelfde patroon als user_documents/OCPI-tabellen.
-- Server-only systeemtabel → snake_case (net als user_documents/activity_log),
-- niet de quoted-camelCase van de generieke collectiesync.
--
-- Idempotent; plakken en draaien in de Supabase SQL Editor.

begin;

create table if not exists public.update_reads (
  update_id text not null,
  user_id text not null,
  read_at timestamptz not null default now(),
  primary key (update_id, user_id)
);
-- De primary key (update_id, user_id) levert al een prefix-index op update_id,
-- dus de teller-query `count(*) where update_id = X` heeft geen losse index nodig.

-- Wees-rijen voorkomen: saveUpdatesData verwijdert geschrapte updates hard uit
-- public.updates, dus cascade de bijhorende leesbevestigingen mee weg. (De rest
-- van het schema is app-enforced; hier is een echte FK zinvol omdat deze tabel
-- ongelimiteerd aangroeit en niemand hem via de generieke sync beheert.)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'update_reads_update_id_fkey'
  ) then
    alter table public.update_reads
      add constraint update_reads_update_id_fkey
      foreign key (update_id) references public.updates(id) on delete cascade;
  end if;
end
$$;

alter table public.update_reads enable row level security;

commit;
