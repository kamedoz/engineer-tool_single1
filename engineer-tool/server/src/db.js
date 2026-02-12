// server/src/db.js
// Postgres DB layer (Neon/Supabase/Render Postgres friendly)

import pg from "pg";

const { Pool } = pg;

let pool;

function makePool() {
  const cs = process.env.DATABASE_URL;
  if (!cs) {
    throw new Error(
      "DATABASE_URL is not set. Set it to your Postgres connection string."
    );
  }

  // Many hosted Postgres providers require SSL.
  // `DB_SSL=true` is a simple toggle for local vs hosted.
  const sslEnabled =
    String(process.env.DB_SSL || "").toLowerCase() === "true" ||
    String(process.env.NODE_ENV || "").toLowerCase() === "production";

  return new Pool({
    connectionString: cs,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  });
}

async function migrate(p) {
  // Keep IDs as TEXT to preserve current UID format (u_*, t_*, etc.)
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      role TEXT NOT NULL DEFAULT 'engineer',
      created_at TEXT NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'open',
      site TEXT,
      visit_date TEXT,
      category_id TEXT,
      issue_id TEXT,
      issue_text TEXT,
      engineer_user_id TEXT,
      created_by_user_id TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS ticket_steps (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      step_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS ticket_notes (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      note_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Helpful indexes
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_issues_category_id ON issues(category_id);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_chat_pair ON chat_messages(from_user_id, to_user_id);`
  );
}

export async function initDb() {
  if (pool) return pool;
  pool = makePool();
  await migrate(pool);
  return pool;
}

export function getDb() {
  if (!pool) {
    // In case someone imports getDb() before initDb() is awaited.
    pool = makePool();
  }
  return pool;
}
