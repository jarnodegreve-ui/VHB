import fs from 'node:fs';
import path from 'node:path';
import { parsePlanningMatrixCsv } from '../api/planningMatrix.ts';

function csvEscape(value: unknown) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Gebruik: npm run convert:planning-matrix -- "/pad/naar/bestand.csv"');
  process.exit(1);
}

const absoluteInputPath = path.resolve(inputPath);
const rows = parsePlanningMatrixCsv(fs.readFileSync(absoluteInputPath, 'utf8'));
const parsedPath = path.parse(absoluteInputPath);
const baseName = parsedPath.name.replace(/\s+/g, '-').toLowerCase();
const jsonPath = path.join(parsedPath.dir, `${baseName}.planning-matrix.json`);
const csvPath = path.join(parsedPath.dir, `${baseName}.planning-matrix.csv`);

fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
fs.writeFileSync(
  csvPath,
  [
    ['id', 'source_date', 'day_type', 'assignments', 'raw_row'].join(','),
    ...rows.map((row) =>
      [
        csvEscape(row.id),
        csvEscape(row.source_date),
        csvEscape(row.day_type),
        csvEscape(JSON.stringify(row.assignments)),
        csvEscape(row.raw_row),
      ].join(','),
    ),
  ].join('\n'),
);

console.log(`Geparseerde dagen: ${rows.length}`);
console.log(`JSON output: ${jsonPath}`);
console.log(`CSV output: ${csvPath}`);
