import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import readXlsxFile from 'read-excel-file/node';
import { createWorker } from 'tesseract.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, id, migrate, tx } from './db.js';
import { allow, authenticate, createAccount, ensureAdmin, login, logout, publicAccount } from './auth.js';
import { parseFlightText } from './flight-parser.js';
import { autoSchedule } from './scheduler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upload = multer({ dest: path.join(root, 'data/uploads'), limits: { fileSize: 15 * 1024 * 1024 } });
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"] } } }));
app.use(express.json({ limit: '1mb' })); app.use(cookieParser());
app.post('/api/auth/login', login); app.post('/api/auth/logout', logout);
app.use('/api', authenticate);

app.get('/api/me', (req,res) => res.json({ account: req.account }));
app.get('/api/dashboard', async (req,res,next) => { try {
  const date = req.query.date || new Date().toISOString().slice(0,10);
  const [flights, employees, coverage] = await Promise.all([
    pool.query(`SELECT f.*,COALESCE(al.lead_required,1) lead_required,COALESCE(al.agent_required,2) agent_required,
      COALESCE(json_agg(json_build_object('id',a.id,'employeeId',e.id,'name',e.name,'role',a.role,'locked',a.locked)) FILTER(WHERE a.id IS NOT NULL),'[]') assignments
      FROM flights f LEFT JOIN airlines al ON al.code=f.airline LEFT JOIN assignments a ON a.flight_id=f.id LEFT JOIN employees e ON e.id=a.employee_id
      WHERE f.service_date=$1 GROUP BY f.id,al.lead_required,al.agent_required ORDER BY COALESCE(f.arrival_at,f.departure_at)`, [date]),
    pool.query(`SELECT e.*,s.starts_at,s.ends_at,(c.id IS NOT NULL) called_out FROM employees e LEFT JOIN shifts s ON s.employee_id=e.id AND s.work_date=$1 LEFT JOIN callouts c ON c.employee_id=e.id AND c.work_date=$1 WHERE e.deleted_at IS NULL ORDER BY e.name`, [date]),
    pool.query(`SELECT slots.slot, count(s.id) FILTER(WHERE s.starts_at<=slots.slot AND s.ends_at>slots.slot AND c.id IS NULL) employees
      FROM generate_series($1::date,$1::date+interval '1 day',interval '30 min') slots(slot)
      LEFT JOIN shifts s ON s.work_date=$1 LEFT JOIN callouts c ON c.employee_id=s.employee_id AND c.work_date=$1 GROUP BY slots.slot ORDER BY slots.slot`, [date])
  ]);
  res.json({ date, flights: flights.rows, employees: employees.rows, coverage: coverage.rows });
} catch(e){next(e)} });

app.post('/api/flights/parse', allow('admin','scheduler'), (req,res) => res.json({ flights: parseFlightText(String(req.body.text || ''), req.body.date || new Date().toISOString().slice(0,10)) }));
app.post('/api/flights/import', allow('admin','scheduler'), async (req,res,next) => { try {
  const rows = Array.isArray(req.body.flights) ? req.body.flights : [];
  await tx(async c => { for (const f of rows) await c.query(`INSERT INTO flights(id,service_date,airline,arrival_number,departure_number,origin,destination,arrival_at,departure_at,gate,aircraft,notes,ferry,priority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [id(),req.body.date,f.airline,f.arrivalNumber,f.departureNumber,f.origin,f.destination,f.arrivalAt,f.departureAt,f.gate,f.aircraft,f.notes,!!f.ferry,!!f.priority]); });
  res.status(201).json({ imported: rows.length });
} catch(e){next(e)} });
app.post('/api/flights', allow('admin','scheduler'), async (req,res,next) => { try { const f=req.body; const result=await pool.query(`INSERT INTO flights(id,service_date,airline,arrival_number,departure_number,origin,destination,arrival_at,departure_at,gate,notes,priority,ferry) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[id(),f.serviceDate,f.airline.toUpperCase(),f.arrivalNumber||null,f.departureNumber||null,f.origin||null,f.destination||null,f.arrivalAt||null,f.departureAt||null,f.gate||null,f.notes||null,!!f.priority,!!f.ferry]);res.status(201).json(result.rows[0]); }catch(e){next(e)} });
app.delete('/api/flights/:id', allow('admin','scheduler'), async(req,res,next)=>{try{await pool.query('DELETE FROM flights WHERE id=$1',[req.params.id]);res.status(204).end()}catch(e){next(e)}});
app.post('/api/schedule/run', allow('admin','scheduler'), async(req,res,next)=>{try{res.json(await autoSchedule(req.body.date))}catch(e){next(e)}});
app.post('/api/assignments', allow('admin','scheduler'), async(req,res,next)=>{try{const a=req.body;const r=await pool.query(`INSERT INTO assignments(id,flight_id,employee_id,role,locked) VALUES($1,$2,$3,$4,true) ON CONFLICT(flight_id,employee_id) DO UPDATE SET role=EXCLUDED.role,locked=true RETURNING *`,[id(),a.flightId,a.employeeId,a.role]);res.status(201).json(r.rows[0])}catch(e){next(e)}});
app.delete('/api/assignments/:id', allow('admin','scheduler'), async(req,res,next)=>{try{await pool.query('DELETE FROM assignments WHERE id=$1',[req.params.id]);res.status(204).end()}catch(e){next(e)}});

app.get('/api/employees', async(req,res,next)=>{try{res.json({employees:(await pool.query(`SELECT e.*,COALESCE(json_agg(q.*) FILTER(WHERE q.employee_id IS NOT NULL),'[]') qualifications FROM employees e LEFT JOIN employee_qualifications q ON q.employee_id=e.id WHERE e.deleted_at IS NULL GROUP BY e.id ORDER BY e.pending_deletion,e.name`)).rows})}catch(e){next(e)}});
app.post('/api/employees', allow('admin'), async(req,res,next)=>{try{const e=req.body;const r=await pool.query(`INSERT INTO employees(id,name,normalized_name,primary_role,eligible_roles) VALUES($1,$2,$3,$4,$5) RETURNING *`,[id(),e.name,e.name.trim().toLowerCase(),e.primaryRole||'agent',e.eligibleRoles||['agent']]);res.status(201).json(r.rows[0])}catch(e){next(e)}});
app.patch('/api/employees/:id', allow('admin'), async(req,res,next)=>{try{const e=req.body;const r=await pool.query(`UPDATE employees SET name=COALESCE($2,name),primary_role=COALESCE($3,primary_role),eligible_roles=COALESCE($4,eligible_roles),pending_deletion=COALESCE($5,pending_deletion),updated_at=now() WHERE id=$1 RETURNING *`,[req.params.id,e.name||null,e.primaryRole||null,e.eligibleRoles||null,e.pendingDeletion]);res.json(r.rows[0])}catch(e){next(e)}});
app.put('/api/employees/:id/qualifications/:airline', allow('admin'), async(req,res,next)=>{try{const q=req.body;const r=await pool.query(`INSERT INTO employee_qualifications(employee_id,airline,priority,can_lead,can_tow) VALUES($1,$2,$3,$4,$5) ON CONFLICT(employee_id,airline) DO UPDATE SET priority=EXCLUDED.priority,can_lead=EXCLUDED.can_lead,can_tow=EXCLUDED.can_tow RETURNING *`,[req.params.id,req.params.airline.toUpperCase(),Number(q.priority||50),!!q.canLead,!!q.canTow]);res.json(r.rows[0])}catch(e){next(e)}});
app.delete('/api/employees/:id', allow('admin'), async(req,res,next)=>{try{if(req.query.permanent==='true') await pool.query('DELETE FROM employees WHERE id=$1',[req.params.id]);else await pool.query('UPDATE employees SET deleted_at=now() WHERE id=$1',[req.params.id]);res.status(204).end()}catch(e){next(e)}});
app.post('/api/callouts', allow('admin','scheduler'), async(req,res,next)=>{try{const c=req.body;await pool.query(`INSERT INTO callouts(id,employee_id,work_date,reason) VALUES($1,$2,$3,$4) ON CONFLICT(employee_id,work_date) DO UPDATE SET reason=EXCLUDED.reason`,[id(),c.employeeId,c.date,c.reason||null]);res.status(201).json({ok:true})}catch(e){next(e)}});
app.delete('/api/callouts/:employeeId/:date', allow('admin','scheduler'), async(req,res,next)=>{try{await pool.query('DELETE FROM callouts WHERE employee_id=$1 AND work_date=$2',[req.params.employeeId,req.params.date]);res.status(204).end()}catch(e){next(e)}});

app.post('/api/employees/import', allow('admin'), upload.single('file'), async(req,res,next)=>{try{
  let rows=[]; const ext=path.extname(req.file.originalname).toLowerCase();
  if(ext==='.xlsx') rows=await readXlsxFile(req.file.path);
  else if(ext==='.csv') rows=parseCsv(await fs.readFile(req.file.path,'utf8'));
  else {const worker=await createWorker('eng');const out=await worker.recognize(req.file.path);await worker.terminate();rows=out.data.text.split(/\r?\n/).map(x=>[x]);}
  await fs.unlink(req.file.path).catch(()=>{}); const parsed=parseEmployeeRows(rows,req.body.weekStart); res.json({preview:parsed});
}catch(e){next(e)}});
app.post('/api/employees/import/commit', allow('admin'), async(req,res,next)=>{try{const incoming=req.body.employees||[];const importId=id();await tx(async c=>{
  await c.query('UPDATE employees SET pending_deletion=true WHERE deleted_at IS NULL');
  for(const e of incoming){const normalized=e.name.trim().toLowerCase();const er=await c.query(`INSERT INTO employees(id,name,normalized_name,primary_role,eligible_roles,pending_deletion) VALUES($1,$2,$3,$4,$5,false) ON CONFLICT(normalized_name) DO UPDATE SET name=EXCLUDED.name,primary_role=EXCLUDED.primary_role,eligible_roles=EXCLUDED.eligible_roles,pending_deletion=false,updated_at=now() RETURNING id`,[id(),e.name,normalized,e.role||'agent',[e.role||'agent']]);for(const s of e.shifts||[]) await c.query(`INSERT INTO shifts(id,employee_id,work_date,starts_at,ends_at,source,import_id) VALUES($1,$2,$3,$4,$5,'import',$6) ON CONFLICT(employee_id,work_date) DO UPDATE SET starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,source='import',import_id=EXCLUDED.import_id`,[id(),er.rows[0].id,s.date,s.start,s.end,importId]);}
  await c.query(`INSERT INTO imports(id,kind,status,summary) VALUES($1,'employees','complete',$2)`,[importId,JSON.stringify({employees:incoming.length})]);});res.status(201).json({imported:incoming.length})}catch(e){next(e)}});

app.get('/api/admin', allow('admin'), async(req,res,next)=>{try{const [accounts,airlines,issues,settings]=await Promise.all([pool.query('SELECT id,username,role,active,employee_id FROM accounts ORDER BY username'),pool.query('SELECT * FROM airlines ORDER BY code'),pool.query('SELECT * FROM issues ORDER BY created_at DESC'),pool.query('SELECT * FROM settings')]);res.json({accounts:accounts.rows.map(publicAccount),airlines:airlines.rows,issues:issues.rows,settings:Object.fromEntries(settings.rows.map(x=>[x.key,x.value]))})}catch(e){next(e)}});
app.post('/api/admin/accounts', allow('admin'), async(req,res,next)=>{try{res.status(201).json(await createAccount(req.body))}catch(e){next(e)}});
app.post('/api/admin/airlines', allow('admin'), async(req,res,next)=>{try{const a=req.body;const r=await pool.query(`INSERT INTO airlines(code,name,lead_required,agent_required,arrival_lead_minutes,post_departure_minutes) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,lead_required=EXCLUDED.lead_required,agent_required=EXCLUDED.agent_required,arrival_lead_minutes=EXCLUDED.arrival_lead_minutes,post_departure_minutes=EXCLUDED.post_departure_minutes RETURNING *`,[a.code.toUpperCase(),a.name,Number(a.leadRequired),Number(a.agentRequired),Number(a.arrivalLeadMinutes||15),Number(a.postDepartureMinutes||10)]);res.json(r.rows[0])}catch(e){next(e)}});
app.post('/api/issues', async(req,res,next)=>{try{const i=req.body;const r=await pool.query('INSERT INTO issues(id,title,detail,reported_by) VALUES($1,$2,$3,$4) RETURNING *',[id(),i.title,i.detail,req.account.id]);if(process.env.DISCORD_WEBHOOK_URL) fetch(process.env.DISCORD_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({content:`FlightDeck issue: **${i.title}**\n${i.detail}`})}).catch(()=>{});res.status(201).json(r.rows[0])}catch(e){next(e)}});
app.post('/api/admin/backup', allow('admin'), async(req,res,next)=>{try{const dir=path.join(root,'data','backups');await fs.mkdir(dir,{recursive:true});const tables=['settings','accounts','employees','employee_qualifications','shifts','callouts','airlines','flights','assignments','imports','issues'];const backup={format:'flightdeck-json-v1',createdAt:new Date().toISOString(),tables:{}};for(const table of tables)backup.tables[table]=(await pool.query(`SELECT * FROM ${table}`)).rows;const stamp=new Date().toISOString().replace(/[:.]/g,'-');await fs.writeFile(path.join(dir,`manual-${stamp}.json`),JSON.stringify(backup));res.status(201).json({message:'Manual backup created in data/backups.'})}catch(e){next(e)}});

app.use(express.static(path.join(root,'public'))); app.get('/{*splat}',(_,res)=>res.sendFile(path.join(root,'public','index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({error:process.env.NODE_ENV==='production'?'The request could not be completed':err.message})});

function parseEmployeeRows(rows,weekStart){
  const result=[]; const start=new Date(`${weekStart || new Date().toISOString().slice(0,10)}T00:00:00`);
  for(const row of rows){const name=String(row[0]||'').trim();if(!name||/^(ramp|monday|open line|alaska|mx|sy)/i.test(name))continue;const shifts=[];for(let d=0;d<7;d++){const a=String(row[1+d*2]||'').trim(),b=String(row[2+d*2]||'').trim();if(!/^\d{1,2}:\d{2}$/.test(a)||!/^\d{1,2}:\d{2}$/.test(b))continue;const date=new Date(start);date.setDate(start.getDate()+d);const day=date.toISOString().slice(0,10);let endDay=day;if(Number(b.split(':')[0])<Number(a.split(':')[0])){const e=new Date(date);e.setDate(e.getDate()+1);endDay=e.toISOString().slice(0,10)}shifts.push({date:day,start:`${day}T${a.padStart(5,'0')}:00`,end:`${endDay}T${b.padStart(5,'0')}:00`});}if(shifts.length)result.push({name,role:'agent',shifts});}return result;
}

function parseCsv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(ch===','&&!quoted){row.push(cell);cell=''}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))rows.push(row);row=[];cell=''}else cell+=ch}row.push(cell);if(row.some(x=>x!==''))rows.push(row);return rows}

await fs.mkdir(path.join(root,'data/uploads'),{recursive:true}); await migrate(); await ensureAdmin();
const pruneAssignments=()=>pool.query(`DELETE FROM assignments a USING flights f WHERE a.flight_id=f.id AND f.service_date < current_date-1`).catch(console.error);
await pruneAssignments(); setInterval(pruneAssignments,6*60*60*1000).unref();
const port=Number(process.env.PORT||3000); app.listen(port,'0.0.0.0',()=>console.log(`FlightDeck listening on ${port}`));
