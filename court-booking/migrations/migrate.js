#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'court.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function appliedVersions() {
  try {
    return new Set(db.prepare('SELECT version FROM schema_version').all().map(r => r.version));
  } catch (e) {
    return new Set();
  }
}

function apply(file) {
  const sql = fs.readFileSync(path.join(__dirname, file), 'utf-8');
  console.log(`Applying ${file}...`);
  db.exec(sql);
  console.log(`  ✓ ${file}`);
}

const migrations = fs.readdirSync(__dirname)
  .filter(f => /^\d{3}_.+\.sql$/.test(f))
  .sort();

const applied = appliedVersions();
for (const file of migrations) {
  const version = parseInt(file.slice(0, 3), 10);
  if (applied.has(version)) {
    console.log(`Skipping ${file} (already applied)`);
    continue;
  }
  apply(file);
}

console.log('Done.');
db.close();
