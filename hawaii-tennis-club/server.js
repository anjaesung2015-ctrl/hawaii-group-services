// Hawaii Tennis Club — 회원 전용 웹앱
// 실행: npm start  →  http://localhost:3000
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { open, ensureFirstAdmin, ensureOwner, getSettings } = require('./lib/db');
const { createAuth } = require('./lib/auth');
const { createNotifier } = require('./lib/notify');
const { createJobs } = require('./lib/jobs');

const PORT = Number(process.env.PORT || 3000);

const db = open();
const auth = createAuth(db);
const notify = createNotifier(db);
const jobs = createJobs(db, notify);
const firstAdmin = ensureFirstAdmin(db);
const newOwner = ensureOwner(db);   // 오너가 없으면 첫 관리자를 오너로

const app = express();
app.set('trust proxy', 1);
// 공지 사진이 base64로 들어오므로 본문 한도를 조금 넉넉하게 둔다
app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());
app.use(auth.attach);

app.use('/api/auth', require('./routes/auth')(db, auth));
app.use('/api/join', require('./routes/join')(db, auth, notify));     // 가입 신청 (신청은 누구나, 승인은 관리자)
app.use('/api/settings', require('./routes/settings')(db, auth));
app.use('/api/members', require('./routes/members')(db, auth));
app.use('/api/events', require('./routes/events')(db, auth, notify));
app.use('/api/dues', require('./routes/dues')(db, auth));
app.use('/api/notices', require('./routes/notices')(db, auth, notify));
app.use('/api/posts', require('./routes/posts')(db, auth, notify));   // 자유게시판
app.use('/api/push', require('./routes/push')(db, auth, notify));    // 폰 알림
app.use('/api/docs', require('./routes/docs')(db, auth));            // 회칙 (읽기는 누구나)
app.use('/api/officers', require('./routes/officers')(db, auth));    // 조직도

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// 공지 사진은 로그인한 회원에게만 보여준다 (주소를 알아도 남이 못 열게)
app.use('/uploads', auth.requireMember, express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  res.status(500).json({ error: 'server_error' });
});

jobs.start();   // 일정 하루 전·회비 미납 알림 (10분마다 확인)

const server = app.listen(PORT, () => {
  const s = getSettings(db);
  console.log('');
  console.log(`  🎾 ${s.club_name}`);
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`     월회비 ${s.monthly_fee.toLocaleString()}${s.currency} · 입회비 ${s.joining_fee.toLocaleString()}${s.currency}`);
  if (newOwner) console.log(`  👑 오너: ${newOwner.name} (권한 부여·회칙 수정은 이 계정만 가능)`);
  if (firstAdmin) {
    console.log('');
    console.log('  ───────── 첫 관리자 계정을 만들었습니다 ─────────');
    console.log(`   이름     : ${firstAdmin.name}`);
    console.log(`   전화번호 : ${firstAdmin.phone}`);
    console.log(`   PIN      : ${firstAdmin.pin}`);
    console.log('   ⚠  로그인한 뒤 바로 PIN을 바꿔주세요 (홈 화면 → PIN 변경)');
    console.log('  ──────────────────────────────────────────────');
  }
  console.log('');
});

const bye = () => { jobs.stop(); server.close(); db.close(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);

module.exports = { app, db };
