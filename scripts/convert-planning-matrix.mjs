import fs from 'node:fs';
import path from 'node:path';

const MONTHS = {
  jan: '01',
  feb: '02',
  mrt: '03',
  mar: '03',
  apr: '04',
  mei: '05',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  okt: '10',
  oct: '10',
  nov: '11',
  dec: '12',
};

function normalizeDate(raw) {
  const value = String(raw || '').trim();
  const parts = value.split('-');
  if (parts.length !== 3) return value;

  const [day, monthRaw, yearRaw] = parts;
  const month = MONTHS[monthRaw.toLowerCase()];
  if (!month) return value;

  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function parsePlanningMatrix(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('Bestand bevat geen bruikbare rijen.');
  }

  const header = lines[0].split(';').map((cell) => cell.trim());
  const firstTotalsIndex = header.findIndex((cell, index) => index > 1 && cell.toLowerCase() === 'aantal');
  if (firstTotalsIndex === -1) {
    throw new Error('Kolom "aantal" niet gevonden. Headerformaat wijkt af.');
  }

  const driverColumns = [];
  for (let index = 2; index < firstTotalsIndex; index += 1) {
    const name = header[index]?.trim();
    if (!name) continue;
    driverColumns.push({ index, name });
  }

  const rows = lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(';');
    const scheduleDate = normalizeDate(cells[0]);
    const dayType = String(cells[1] || '').trim();
    const assignments = {};

    for (const driver of driverColumns) {
      const rawCode = String(cells[driver.index] || '').trim();
      if (!rawCode) continue;
      assignments[driver.name] = rawCode;
    }

    return {
      id: `${scheduleDate}-${rowIndex + 1}`,
      source_date: scheduleDate,
      day_type: dayType,
      assignments,
      raw_row: line,
    };
  });

  return rows;
}

function writeOutputs(inputPath, rows) {
  const parsedPath = path.parse(inputPath);
  const outputDir = parsedPath.dir;
  const baseName = parsedPath.name.replace(/\s+/g, '-').toLowerCase();
  const jsonPath = path.join(outputDir, `${baseName}.planning-matrix.json`);
  const csvPath = path.join(outputDir, `${baseName}.planning-matrix.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2));

  const csvLines = [
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
  ];
  fs.writeFileSync(csvPath, csvLines.join('\n'));

  return { jsonPath, csvPath };
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Gebruik: npm run convert:planning-matrix -- "/pad/naar/bestand.csv"');
  process.exit(1);
}

const absoluteInputPath = path.resolve(inputPath);
const rows = parsePlanningMatrix(absoluteInputPath);
const outputs = writeOutputs(absoluteInputPath, rows);

console.log(`Geparseerde dagen: ${rows.length}`);
console.log(`JSON output: ${outputs.jsonPath}`);
console.log(`CSV output: ${outputs.csvPath}`);
