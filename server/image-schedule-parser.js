const ROLE_HEADERS = [
  { pattern: /supervisor/i, role: 'supervisor' },
  { pattern: /\blead\b/i, role: 'lead' },
  { pattern: /agents?\s*\(?\s*am/i, role: 'agent' },
  { pattern: /agents?\s*\(?\s*pm/i, role: 'agent' }
];

export function parseScheduleTsv(tsv, weekStart) {
  const words = parseWords(tsv);
  if (!words.length) return [];
  const pageWidth = Math.max(...words.map(word => word.pageWidth || word.x + word.width));
  const nameBoundary = pageWidth * 0.158;
  const dayWidth = (pageWidth - nameBoundary) / 7;
  const rows = clusterRows(words);
  const headers = [];
  for (const row of rows) {
    const text = row.map(word => word.text).join(' ');
    const header = ROLE_HEADERS.find(candidate => candidate.pattern.test(text));
    if (header) headers.push({ y: averageY(row), role: header.role });
  }

  const employees = [];
  for (const row of rows) {
    const y = averageY(row);
    const nameWords = row.filter(word => word.x < nameBoundary && word.confidence >= 15);
    const timeWords = row.filter(word => word.x >= nameBoundary).map(word => ({ ...word, time: normalizeTime(word.text) })).filter(word => word.time);
    if (!nameWords.length || timeWords.length < 2) continue;
    const name = cleanName(nameWords.map(word => word.text).join(' '));
    if (!isEmployeeName(name)) continue;
    const header = headers.filter(item => item.y < y).at(-1);
    if (!header) continue;
    const cells = Array.from({ length: 7 }, () => [null, null]);
    for (const word of timeWords) {
      const center = word.x + word.width / 2;
      const day = Math.floor((center - nameBoundary) / dayWidth);
      if (day < 0 || day > 6) continue;
      const withinDay = center - (nameBoundary + day * dayWidth);
      cells[day][withinDay < dayWidth / 2 ? 0 : 1] = word.time;
    }
    const shifts = cells.flatMap((cell, day) => cell[0] && cell[1] ? [makeShift(weekStart, day, cell[0], cell[1])] : []);
    if (shifts.length) employees.push({ name, role: header.role, shifts });
  }
  return deduplicate(employees);
}

function parseWords(tsv) {
  const words = [];
  let pageWidth = 0;
  for (const line of String(tsv || '').split(/\r?\n/).slice(1)) {
    const columns = line.split('\t');
    if (columns[0] === '1') pageWidth = Number(columns[8]);
    if (columns.length < 12 || columns[0] !== '5' || !columns[11].trim()) continue;
    words.push({ pageWidth, x: Number(columns[6]), y: Number(columns[7]), width: Number(columns[8]), height: Number(columns[9]), confidence: Number(columns[10]), text: columns[11].trim() });
  }
  const inferredWidth = pageWidth || Math.max(1, ...words.map(word => word.x + word.width));
  words.forEach(word => { word.pageWidth = inferredWidth; });
  return words;
}

function clusterRows(words) {
  const sorted = [...words].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x);
  const rows = [];
  for (const word of sorted) {
    const center = word.y + word.height / 2;
    let row = rows.find(candidate => Math.abs(candidate.center - center) <= 9);
    if (!row) { row = { center, words: [] }; rows.push(row); }
    row.words.push(word); row.center = row.words.reduce((sum, item) => sum + item.y + item.height / 2, 0) / row.words.length;
  }
  return rows.sort((a, b) => a.center - b.center).map(row => row.words.sort((a, b) => a.x - b.x));
}

function normalizeTime(value) {
  let text = String(value).toLowerCase().replace(/[o]/g, '0').replace(/[s]/g, '5').replace(/[il|]/g, '1').replace(/[^0-9:]/g, '');
  const colon = text.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) return validTime(Number(colon[1]), Number(colon[2]));
  text = text.replace(/:/g, '');
  if (text.length === 3 || text.length === 4) return validTime(Number(text.slice(0, -2)), Number(text.slice(-2)));
  return null;
}

function validTime(hour, minute) { return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : null; }
function averageY(row) { return row.reduce((sum, word) => sum + word.y + word.height / 2, 0) / row.length; }
function cleanName(value) { return value.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-zÀ-ÿ.' -]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function isEmployeeName(name) { return name.length >= 4 && /[A-Za-z].*\s+[A-Za-z]/.test(name) && !/(monday|tuesday|wednesday|thursday|friday|saturday|sunday|open line|ramp|alaska|allegiant|breeze|atlas)/i.test(name); }
function makeShift(weekStart, offset, start, end) { const date = new Date(`${weekStart}T12:00:00`);date.setDate(date.getDate() + offset);const workDate=date.toISOString().slice(0,10);const endDate=new Date(date);if(end <= start)endDate.setDate(endDate.getDate()+1);return { date:workDate,start:`${workDate}T${start}:00`,end:`${endDate.toISOString().slice(0,10)}T${end}:00` }; }
function deduplicate(employees) { const seen=new Set();return employees.filter(employee=>{const key=employee.name.toLowerCase();if(seen.has(key))return false;seen.add(key);return true}); }
