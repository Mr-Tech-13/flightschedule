import { PGlite } from '@electric-sql/pglite';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATABASE_PATH || './data/flightdeck.pgdata');
await fs.mkdir(path.dirname(dataDir), { recursive: true });
const database = await PGlite.create(dataDir);

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
  const cutoff = Date.now() - 30 * 86400000;
  await Promise.all(files.filter(file => file.isFile() && /^(nightly|manual)-.*\.tar\.gz$/.test(file.name)).map(async file => {
    const target = path.join(backupDir, file.name);
    if ((await fs.stat(target)).mtimeMs < cutoff) await fs.unlink(target);
  }));
  return filename;
}
