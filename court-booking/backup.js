#!/usr/bin/env node
// court.db 일일 백업 — better-sqlite3 online backup(WAL 핫백업 정석)으로 단일파일 스냅샷 생성 + 30일 초과분 정리
const path = require('path');
const fs = require('fs');
const APP = '/home/ubuntu/.openclaw/workspace/court-booking';
const Database = require(path.join(APP, 'node_modules', 'better-sqlite3'));

const SRC = process.env.DB_PATH || path.join(APP, 'court.db');
const DIR = '/home/ubuntu/backups/court-booking';
const RETAIN_DAYS = 30;

fs.mkdirSync(DIR, { recursive: true });

const d = new Date();
const p = n => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const dest = path.join(DIR, `court-${stamp}.db`);

(async () => {
  const db = new Database(SRC, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);          // WAL 체크포인트 포함 정합 스냅샷
  } finally {
    db.close();
  }

  // 30일 초과 백업 정리
  const cutoff = Date.now() - RETAIN_DAYS * 86400000;
  let pruned = 0;
  for (const f of fs.readdirSync(DIR)) {
    if (!/^court-\d{8}-\d{6}\.db$/.test(f)) continue;
    const fp = path.join(DIR, f);
    if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); pruned++; }
  }

  const size = fs.statSync(dest).size;
  console.log(`[backup] ${new Date().toISOString()} -> ${dest} (${size} bytes), pruned ${pruned}`);
})().catch(e => { console.error('[backup] FAILED', e.message); process.exit(1); });
