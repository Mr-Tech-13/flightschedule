const timePattern = /\b(\d{3,4})\b/;
const flightPattern = /\b([A-Z]{2})\s*(\d{1,4}[A-Z]?)\s*([A-Z]{3})\s*(\d{3,4})\b/i;

function isoAt(date, hhmm, timezone = 'local') {
  const digits = hhmm.padStart(4, '0');
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2));
  if (hour > 23 || minute > 59) return null;
  return `${date}T${digits.slice(0,2)}:${digits.slice(2)}:00`;
}

export function parseFlightText(text, serviceDate) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const candidates = [];
  let pending = [];
  let notes = [];
  const flush = () => {
    if (!pending.length) return;
    const first = pending[0], second = pending[1];
    candidates.push({
      airline: first.airline, arrivalNumber: first.number, departureNumber: second?.number || null,
      origin: first.airport, destination: second?.airport || null,
      arrivalAt: isoAt(serviceDate, first.time), departureAt: second ? isoAt(serviceDate, second.time) : null,
      gate: null, aircraft: null, ferry: !!first.ferry || !!second?.ferry, priority: false, notes: notes.join('\n'), confidence: second ? 'paired' : 'needs-confirmation'
    });
    pending = []; notes = [];
  };
  for (const line of lines) {
    const match = line.replace(/\s+/g, ' ').match(flightPattern);
    if (match) {
      if (pending.length === 2 || (pending.length && pending[0].airline !== match[1].toUpperCase())) flush();
      pending.push({ airline: match[1].toUpperCase(), number: `${match[1].toUpperCase()}${match[2].toUpperCase()}`, airport: match[3].toUpperCase(), time: match[4], ferry: /FERRY/i.test(line) });
      continue;
    }
    const gate = line.match(/GATE\s*(\w+)/i);
    if (gate && pending.length) { if (pending.length >= 1) { flush(); candidates.at(-1).gate = gate[1].toUpperCase(); } continue; }
    if (/^N\d+[A-Z]+$/i.test(line) && candidates.length) candidates.at(-1).aircraft = line.toUpperCase();
    else if (/FERRY/i.test(line) && (pending.length || candidates.length)) (candidates.at(-1) || {}).ferry = true;
    else if (/PRIORITY|STAR/i.test(line) && candidates.length) candidates.at(-1).priority = true;
    else notes.push(line);
  }
  flush();
  return candidates;
}
