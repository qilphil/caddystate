import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import config from './config.js';

function randomPassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function initDb() {
  const dbPath = path.resolve(config.DB_PATH);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      role        TEXT    NOT NULL DEFAULT 'user',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      last_login  TEXT
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT    NOT NULL DEFAULT (datetime('now')),
      user_id     INTEGER,
      username    TEXT,
      action      TEXT    NOT NULL,
      target      TEXT,
      status      TEXT    NOT NULL,
      detail      TEXT,
      ip          TEXT
    );
  `);

  const adminExists = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();

  if (!adminExists) {
    const plainPass = randomPassword(16);
    const hash = bcrypt.hashSync(plainPass, 12);
    db.prepare("INSERT INTO users (username, password, role) VALUES ('admin', ?, 'admin')").run(hash);

    const credPath = path.resolve(config.CREDENTIALS_FILE);
    fs.writeFileSync(credPath, `ADMIN_USER=admin\nADMIN_PASS=${plainPass}\n`, { mode: 0o600 });

    console.log('[INIT] Admin user created. Credentials written to admin-credentials.env — delete this file after first login.');
  }

  return db;
}
