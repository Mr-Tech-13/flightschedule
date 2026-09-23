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

export function normalizeWeekStart(value) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? new Date(`${value}T12:00:00`) : new Date();
  const offset = (parsed.getDay() + 6) % 7;
  parsed.setDate(parsed.getDate() - offset);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

export function parseEmployeeRows(input, weekStart) {
  const rows = unwrapWorkbookRows(input);
  const result = [];
  const start = new Date(`${normalizeWeekStart(weekStart)}T12:00:00`);
  let role = 'agent';

  for (const row of rows) {
    const rawName = String(row?.[0] ?? '').trim();
    if (/^ramp supervisor/i.test(rawName)) { role = 'supervisor'; continue; }
    if (/^ramp lead/i.test(rawName)) { role = 'lead'; continue; }
    if (/^ramp agents?/i.test(rawName)) { role = 'agent'; continue; }
    if (!rawName || /^(monday|open line|alaska|mx|sy)$/i.test(rawName)) continue;
    const customsSeal = /\s+s\.?$/i.test(rawName);
    const name = rawName.replace(/\s+s\.?$/i, '').trim();

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
    result.push({ name, role, customsSeal, shifts });
  }
  return result;
}
