export interface PlanningMatrixRow {
  id: string;
  source_date: string;
  day_type: string;
  assignments: Record<string, string>;
  raw_row: string;
}

const MONTHS: Record<string, string> = {
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

export function normalizePlanningMatrixDate(raw: string): string {
  const value = String(raw || '').trim();
  const parts = value.split('-');
  if (parts.length !== 3) return value;

  const [day, monthRaw, yearRaw] = parts;
  const month = MONTHS[monthRaw.toLowerCase()];
  if (!month) return value;

  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

export function parsePlanningMatrixCsv(csvContent: string): PlanningMatrixRow[] {
  const raw = csvContent.replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('Bestand bevat geen bruikbare rijen.');
  }

  const header = lines[0].split(';').map((cell) => cell.trim());
  const firstTotalsIndex = header.findIndex((cell, index) => index > 1 && cell.toLowerCase() === 'aantal');
  if (firstTotalsIndex === -1) {
    throw new Error('Kolom "aantal" niet gevonden. Dit CSV-formaat wordt niet herkend.');
  }

  const driverColumns = header
    .slice(2, firstTotalsIndex)
    .map((name, offset) => ({ index: offset + 2, name: name.trim() }))
    .filter((column) => column.name.length > 0);

  return lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(';');
    const sourceDate = normalizePlanningMatrixDate(cells[0] || '');
    const assignments: Record<string, string> = {};

    for (const driver of driverColumns) {
      const rawCode = String(cells[driver.index] || '').trim();
      if (!rawCode) continue;
      assignments[driver.name] = rawCode;
    }

    return {
      id: `${sourceDate}-${rowIndex + 1}`,
      source_date: sourceDate,
      day_type: String(cells[1] || '').trim(),
      assignments,
      raw_row: line,
    };
  });
}
