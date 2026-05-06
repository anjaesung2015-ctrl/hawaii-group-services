// issue_pins.js — 활성 직원에 4자리 PIN 발급 (재실행 시 미발급자만)
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database(require('path').join(__dirname, 'staff.db'));

function generatePin() {
  // 4자리, 0000은 제외
  let n;
  do { n = Math.floor(Math.random() * 10000); } while (n === 0);
  return String(n).padStart(4, '0');
}

const onlyMissing = process.argv.includes('--only-missing');
const force = process.argv.includes('--force');

const staff = db.prepare("SELECT id, name, name_mn, pin_hash FROM staff WHERE is_active=1 ORDER BY id").all();
const issued = [];

for (const s of staff) {
  if (s.pin_hash && onlyMissing) continue;
  if (s.pin_hash && !force && !onlyMissing) {
    console.log(`  · skip ${s.name} (이미 PIN 있음, --force로 재발급)`);
    continue;
  }
  const pin = generatePin();
  const hash = bcrypt.hashSync(pin, 10);
  db.prepare("UPDATE staff SET pin_hash=?, pin_locked_until=NULL, pin_fail_count=0 WHERE id=?").run(hash, s.id);
  issued.push({ id: s.id, name: s.name, name_mn: s.name_mn, pin });
}

console.log(`\n[발급 완료] ${issued.length}명\n`);
console.log('직원ID | 이름 | 몽골이름 | PIN');
console.log('------|------|---------|----');
issued.forEach(r => console.log(`  ${String(r.id).padStart(3)} | ${(r.name||'').padEnd(8)} | ${(r.name_mn||'').padEnd(15)} | ${r.pin}`));
console.log('\n⚠️  이 출력은 한 번만 표시됩니다. 안전하게 직원에게 전달하고 본 콘솔을 닫으세요.');

db.close();
