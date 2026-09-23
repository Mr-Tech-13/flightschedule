import { PGlite } from '@electric-sql/pglite';
import crypto from 'node:crypto';
import { Blob } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';

async function processStartIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    // Fields after the process name begin at field 3; starttime is field 22.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return fields[19] || null;
  } catch {
    return null;
  }
}

function parseInstanceLock(contents) {
  try {
    const lock = JSON.parse(contents);
    if (Number.isInteger(lock.pid) && lock.pid > 0 && typeof lock.processStart === 'string') return lock;
  } catch {
    // Locks from versions before 1.0.0 only contain a PID. A PID can be reused
    // after a container restart, so these legacy locks cannot prove ownership.
  }
  return null;
}

const dataDir = path.resolve(process.env.DATABASE_PATH || './data/flightschedule.pgdata');
const legacyDataDir = path.resolve('./data', ['flight', 'deck.pgdata'].join(''));
if (legacyDataDir !== dataDir && !(await fs.stat(dataDir).catch(() => null)) && await fs.stat(legacyDataDir).catch(() => null)) {
  await fs.rename(legacyDataDir, dataDir);
}
await fs.mkdir(path.dirname(dataDir), { recursive: true });
const instanceLockPath = `${dataDir}.lock`;
const currentProcessStart = await processStartIdentity(process.pid);
let instanceLock;
try {
  instanceLock = await fs.open(instanceLockPath, 'wx', 0o600);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const lock = parseInstanceLock(await fs.readFile(instanceLockPath, 'utf8').catch(() => ''));
  let running = false;
  if (lock) {
    try {
      process.kill(lock.pid, 0);
      const recordedProcessStart = await processStartIdentity(lock.pid);
      // Linux exposes a process start tick, which remains unique when Docker
      // reuses a PID. On other platforms, retain the conservative PID check.
      running = recordedProcessStart === null || recordedProcessStart === lock.processStart;
      if (lock.pid === process.pid && recordedProcessStart === currentProcessStart) running = false;
    } catch { /* Stale lock file. */ }
  }
  if (running) throw new Error(`FlightSchedule is already running with process ${lock.pid}. Stop it before starting another copy.`, { cause: error });
  await fs.unlink(instanceLockPath);
  instanceLock = await fs.open(instanceLockPath, 'wx', 0o600);
}
await instanceLock.writeFile(JSON.stringify({
  pid: process.pid,
  processStart: currentProcessStart || `started-${Date.now()}`
}));
let database = await PGlite.create(dataDir);

export const pool = {
  query: (sql, params = []) => database.query(sql, params),
  exec: sql => database.exec(sql)
};
export const id = () => crypto.randomUUID();

export async function migrate() {
  await pool.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id uuid PRIMARY KEY,
      username text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL CHECK (role IN ('admin','scheduler','viewer')),
      employee_id uuid,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS employees (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      normalized_name text UNIQUE NOT NULL,
      primary_role text NOT NULL DEFAULT 'agent',
      eligible_roles text[] NOT NULL DEFAULT ARRAY['agent'],
      pending_deletion boolean NOT NULL DEFAULT false,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS employee_qualifications (
      employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      airline text NOT NULL,
      priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
      can_lead boolean NOT NULL DEFAULT false,
      can_tow boolean NOT NULL DEFAULT false,
      PRIMARY KEY(employee_id, airline)
    );
    CREATE TABLE IF NOT EXISTS shifts (
      id uuid PRIMARY KEY,
      employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      work_date date NOT NULL,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      import_id uuid,
      UNIQUE(employee_id, work_date)
    );
    CREATE TABLE IF NOT EXISTS callouts (
      id uuid PRIMARY KEY,
      employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      work_date date NOT NULL,
      reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(employee_id, work_date)
    );
    CREATE TABLE IF NOT EXISTS airlines (
      code text PRIMARY KEY,
      name text NOT NULL,
      lead_required integer NOT NULL DEFAULT 1,
      agent_required integer NOT NULL DEFAULT 2,
      arrival_lead_minutes integer NOT NULL DEFAULT 15,
      post_departure_minutes integer NOT NULL DEFAULT 10
    );
    CREATE TABLE IF NOT EXISTS flights (
      id uuid PRIMARY KEY,
      service_date date NOT NULL,
      airline text NOT NULL,
      arrival_number text,
      departure_number text,
      origin text,
      destination text,
      arrival_at timestamptz,
      departure_at timestamptz,
      gate text,
      aircraft text,
      notes text,
      ferry boolean NOT NULL DEFAULT false,
      priority boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS assignments (
      id uuid PRIMARY KEY,
      flight_id uuid NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
      employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      role text NOT NULL,
      locked boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(flight_id, employee_id)
    );
    CREATE TABLE IF NOT EXISTS imports (
      id uuid PRIMARY KEY,
      kind text NOT NULL,
      filename text,
      status text NOT NULL,
      summary jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS issues (
      id uuid PRIMARY KEY,
      title text NOT NULL,
      detail text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      reported_by uuid REFERENCES accounts(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_flights_date ON flights(service_date);
    CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(work_date);
    CREATE INDEX IF NOT EXISTS idx_assignments_flight ON assignments(flight_id);
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS tow_qualified boolean NOT NULL DEFAULT false;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS customs_seal boolean NOT NULL DEFAULT false;
    ALTER TABLE airlines ADD COLUMN IF NOT EXISTS international boolean NOT NULL DEFAULT false;
    ALTER TABLE flights ADD COLUMN IF NOT EXISTS international boolean NOT NULL DEFAULT false;
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS closed_at timestamptz;
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES accounts(id);
  `);
  await pool.query("SELECT set_config('TimeZone',$1,false)", [process.env.DEFAULT_TIMEZONE || 'America/New_York']);
  await pool.query("INSERT INTO settings(key,value) VALUES ('station', $1), ('timezone', $2) ON CONFLICT DO NOTHING", [JSON.stringify(process.env.DEFAULT_STATION || 'Station'), JSON.stringify(process.env.DEFAULT_TIMEZONE || 'America/New_York')]);
}

export async function tx(fn) {
  return database.transaction(transaction => fn({ query: (sql, params = []) => transaction.query(sql, params) }));
}

export async function createDatabaseBackup(prefix = 'nightly') {
  const backupDir = path.resolve('./data/backups');
  await fs.mkdir(backupDir, { recursive: true });
  const blob = await database.dumpDataDir('gzip');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${prefix}-${stamp}.tar.gz`;
  await fs.writeFile(path.join(backupDir, filename), Buffer.from(await blob.arrayBuffer()));
  const files = await fs.readdir(backupDir, { withFileTypes: true });
  const cutoff = Date.now() - 7 * 86400000;
  await Promise.all(files.filter(file => file.isFile() && /^(nightly|manual|pre-restore)-.*\.tar\.gz$/.test(file.name)).map(async file => {
    const target = path.join(backupDir, file.name);
    if ((await fs.stat(target)).mtimeMs < cutoff) await fs.unlink(target);
  }));
  return filename;
}

const validBackupName = /^(nightly|manual|pre-restore)-[A-Za-z0-9T-]+Z\.tar\.gz$/;
const backupDirectory = () => path.resolve('./data/backups');

export async function listDatabaseBackups() {
  const backupDir = backupDirectory();
  await fs.mkdir(backupDir, { recursive: true });
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const backups = await Promise.all(entries.filter(entry => entry.isFile() && validBackupName.test(entry.name)).map(async entry => {
    const stat = await fs.stat(path.join(backupDir, entry.name));
    return { filename: entry.name, size: stat.size, createdAt: stat.mtime.toISOString() };
  }));
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function databaseBackupPath(filename) {
  if (!validBackupName.test(String(filename || ''))) throw new Error('Invalid backup filename');
  const target = path.join(backupDirectory(), filename);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile()) throw new Error('Backup not found');
  return target;
}

export async function restoreDatabaseBackup(filename) {
  const source = await databaseBackupPath(filename);
  await createDatabaseBackup('pre-restore');
  const archive = new Blob([await fs.readFile(source)]);
  const previousDir = `${dataDir}.before-restore-${Date.now()}`;
  await database.close();
  await fs.rename(dataDir, previousDir);
  try {
    database = await PGlite.create({ dataDir, loadDataDir: archive });
    await migrate();
    await fs.rm(previousDir, { recursive: true, force: true });
  } catch (error) {
    await database?.close().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rename(previousDir, dataDir);
    database = await PGlite.create(dataDir);
    throw error;
  }
}

export async function closeDatabase() {
  await database.close();
  await instanceLock.close().catch(() => {});
  await fs.unlink(instanceLockPath).catch(() => {});
}
