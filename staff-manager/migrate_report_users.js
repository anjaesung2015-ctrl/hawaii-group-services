const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = new Database(path.join(__dirname, 'staff.db'));
db.pragma('journal_mode = WAL');

// 업무보고 전용 로그인 명단 (공유 staff 테이블과 분리 — POS/비서 안전)
db.exec(`CREATE TABLE IF NOT EXISTS report_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  pin_hash TEXT NOT NULL,
  is_active INTEGER DEFAULT 1
)`);

const names = ['미가', '구엔', '잠스랑', '투구', '적승'];
function genpw() {
  const cs = 'abcdefghijkmnpqrstuvwxyz23456789'; // 헷갈리는 0/o/1/l 제외
  let s = '';
  for (let i = 0; i < 6; i++) s += cs[Math.floor(Math.random() * cs.length)];
  return s;
}

const upsert = db.prepare(`INSERT INTO report_users (name, pin_hash, is_active) VALUES (?,?,1)
  ON CONFLICT(name) DO UPDATE SET pin_hash=excluded.pin_hash, is_active=1`);

const out = [];
for (const n of names) {
  const pw = genpw();
  upsert.run(n, bcrypt.hashSync(pw, 10));
  out.push(n + '\t' + pw);
}
// 명단에 없는 사람은 비활성화
db.prepare(`UPDATE report_users SET is_active=0 WHERE name NOT IN (${names.map(() => '?').join(',')})`).run(...names);

console.log('=== report_users 비밀번호 (한 번만 표시, 저장은 해시로만) ===');
out.forEach(l => console.log('  ' + l));
console.log('활성 명단:', db.prepare("SELECT name FROM report_users WHERE is_active=1 ORDER BY id").all().map(r => r.name).join(', '));
