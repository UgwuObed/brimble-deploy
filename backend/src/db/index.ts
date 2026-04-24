import Database, { Database as DatabaseType } from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../data/brimble.db");

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db: DatabaseType = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployments (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      source_type   TEXT NOT NULL CHECK(source_type IN ('git', 'zip')),
      source_url    TEXT,
      status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','building','deploying','running','failed')),
      image_tag     TEXT,
      container_id  TEXT,
      container_port INTEGER,
      caddy_route   TEXT,
      error_message TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deployment_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      stream        TEXT NOT NULL DEFAULT 'stdout' CHECK(stream IN ('stdout','stderr','system')),
      message       TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_logs_deployment 
      ON deployment_logs(deployment_id, created_at);
  `);

  console.log("[db] migrations applied");
}