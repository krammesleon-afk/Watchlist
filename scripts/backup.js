#!/usr/bin/env node
// Erstellt eine konsistente Kopie von watchlist.db (auch während der Server läuft)
// und behält nur die letzten BACKUP_KEEP Sicherungen.
//
//   node scripts/backup.js            → Ziel: ~/backups/watchlist
//   BACKUP_DIR=/pfad node scripts/backup.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const DB_FILE = path.join(__dirname, '..', 'watchlist.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(os.homedir(), 'backups', 'watchlist');
const KEEP = parseInt(process.env.BACKUP_KEEP || '8', 10);

const stamp = new Date().toISOString().slice(0, 10);
const target = path.join(BACKUP_DIR, `watchlist-${stamp}.db`);

fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
if (fs.existsSync(target)) fs.unlinkSync(target); // gleicher Tag → neu erstellen

const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READONLY, (err) => {
  if (err) fail('Datenbank lässt sich nicht öffnen', err);
});

// VACUUM INTO schreibt einen sauberen Schnappschuss, ohne die laufende App zu blockieren
db.run('VACUUM INTO ?', [target], (err) => {
  if (err) fail('Backup fehlgeschlagen', err);
  db.close();
  fs.chmodSync(target, 0o600);

  // Alte Backups löschen
  const old = fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^watchlist-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(KEEP);
  old.forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));

  const size = (fs.statSync(target).size / 1024).toFixed(0);
  console.log(`✅ Backup erstellt: ${target} (${size} KB)${old.length ? `, ${old.length} alte gelöscht` : ''}`);
});

function fail(msg, err) {
  console.error(`❌ ${msg}:`, err.message);
  process.exit(1);
}
