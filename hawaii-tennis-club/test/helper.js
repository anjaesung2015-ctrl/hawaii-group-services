// 테스트용 앱 — 임시 DB 파일에 새로 만들고, 포트는 운영체제가 고르게 한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

function makeApp(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htc-test-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.SESSION_SECRET = 'test-secret';
  // 사진도 이 임시 폴더 안에 — 끝나면 폴더째 지워진다 (운영 uploads/ 를 건드리지 않는다)
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');

  // DB_PATH 를 정한 뒤에 불러와야 임시 파일을 쓴다
  delete require.cache[require.resolve('../lib/db')];
  const dbmod = require('../lib/db');
  const { createAuth } = require('../lib/auth');
  const { createNotifier } = require('../lib/notify');
  const { createTranslator } = require('../lib/translate');

  const db = dbmod.open();
  const auth = createAuth(db);

  // 알림은 밖으로 내보내지 않고 받아 적는다. opts.fail 을 주면 그 상태코드로 실패시킨다.
  const sent = [];
  const notify = createNotifier(db, {
    publicKey: 'test-public-key',
    send: async (s, payload) => {
      if (opts.fail) { const e = new Error('push failed'); e.statusCode = opts.fail; throw e; }
      sent.push({ endpoint: s.endpoint, member_id: s.member_id, payload: JSON.parse(JSON.stringify(payload)) });
    },
  });

  // 번역은 밖으로 나가지 않게 가짜 번역기를 쓴다 ('[en] 원문')
  const tr = createTranslator(db, { budgetMs: 2000, translate: async (text) => '[en] ' + text });

  const app = express();
  app.use(express.json({ limit: '6mb' }));
  app.use(cookieParser());
  app.use(auth.attach);
  app.use('/api/auth', require('../routes/auth')(db, auth));
  app.use('/api/join', require('../routes/join')(db, auth, notify));
  app.use('/api/settings', require('../routes/settings')(db, auth));
  app.use('/api/members', require('../routes/members')(db, auth));
  app.use('/api/events', require('../routes/events')(db, auth, notify, tr));
  app.use('/api/dues', require('../routes/dues')(db, auth));
  app.use('/api/notices', require('../routes/notices')(db, auth, notify, tr));
  app.use('/api/posts', require('../routes/posts')(db, auth, notify, tr));
  app.use('/api/push', require('../routes/push')(db, auth, notify));
  app.use('/api/docs', require('../routes/docs')(db, auth));
  app.use('/api/officers', require('../routes/officers')(db, auth));
  app.use('/api/chat', require('../routes/chat')(db, auth, notify, tr));
  app.use('/api/invite', require('../routes/invite')());
  app.use('/api/elite', require('../routes/elite-players')(db, auth));

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const admin = db.prepare(`INSERT INTO member (name, phone, pin_hash, role, title, level, status, joined_at)
                            VALUES ('대표','99000000',?,'admin','대표','advanced','active','2026-01-02')`)
    .run(dbmod.hashPin('1234'));
  const member = db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at)
                             VALUES ('Батбаяр','88110044',?,'member','intermediate','active','2026-03-10')`)
    .run(dbmod.hashPin('1111'));

  // 운영(server.js)과 같게 — 첫 관리자를 오너로 삼는다
  dbmod.ensureOwner(db);

  let closed = false;
  const made = {
    db, dbmod, base, server, dir, notify, sent, tr,
    uploadDir: process.env.UPLOAD_DIR,
    // 응답을 보낸 뒤 나가는 알림을 기다린다 (라우트가 res.json 뒤에 보내므로)
    settle: () => new Promise(r => setTimeout(r, 30)),
    adminId: admin.lastInsertRowid,
    memberId: member.lastInsertRowid,
    close() {
      if (closed) return;
      closed = true;
      // fetch 가 연결을 살려두므로(keep-alive) 끊어주지 않으면 프로세스가 끝나지 않는다
      server.closeAllConnections?.();
      server.close();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  OPEN.add(made);
  return made;
}

// 테스트가 중간에 깨져도 서버·DB는 반드시 닫는다 (안 닫으면 테스트가 끝나지 않고 멈춘다)
const OPEN = new Set();
require('node:test').after(() => {
  for (const app of OPEN) { try { app.close(); } catch (e) {} }
  OPEN.clear();
});

// 쿠키를 들고 다니는 아주 작은 클라이언트
function client(base) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async call(path, { method = 'GET', body } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.() || [];
      for (const c of set) cookie = c.split(';')[0];
      let data = null;
      try { data = await res.json(); } catch (e) {}
      return { status: res.status, data };
    },
  };
}

async function loginAs(base, phone, pin) {
  const c = client(base);
  const r = await c.call('/auth/login', { method: 'POST', body: { phone, pin } });
  if (r.status !== 200) throw new Error('login failed: ' + JSON.stringify(r.data));
  return c;
}

module.exports = { makeApp, client, loginAs };
