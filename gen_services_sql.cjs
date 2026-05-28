const XLSX = require('xlsx');
const fs = require('fs');

const wb = XLSX.readFile('/Users/jarnodegreve/Desktop/diensten.xlsx');
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet);

const formatExcelTime = (val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    const m = Math.round(val * 24 * 60);
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  const s = val.toString().trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return null;
  return s;
};

const q = (v) => (v === null ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'");

const services = rows
  .map((r, i) => {
    if (!r.dienst) return null;
    return {
      id: (1700000000000 + i).toString(),
      sn: r.dienst.toString().trim(),
      s1: formatExcelTime(r.begin),
      e1: formatExcelTime(r.einde),
      s2: formatExcelTime(r.begin_1),
      e2: formatExcelTime(r.einde_1),
      s3: formatExcelTime(r.begin_2),
      e3: formatExcelTime(r.einde_2),
    };
  })
  .filter(Boolean);

const lines = services
  .map((s) =>
    '(' +
    [s.id, s.sn, s.s1 || '', s.e1 || '', s.s2, s.e2, s.s3, s.e3].map(q).join(',') +
    ')'
  )
  .join(',\n  ');

const sql = [
  `-- Volledige diensten-set uit diensten.xlsx (${services.length} rijen)`,
  '-- Gebruikt quoted camelCase column-namen om te matchen met de actuele schema.',
  '-- Run in Supabase SQL editor.',
  '',
  "delete from public.services where id <> '__never__';",
  '',
  'insert into public.services (id, "serviceNumber", "startTime", "endTime", "startTime2", "endTime2", "startTime3", "endTime3") values',
  '  ' + lines + ';',
].join('\n');

fs.writeFileSync('/Users/jarnodegreve/PlanX/supabase/_seed_services_from_excel.sql', sql);
console.log('Geschreven:', sql.length, 'tekens,', services.length, 'services.');
