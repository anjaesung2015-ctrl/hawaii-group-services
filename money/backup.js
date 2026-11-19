// 매일 DB 백업 → ~/backups/money/ledger-YYYYMMDD.db, 30일 보관
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const dir = path.join(require('os').homedir(), 'backups', 'money');
fs.mkdirSync(dir, { recursive: true });
const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const db = new Database(path.join(__dirname, 'data', 'ledger.db'), { readonly: true });
db.backup(path.join(dir, `ledger-${stamp}.db`)).then(() => {
  db.close();
  const cut = Date.now() - 30 * 864e5;
  for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).mtimeMs < cut) fs.unlinkSync(p); }
  console.log(new Date().toISOString(), 'backup ok', stamp);
}).catch(e => { console.error('backup failed', e); process.exit(1); });
