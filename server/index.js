import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedDemo, seedUsers } from './seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dbFile = path.join(dataDir, 'dc-capacity.db');
const args = new Set(process.argv.slice(2));
fs.mkdirSync(dataDir, { recursive: true });
if (args.has('--reset-demo')) for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) fs.rmSync(f, { force: true });

const db = openDb(dbFile);
export function resetDemo() {
  db.exec('PRAGMA foreign_keys = OFF');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM sqlite_sequence");
  db.exec('PRAGMA foreign_keys = ON');
  seedDemo(db);
}
if (!db.prepare('SELECT COUNT(*) c FROM projects').get().c) {
  if (process.env.NO_DEMO) seedUsers(db); else { seedDemo(db); console.log('Seeded demo data.'); }
}

if (!args.has('--no-listen')) {
  const handler = createApp(db, { publicDir: path.join(root, 'public'), uploadDir: path.join(dataDir, 'uploads'), reseed: resetDemo });
  const port = Number(process.env.PORT) || 3000;
  http.createServer(handler).listen(port, () => console.log(`DC Capacity Platform listening on http://localhost:${port}`));
}
