/**
 * Eén bron van waarheid voor "welke kolommen verwacht de code in Supabase".
 *
 * Twee consumenten:
 * - GET /api/health/schema probe't deze kolommen live tegen prod (PostgREST
 *   valideert kolomnamen) → detecteert een niet-gedraaide migratie.
 * - src/schemaContract.test.ts assert dat de toDatabase*-mappers exact binnen
 *   deze lijsten schrijven → een nieuwe mapper-kolom zonder probe-update (en
 *   dus zonder schema-check-dekking) faalt in CI.
 *
 * LET OP de bewuste casing-verschillen per tabel: users/swaps/leave zijn
 * unquoted→lowercase, planning/services/diversions zijn quoted camelCase (via
 * de Table Editor aangemaakt), planning_codes is snake_case. Diversions stond
 * hier fout als lowercase — precies de drift die omleiding-saves brak.
 */
export const TABLE_PROBES: Array<{ table: string; columns: string }> = [
  // startdate hoort bij PR #122 (anciënniteit) — staat hier alvast zodat de
  // schema-check meldt wanneer de migratie add_user_start_date.sql nog moet.
  // dashboardvoorkeuren (jsonb): 2026-09-06_meldingen.sql — alleen via
  // PATCH /api/me/voorkeuren geschreven (niet door toDatabaseUser).
  { table: "users", columns: "id,name,role,employeeid,lastlogin,activesessions,isactive,phone,email,verlofbudget,showincontacts,section,startdate,wantssystemmail,authid,dashboardvoorkeuren" },
  { table: "planning", columns: "id,date,startTime,endTime,line,busNumber,loopnr,driverId" },
  { table: "planning_matrix_rows", columns: "id,source_date,day_type,assignments,raw_row,created_at" },
  { table: "planning_codes", columns: "code,category,description,counts_as_shift,is_paid_absence,is_day_off" },
  { table: "services", columns: "id,serviceNumber,startTime,endTime,startTime2,endTime2,startTime3,endTime3,loopnr,loopnr2,loopnr3" },
  // severity bestaat live nog (nullable) maar wordt niet meer geschreven;
  // mapCoordinates bestaat live NIET en is uit de schrijfmapper gehaald.
  // location: plaats van de omleiding (2026-09-10_diversions_location.sql);
  // zonder migratie valt de upsert terug op de kolommen zonder location.
  { table: "diversions", columns: "id,line,title,description,startDate,endDate,severity,pdfUrl,location" },
  // updates stond hier niet; sinds 2026-09-21_updates_bijlagen.sql meldt de
  // schema-check ook de twee kolommen van de PDF-bijlagen. Bewust zónder
  // `isurgent`: die kolom bestaat live niet, toDatabaseUpdate schrijft hem
  // best-effort en zou de check dus altijd rood zetten.
  { table: "updates", columns: "id,date,title,content,category,bijlagen,bijlagen_tonen" },
  // swap_type: ruil zonder tegenprestatie (supabase/swaps_swap_type.sql).
  // shift_date/shift_line: planning-doorvoer (2026-08-01_swaps_shift_info.sql).
  // target_seen_at: gezien-bevestiging door de ontvanger (2026-08-16_swaps_target_seen.sql).
  { table: "swaps", columns: "id,shiftid,requesterid,targetdriverid,status,createdat,reason,decidedat,return_date,return_code,swap_type,shift_date,shift_line,target_seen_at" },
  { table: "leave", columns: "id,userid,startdate,enddate,type,status,comment,createdat,decidedat,beslisreden" },
  // entity_type/entity_id: koppeling naar het gelogde record
  // (supabase/activity_log_entity_columns.sql). Ontbraken hier, terwijl
  // api/storage.ts ze bij élke logregel schrijft — de health-check meldde dus
  // "ok" in een omgeving waar die migratie nog moest.
  { table: "activity_log", columns: "id,created_at,actor_name,actor_role,category,action,details,entity_type,entity_id" },
  // user_documents hoort bij de documenten-module (supabase/user_documents.sql)
  // — staat hier alvast zodat de schema-check meldt zolang die migratie nog
  // niet gedraaid is.
  // opened_at: leesbevestiging (supabase/2026-07-30_user_documents_opened.sql).
  { table: "user_documents", columns: "id,user_id,filename,storage_path,category,size_bytes,uploaded_at,uploaded_by,opened_at" },
  // app_settings hoort bij de toestel-schakelaar (supabase/2026-07-30_app_settings.sql)
  // — staat hier alvast zodat de schema-check meldt zolang die migratie mist.
  { table: "app_settings", columns: "key,value,updated_at" },
  // planning_notes hoort bij de dienstnotities (2026-07-30_planning_notes.sql)
  { table: "planning_notes", columns: "driver_id,date,note,updated_by,updated_at" },
  // Import-historiek + herstelpunt (2026-08-20_import_historiek.sql). Stond
  // hier niet, terwijl savePlanningMatrixHistoryEntry al deze kolommen
  // schrijft — een niet-gedraaide migratie bleef zo onzichtbaar voor de
  // schema-check (controle-ronde 27-08, bevinding 25).
  // Meldingencentrum (2026-09-06_meldingen.sql): elke push wordt ook als rij
  // per gebruiker bewaard; snake_case zoals planning_notes.
  { table: "meldingen", columns: "id,user_id,titel,tekst,soort,doel,created_at,gelezen_op" },
  // Aanwezigheid (2026-09-18_user_presence.sql): één rij per aaneengesloten
  // sessie, geschreven vanuit de auth-middleware. Zonder de migratie werkt het
  // portaal gewoon door (registreren is best-effort), dus alleen de
  // schema-check maakt zichtbaar dat ze nog moet draaien.
  // land/regio/stad: plaats van aanmelden (2026-09-20_user_presence_locatie.sql);
  // zonder die migratie schrijft noteerAanwezigheid zonder plaats verder.
  { table: "user_presence", columns: "id,user_id,role,started_at,last_seen_at,land,regio,stad" },
  // Techniek (2026-09-13_techniek_voertuigen.sql): voertuigen, gele boek,
  // werkprestaties en vervaldata per voertuig; snake_case, API-only.
  { table: "vehicles", columns: "id,busnr,kort_nr,nummerplaat,chassisnr,merk,type,categorie,aandrijving,status,in_dienst,uit_dienst,zitplaatsen,opmerking,chargeye_mix_id,created_at,updated_at" },
  { table: "vehicle_defects", columns: "id,vehicle_id,gemeld_op,gemeld_door,werktype,omschrijving,status,uitgevoerd_op,uitgevoerd_door,uitgevoerd_werk,manuren,opmerking,updated_at" },
  { table: "vehicle_work", columns: "id,datum,mecanicien_id,vehicle_id,werkcode,omschrijving,begin_tijd,einde_tijd,werkuren,kmstand,defect_id,created_at,updated_at" },
  { table: "vehicle_expiries", columns: "vehicle_id,soort,valid_until,opmerking,updated_at,updated_by" },
  // Loon (2026-09-13_loon_dagafsluiting.sql): looncodes, matricules, dagafsluiting.
  { table: "loon_codes", columns: "code,code_weergave,omschrijving,dienst_type,in_export,easypay_activiteit,easypay_type_prest,tik1,tik2,tik3,tik4,tik5,tik6,lb_rijtijd,lb_stat100_at,lb_stat100_nat,lb_stat50_nat,lb_ond,lb_and_wrk,lb_nacht,bron,updated_at,updated_by" },
  { table: "loon_medewerkers", columns: "user_id,easypay_nr,in_export,updated_at,updated_by" },
  { table: "dag_afsluitingen", columns: "datum,status,geopend_op,geopend_door,afgesloten_op,afgesloten_door,heropend_op,heropend_door,heropend_reden" },
  { table: "dag_prestaties", columns: "id,datum,user_id,volgnr,planning_code,gereden_code,overmin,overmin_nacht,overmin_extra,onv_premie,qual_ongeval,qual_panne,qual_verkeersovertreding,qual_klantklacht,qual_admfout,qual_interneklacht,qual_vertraging_dr_schuld,qual_rit_nt_gereden_dr_schuld,opmerking,bewerkt_op,bewerkt_door" },
  // Dienstopbouw (2026-09-13_service_segments.sql): ET-imports, ritdelen, dagtypecodes.
  { table: "service_segment_imports", columns: "id,created_at,imported_by,filename,rijen,diensten,dagtypes,waarschuwingen,bevindingen,actief,actief_sinds" },
  { table: "service_segments", columns: "id,import_id,service_number,dagtype_code,volgorde,type,start_min,einde_min,duur_min,loop,intern_loop,lijn,variant,rit,voertuig,vertrek,vertrek_code,aankomst,aankomst_code,afstand_km,at_tijd,vt_tijd" },
  { table: "dagtype_codes", columns: "code,omschrijving,periode,aantal_per_jaar,portaal_dagtype,updated_at" },
  { table: "planning_matrix_import_history", columns: "id,created_at,imported_days,detected_drivers,generated_shifts,matched_services,skipped_absences,unknown_codes,unmatched_drivers,filename,imported_by,period_start,period_end,file_start,file_end,snapshot_path" },
];

export const probeColumns = (table: string): string[] => {
  const probe = TABLE_PROBES.find((p) => p.table === table);
  return probe ? probe.columns.split(",") : [];
};
