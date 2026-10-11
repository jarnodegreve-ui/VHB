-- 2026-10-11 — Dagtypekalender (verbeterronde 11-10, punt 1, akkoord Jarno).
--
-- De Lijn deelt elke dag in op dagtype: 21-25 schooldag ma-vr, 26 zaterdag,
-- 27 zondag, 28 feestdag (rijdt de zondagregeling 27), 31-35 schoolvakantie,
-- 41-45 juli-augustus, 51-55 examen. Tot nu leidde het portaal dat dagtype af
-- uit de code in de planningsmatrix of uit de dekkingskalender (eigen namen,
-- feestdag = "zondag"). Jarno levert de officiële kalender per jaar als CSV
-- (datum, typedag, max_verlof); dit is haar tabel: één rij per datum.
--
-- Gebruik (shared/dagtype.ts, dagtypeVanDag): de code uit de planningsmatrix
-- wint altijd, daarna deze kalender, daarna de dekkingsafleiding. Een verschil
-- tussen matrix en kalender is een opmerking in het beheerscherm, nooit een
-- blokkade (keuze Jarno 11-10). max_verlof (hoeveel chauffeurs tegelijk met
-- verlof) voedt de verloflimiet per dag; null = de gewone verlofinstellingen.
--
-- Server-only tabel (API via de service role): RLS aan zonder policies,
-- grants voor anon/authenticated ingetrokken (patroon dienstregelingen).
-- Raakt dus RLS en grants: na het draaien op productie
-- `node --env-file=.env.local scripts/beleid-drift.mjs --update` en
-- supabase/beleid-snapshot.json mee committen.
--
-- Idempotent: veilig om opnieuw te draaien.

begin;

create table if not exists public.dagtype_kalender (
  datum date primary key,
  -- De Lijn-dagtypecode, twee cijfers (zie boven).
  typedag text not null constraint dagtype_kalender_typedag_check check (typedag ~ '^(2[1-8]|3[1-5]|4[1-5]|5[1-5])$'),
  -- Hoeveel chauffeurs tegelijk met verlof mogen; null = de gewone verlofinstellingen.
  max_verlof integer constraint dagtype_kalender_max_verlof_check check (max_verlof is null or (max_verlof >= 0 and max_verlof <= 200)),
  -- Waar de rij vandaan komt: 'csv' (import) of 'hand' (per dag aangepast in het scherm).
  bron text not null default 'csv',
  updated_at timestamptz not null default now()
);

comment on table public.dagtype_kalender is
  'Het De Lijn-dagtype per datum (21-28, 31-35, 41-45, 51-55) en het verlofmaximum van die dag; bron van dagtypeVanDag ná de planningsmatrix.';

alter table public.dagtype_kalender enable row level security;
revoke all on table public.dagtype_kalender from anon, authenticated;
grant all on table public.dagtype_kalender to service_role;

drop trigger if exists dagtype_kalender_set_updated_at on public.dagtype_kalender;
create trigger dagtype_kalender_set_updated_at
  before update on public.dagtype_kalender
  for each row execute function public.set_updated_at();

-- === register ===
insert into public.schema_migraties (bestand)
values ('2026-10-11_dagtype_kalender.sql')
on conflict (bestand) do nothing;

commit;
