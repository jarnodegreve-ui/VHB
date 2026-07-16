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
 * LET OP de bewuste casing-verschillen per tabel: users/diversions/swaps/leave
 * zijn unquoted→lowercase, planning/services zijn quoted camelCase (via de
 * Table Editor aangemaakt), planning_codes is snake_case.
 */
export const TABLE_PROBES: Array<{ table: string; columns: string }> = [
  // startdate hoort bij PR #122 (anciënniteit) — staat hier alvast zodat de
  // schema-check meldt wanneer de migratie add_user_start_date.sql nog moet.
  { table: "users", columns: "id,name,role,employeeid,lastlogin,activesessions,isactive,phone,email,verlofbudget,showincontacts,section,startdate" },
  { table: "planning", columns: "id,date,startTime,endTime,line,busNumber,loopnr,driverId" },
  { table: "planning_matrix_rows", columns: "id,source_date,day_type,assignments,raw_row,created_at" },
  { table: "planning_codes", columns: "code,category,description,counts_as_shift,is_paid_absence,is_day_off" },
  { table: "services", columns: "id,serviceNumber,startTime,endTime,startTime2,endTime2,startTime3,endTime3" },
  { table: "diversions", columns: "id,line,title,description,startdate,enddate,severity,pdfurl,mapcoordinates" },
  { table: "swaps", columns: "id,shiftid,requesterid,targetdriverid,status,createdat,reason,decidedat,return_date,return_code" },
  { table: "leave", columns: "id,userid,startdate,enddate,type,status,comment,createdat,decidedat" },
  { table: "activity_log", columns: "id,created_at,actor_name,actor_role,category,action,details" },
];

export const probeColumns = (table: string): string[] => {
  const probe = TABLE_PROBES.find((p) => p.table === table);
  return probe ? probe.columns.split(",") : [];
};
