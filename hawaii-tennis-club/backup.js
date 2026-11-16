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
// 동영상은 크다 — 날마다 통째로 복사하면 30벌이 쌓인다. videos/ 에 한 번만 복사하고,
// 앱에서 지운 영상은 30일 지나면 백업에서도 지운다.
const VIDEO_EXT = /.(mp4|mov|webm|3gp|m4v)$/i;
const VIDEOS = 'videos';

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
    fs.cpSync(up, upOut, { recursive: true, filter: (src) => !VIDEO_EXT.test(src) });
    backupVideos(up);
  }

  // 채팅 사진 (data/chat-photos — 공개 폴더 밖에 따로 둔다)
  const chat = path.join(path.dirname(SRC), 'chat-photos');
  if (fs.existsSync(chat)) fs.cpSync(chat, path.join(OUT, `chat-photos-${stamp()}`), { recursive: true });

  // 오래된 것 정리
  const cutoff = Date.now() - KEEP_DAYS * 86400 * 1000;
  let pruned = 0;
  for (const f of fs.readdirSync(OUT)) {
    if (f === VIDEOS) continue;          // 동영상 폴더는 backupVideos 가 따로 정리한다
    const p = path.join(OUT, f);
    if (fs.statSync(p).mtimeMs < cutoff) {
      fs.rmSync(p, { recursive: true, force: true });
      pruned += 1;
    }
  }
  console.log(`[backup] ${new Date().toISOString()} -> ${dest} (${fs.statSync(dest).size} bytes), pruned ${pruned}`);
}

// 새 영상만 videos/ 로 복사. 원본이 사라진 지(=앱에서 지운 지) 30일 넘은 백업 영상은 지운다.
function backupVideos(up) {
  const dir = path.join(OUT, VIDEOS);
  fs.mkdirSync(dir, { recursive: true });
  const live = new Set(fs.readdirSync(up).filter(f => VIDEO_EXT.test(f)));
  let copied = 0, removed = 0;
  for (const f of live) {
    const to = path.join(dir, f);
    if (!fs.existsSync(to)) { fs.copyFileSync(path.join(up, f), to); copied += 1; }
  }
  const cutoff = Date.now() - KEEP_DAYS * 86400 * 1000;
  const gone = path.join(dir, '.gone.json');          // { 파일: 앱에서 사라진 걸 처음 본 시각 }
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(gone, 'utf8')); } catch (e) { seen = {}; }
  for (const f of fs.readdirSync(dir).filter(x => VIDEO_EXT.test(x))) {
    if (live.has(f)) { delete seen[f]; continue; }
    seen[f] = seen[f] || Date.now();
    if (seen[f] < cutoff) { fs.rmSync(path.join(dir, f), { force: true }); delete seen[f]; removed += 1; }
  }
  fs.writeFileSync(gone, JSON.stringify(seen));
  console.log(`[backup] videos: +${copied} new, -${removed} expired, ${live.size} live`);
}

main().catch((e) => {
  console.error(`[backup] 실패: ${e.message}`);
  process.exit(1);
});
