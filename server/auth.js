import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { id, pool } from './db.js';

const COOKIE = 'flightdeck_session';
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

export async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error('ADMIN_PASSWORD must be set');
  const exists = await pool.query('SELECT 1 FROM accounts LIMIT 1');
  if (!exists.rowCount) await pool.query('INSERT INTO accounts(id,username,password_hash,role) VALUES($1,$2,$3,$4)', [id(), username.toLowerCase(), await bcrypt.hash(password, 12), 'admin']);
}

export async function login(req, res) {
  const username = String(req.body.username || '').trim().toLowerCase();
  const result = await pool.query('SELECT * FROM accounts WHERE username=$1 AND active=true', [username]);
  const account = result.rows[0];
  if (!account || !(await bcrypt.compare(String(req.body.password || ''), account.password_hash))) return res.status(401).json({ error: 'Invalid username or password' });
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query("INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", [hashToken(token), account.id]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 43200000 });
  res.json({ account: { id: account.id, username: account.username, role: account.role } });
}

export async function logout(req, res) {
  if (req.cookies[COOKIE]) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(req.cookies[COOKIE])]);
  res.clearCookie(COOKIE); res.status(204).end();
}

export async function authenticate(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const result = await pool.query(`SELECT a.id,a.username,a.role FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.active=true`, [hashToken(token)]);
  if (!result.rowCount) return res.status(401).json({ error: 'Session expired' });
  req.account = result.rows[0]; next();
}

export const allow = (...roles) => (req, res, next) => roles.includes(req.account.role) ? next() : res.status(403).json({ error: 'Insufficient permission' });
export const publicAccount = a => ({ id: a.id, username: a.username, role: a.role, active: a.active, employeeId: a.employee_id });
export async function createAccount(data) {
  if (!/^[a-z0-9._-]{3,40}$/i.test(data.username || '')) throw new Error('Username must be 3–40 valid characters');
  if (String(data.password || '').length < 12) throw new Error('Password must be at least 12 characters');
  const account = { id: id(), username: data.username.toLowerCase(), password_hash: await bcrypt.hash(data.password, 12), role: data.role || 'viewer', employee_id: data.employeeId || null };
  const result = await pool.query('INSERT INTO accounts(id,username,password_hash,role,employee_id) VALUES($1,$2,$3,$4,$5) RETURNING *', Object.values(account));
  return publicAccount(result.rows[0]);
}
