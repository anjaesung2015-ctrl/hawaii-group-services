// 하루 한 번 club.db 를 통째로 복사해 둔다 (SQLite 온라인 백업 — 서버를 끄지 않아도 안전).
// 실행: node backup.js        보관: 30일
// cron: 30 3 * * * cd ~/.openclaw/workspace/hawaii-tennis-club && /usr/bin/node backup.js >> backup.log 2>&1
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = __dirname;
const SRC = process.env.DB_PATH || path.join(ROOT, 'data', 'club.db');
const OUT = process.env.BACKUP_DIR || path.join(process.env.HOME || ROOT, 'backups', 'hawaii-tennis-club');
const KEEP_DAYS = 30;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.log(`[backup] ${new Date().toISOString()} 원본이 없습니다: ${SRC}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const dest = path.join(OUT, `club-${stamp()}.db`);

  const db = new Database(SRC, { readonly: true });
  await db.backup(dest);
  db.close();

  // 공지 사진도 함께 (있을 때만, 용량이 작아 그대로 복사)
  const up = path.join(ROOT, 'uploads');
  if (fs.existsSync(up)) {
    const upOut = path.join(OUT, `uploads-${stamp()}`);
    fs.cpSync(up, upOut, { recursive: true });
  }

  // 채팅 사진 (data/chat-photos — 공개 폴더 밖에 따로 둔다)
  const chat = path.join(path.dirname(SRC), 'chat-photos');
  if (fs.existsSync(chat)) fs.cpSync(chat, path.join(OUT, `chat-photos-${stamp()}`), { recursive: true });

  // 오래된 것 정리
  const cutoff = Date.now() - KEEP_DAYS * 86400 * 1000;
  let pruned = 0;
  for (const f of fs.readdirSync(OUT)) {
    const p = path.join(OUT, f);
    if (fs.statSync(p).mtimeMs < cutoff) {
      fs.rmSync(p, { recursive: true, force: true });
      pruned += 1;
    }
  }
  console.log(`[backup] ${new Date().toISOString()} -> ${dest} (${fs.statSync(dest).size} bytes), pruned ${pruned}`);
}

main().catch((e) => {
  console.error(`[backup] 실패: ${e.message}`);
  process.exit(1);
});
