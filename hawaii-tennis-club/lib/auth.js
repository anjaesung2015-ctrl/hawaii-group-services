// 전화번호 + 4자리 PIN 로그인. 세션은 서명된 쿠키(JWT) 하나.
// PIN이 4자리뿐이라 무작정 찍어보는 걸 막는 잠금이 필요하다 — 번호별로 5번 틀리면 1분 쉬게 한다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const COOKIE = 'htc_sess';
const MAX_AGE_DAYS = 30;
// 하위 경로(/club)에 올릴 때는 그 경로에만 쿠키를 둔다 — 같은 도메인의 다른 서비스로 새어나가지 않게
const COOKIE_PATH = process.env.COOKIE_PATH || '/';
const FAIL_LIMIT = 5;
const LOCK_MS = 60 * 1000;

// 서버를 다시 켜도 로그인이 유지되도록 비밀키를 data/.secret 에 한 번만 만들어 둔다.
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dir = path.join(__dirname, '..', 'data');
  const file = path.join(dir, '.secret');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

function createAuth(db) {
  const secret = loadSecret();

  // 실패 횟수는 이 서버 안에서만 센다 (전역으로 두면 테스트끼리 서로 간섭한다)
  const fails = new Map();   // phone → { n, until }

  function lockedFor(phone) {
    const f = fails.get(phone);
    if (!f || !f.until) return 0;
    const left = f.until - Date.now();
    if (left <= 0) { fails.delete(phone); return 0; }
    return Math.ceil(left / 1000);
  }

  function noteFail(phone) {
    const f = fails.get(phone) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= FAIL_LIMIT) { f.until = Date.now() + LOCK_MS; f.n = 0; }
    fails.set(phone, f);
  }

  const clearFails = (phone) => fails.delete(phone);

  const sign = (m) => jwt.sign({ id: m.id, role: m.role, name: m.name }, secret, { expiresIn: `${MAX_AGE_DAYS}d` });

  const setCookie = (res, token) => res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.SECURE_COOKIE === '1',   // https 로 서비스할 때만 켠다
    maxAge: MAX_AGE_DAYS * 86400 * 1000,
    path: COOKIE_PATH,
  });

  const clearCookie = (res) => res.clearCookie(COOKIE, { path: COOKIE_PATH });

  // 쿠키가 있으면 req.me 를 채운다. 없으면 그냥 통과(공개 화면용).
  function attach(req, res, next) {
    const token = req.cookies?.[COOKIE];
    if (token) {
      try {
        const p = jwt.verify(token, secret);
        const m = db.prepare('SELECT id, name, phone, role, title, level, status, joined_at, is_owner, is_coach, photo FROM member WHERE id=?').get(p.id);
        // 탈퇴(삭제)한 사람의 쿠키는 더 이상 통하지 않는다
        if (m) req.me = m;
      } catch (e) { /* 만료·위조 — 로그인 안 된 것으로 본다 */ }
    }
    next();
  }

  const requireMember = (req, res, next) =>
    req.me ? next() : res.status(401).json({ error: 'login_required' });

  // 운영진(오너 포함) — 가입 승인, 일정·공지·회비 관리
  const requireAdmin = (req, res, next) =>
    req.me ? ((req.me.role === 'admin' || req.me.is_owner) ? next() : res.status(403).json({ error: 'admin_only' }))
           : res.status(401).json({ error: 'login_required' });

  // 오너만 — 권한 주기/회수, 회칙 수정, 조직도, 회비 금액, 회원 삭제
  const requireOwner = (req, res, next) =>
    req.me ? (req.me.is_owner ? next() : res.status(403).json({ error: 'owner_only' }))
           : res.status(401).json({ error: 'login_required' });

  return { sign, setCookie, clearCookie, attach, requireMember, requireAdmin, requireOwner, lockedFor, noteFail, clearFails, COOKIE };
}

module.exports = { createAuth, COOKIE, FAIL_LIMIT };
