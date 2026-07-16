-- Ritbladen-bucket privé maken (controle-ronde 2026-07, punt 17).
--
-- Waarom: de bucket stond op public read, waardoor het ritblad (interne
-- dienstinfo) zonder sessie bereikbaar was voor iedereen die de URL kent of
-- raadt. De API levert sinds de bijbehorende code-wijziging ondertekende
-- URL's (30 dagen geldig) via GET /api/ritblaadje — de bucket hoeft dus niet
-- langer publiek te zijn. Uploads/deletes lopen al via de service role.
--
-- Volgorde is veilig: de code met signed URLs werkt ook zolang de bucket nog
-- publiek staat, dus eerst deployen en daarna deze migratie draaien kan.
-- Idempotent: meermaals draaien is onschadelijk.

update storage.buckets
set public = false
where id = 'ritblaadjes'
  and public = true;

-- Er bestaan geen aparte storage.objects-policies voor deze bucket (lezen
-- gebeurde via de public-vlag, schrijven via service role) — er valt dus
-- niets extra te droppen.
