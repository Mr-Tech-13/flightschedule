function normalizeTime(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

export function unwrapWorkbookRows(workbook) {
  if (!Array.isArray(workbook)) return [];
  if (workbook.every(item => item && Array.isArray(item.data))) {
    return workbook.flatMap(item => item.data);
  }
  return workbook;
}

export function parseEmployeeRows(input, weekStart) {
  const rows = unwrapWorkbookRows(input);
  const result = [];
  const start = new Date(`${weekStart || new Date().toISOString().slice(0, 10)}T12:00:00`);
  let role = 'agent';

  for (const row of rows) {
    const name = String(row?.[0] ?? '').trim();
    if (/^ramp supervisor/i.test(name)) { role = 'supervisor'; continue; }
    if (/^ramp lead/i.test(name)) { role = 'lead'; continue; }
    if (/^ramp agents?/i.test(name)) { role = 'agent'; continue; }
    if (!name || /^(monday|open line|alaska|mx|sy)$/i.test(name)) continue;

    const shifts = [];
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const shiftStart = normalizeTime(row[1 + dayOffset * 2]);
      const shiftEnd = normalizeTime(row[2 + dayOffset * 2]);
      if (!shiftStart || !shiftEnd) continue;
      const date = new Date(start);
      date.setDate(start.getDate() + dayOffset);
      const workDate = date.toISOString().slice(0, 10);
      const endDate = new Date(date);
      if (shiftEnd <= shiftStart) endDate.setDate(endDate.getDate() + 1);
      shifts.push({ date: workDate, start: `${workDate}T${shiftStart}:00`, end: `${endDate.toISOString().slice(0, 10)}T${shiftEnd}:00` });
    }
    if (shifts.length) result.push({ name, role, shifts });
  }
  return result;
}
