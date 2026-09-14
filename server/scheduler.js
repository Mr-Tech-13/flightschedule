import { id, tx } from './db.js';

export async function autoSchedule(serviceDate) {
  return tx(async client => {
    await client.query(`DELETE FROM assignments a USING flights f WHERE a.flight_id=f.id AND f.service_date=$1 AND a.locked=false`, [serviceDate]);
    const flights = (await client.query(`SELECT f.*, (f.international OR COALESCE(al.international,false)) is_international, COALESCE(al.lead_required,1) lead_required, COALESCE(al.agent_required,2) agent_required, COALESCE(al.arrival_lead_minutes,15) arrival_lead_minutes, COALESCE(al.post_departure_minutes,10) post_departure_minutes FROM flights f LEFT JOIN airlines al ON al.code=f.airline WHERE f.service_date=$1 ORDER BY COALESCE(f.arrival_at,f.departure_at), f.priority DESC`, [serviceDate])).rows;
    const employees = (await client.query(`SELECT e.*,s.starts_at,s.ends_at,COALESCE(json_agg(q.*) FILTER(WHERE q.employee_id IS NOT NULL),'[]') qualifications FROM employees e JOIN shifts s ON s.employee_id=e.id AND s.work_date=$1 LEFT JOIN employee_qualifications q ON q.employee_id=e.id WHERE e.deleted_at IS NULL AND e.pending_deletion=false AND NOT EXISTS (SELECT 1 FROM callouts c WHERE c.employee_id=e.id AND c.work_date=$1) GROUP BY e.id,s.starts_at,s.ends_at`, [serviceDate])).rows;
    const locked = (await client.query(`SELECT a.*,f.arrival_at,f.departure_at,COALESCE(al.arrival_lead_minutes,15) pre,COALESCE(al.post_departure_minutes,10) post FROM assignments a JOIN flights f ON f.id=a.flight_id LEFT JOIN airlines al ON al.code=f.airline WHERE f.service_date=$1`, [serviceDate])).rows;
    const busy = new Map();
    for (const a of locked) (busy.get(a.employee_id) || busy.set(a.employee_id, []).get(a.employee_id)).push(windowFor(a));
    const shortages = [];
    for (const flight of flights) {
      const win = windowFor({ ...flight, pre: flight.arrival_lead_minutes, post: flight.post_departure_minutes });
      const current = locked.filter(a => a.flight_id === flight.id);
      for (const role of ['lead','agent']) {
        const required = Number(role === 'lead' ? flight.lead_required : flight.agent_required);
        for (let n = current.filter(a => a.role === role).length; n < required; n++) {
          const choices = employees.filter(e => eligible(e, role, flight.airline, flight.is_international) && new Date(e.starts_at) <= win.start && new Date(e.ends_at) >= win.end && !(busy.get(e.id) || []).some(b => overlaps(b, win)))
            .sort((a,b) => score(b, flight.airline) - score(a, flight.airline));
          const chosen = choices[0];
          if (!chosen) { shortages.push({ flightId: flight.id, role }); continue; }
          await client.query('INSERT INTO assignments(id,flight_id,employee_id,role) VALUES($1,$2,$3,$4)', [id(), flight.id, chosen.id, role]);
          (busy.get(chosen.id) || busy.set(chosen.id, []).get(chosen.id)).push(win);
        }
      }
    }
    return { flights: flights.length, shortages };
  });
}

function eligible(e, role, airline, international) {
  if (!e.eligible_roles.includes(role)) return false;
  if (international && !e.customs_seal) return false;
  const qualification = e.qualifications.find(q => q.airline === airline);
  if (role === 'lead' && qualification && !qualification.can_lead) return false;
  return true;
}
function score(e, airline) { const qualification=e.qualifications.find(q=>q.airline===airline);return (qualification?Number(qualification.priority)+50:50)+(e.primary_role==='lead'?10:0); }
function overlaps(a,b) { return a.start < b.end && b.start < a.end; }
function windowFor(f) {
  const anchor = new Date(f.arrival_at || f.departure_at);
  const endAnchor = new Date(f.departure_at || f.arrival_at);
  return { start: new Date(anchor.getTime() - Number(f.pre || 15) * 60000), end: new Date(endAnchor.getTime() + Number(f.post || 10) * 60000) };
}
