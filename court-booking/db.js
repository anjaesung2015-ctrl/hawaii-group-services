const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'court.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// 캐시된 prepared statements (성능)
const stmtCache = new Map();
function prepare(sql) {
  if (!stmtCache.has(sql)) stmtCache.set(sql, db.prepare(sql));
  return stmtCache.get(sql);
}

// BEGIN IMMEDIATE 트랜잭션 (write lock 즉시 확보)
function txImmediate(fn) {
  return db.transaction(fn).immediate;
}

module.exports = { db, prepare, txImmediate };
