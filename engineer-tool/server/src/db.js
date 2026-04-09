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
      role_label TEXT,
      avatar_url TEXT,
      can_edit_wiki BOOLEAN NOT NULL DEFAULT FALSE,
      can_delete_wiki BOOLEAN NOT NULL DEFAULT FALSE,
      experience INTEGER NOT NULL DEFAULT 0,
      spent_experience INTEGER NOT NULL DEFAULT 0,
      nickname_color TEXT,
      badge_icon TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_label TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_wiki BOOLEAN NOT NULL DEFAULT FALSE;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_delete_wiki BOOLEAN NOT NULL DEFAULT FALSE;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS experience INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS spent_experience INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_color TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_icon TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_account_id TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_account_email TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_refresh_token TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_access_token TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_token_expires_at TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_portal_name TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_connected_at TEXT;`);

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
      steps TEXT,
      solution TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Backward-compatible migrations for older databases that already
  // have the `issues` table without these columns.
  await p.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS steps TEXT;`);
  await p.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS solution TEXT;`);

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
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_project_id TEXT;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_project_name TEXT;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_task_id TEXT;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_task_key TEXT;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_task_name TEXT;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_sync_status TEXT;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_last_sync_at TEXT;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_last_sync_error TEXT;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS timer_started_at TEXT;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS timer_elapsed_seconds INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS synced_by_user_id TEXT;`);

  await p.query(`
    CREATE TABLE IF NOT EXISTS ticket_steps (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      step_index INTEGER,
      step_text TEXT NOT NULL,
      result TEXT,
      checked_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Backward-compatible migrations for older databases
  await p.query(`ALTER TABLE ticket_steps ADD COLUMN IF NOT EXISTS step_index INTEGER;`);
  await p.query(`ALTER TABLE ticket_steps ADD COLUMN IF NOT EXISTS result TEXT;`);
  await p.query(`ALTER TABLE ticket_steps ADD COLUMN IF NOT EXISTS checked_at TEXT;`);

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
      to_user_id TEXT,
      channel TEXT NOT NULL DEFAULT 'direct',
      text TEXT NOT NULL,
      quoted_article_id TEXT,
      quoted_article_title TEXT,
      quoted_article_category TEXT,
      quoted_article_excerpt TEXT,
      updated_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await p.query(`ALTER TABLE chat_messages ALTER COLUMN to_user_id DROP NOT NULL;`);
  await p.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'direct';`);
  await p.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS quoted_article_id TEXT;`);
  await p.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS quoted_article_title TEXT;`);
  await p.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS quoted_article_category TEXT;`);
  await p.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS quoted_article_excerpt TEXT;`);
  await p.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS updated_at TEXT;`);
  await p.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TEXT;`);

  // Helpful indexes
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_issues_category_id ON issues(category_id);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_tickets_zoho_project_id ON tickets(zoho_project_id);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_chat_pair ON chat_messages(from_user_id, to_user_id);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_chat_channel_created_at ON chat_messages(channel, created_at);`
  );

  // === Wiki articles ===
  await p.query(`
    CREATE TABLE IF NOT EXISTS wiki_articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      body TEXT,
      images TEXT DEFAULT '[]',
      created_by_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_wiki_category ON wiki_articles(category);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_wiki_updated_at ON wiki_articles(updated_at);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS wiki_comments (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_wiki_comments_article_id ON wiki_comments(article_id, created_at);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      entity_type TEXT,
      entity_id TEXT,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications(user_id, created_at DESC);`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      summary TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_users_experience ON users(experience DESC, created_at ASC);`);
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
