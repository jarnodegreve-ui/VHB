-- Omleidings-bijlagen privé maken (controle-ronde 2026-07-26, bevinding 13).
-- Idempotent; plakken/draaien in de SQL Editor.
--
-- Waarom: de bucket stond op public=true, dus elke PDF-URL bleef eeuwig en
-- voor iedereen bereikbaar — ook nadat een medewerker uit dienst was. Zelfde
-- patroon als ritbladen en persoonlijke documenten: bucket privé, de API
-- ondertekent per request (GET /api/diversions, TTL 12u).
--
-- Volgorde: eerst de code deployen die ondertekende URL's maakt, daarna dit
-- script draaien. Draai je het eerder, dan geven bestaande publieke links
-- 400 tot de deploy live is.

update storage.buckets set public = false where id = 'diversions';

-- Vangnet voor een omgeving waar de bucket nog niet bestaat.
insert into storage.buckets (id, name, public)
values ('diversions', 'diversions', false)
on conflict (id) do nothing;
