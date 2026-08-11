const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const PERIODS = ['today', 'tomorrow', 'week', 'month', 'year'];
const DAILY = ['today', 'tomorrow'];   // 달력 한 칸에 들어가는 기간

// ---- 글 속 날짜 인식 ----
// 지원: 2026-08-15 / 2026.8.15 / 8월 15일 / 8/15 / 범위(8/15~8/20, 8월 15일~20일)
// 일부러 지원 안 함: '8월'처럼 일이 없는 것(달 전체를 칠하지 않는다), 9:30 같은 시각, 100/5 같은 비율
const DATE_TOKEN = new RegExp(
  '(\\d{4})[-./](\\d{1,2})[-./](\\d{1,2})' +          // 1,2,3 : 연-월-일
  '|(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일' +          // 4,5   : M월 D일
  '|(?<![\\d:/.])(\\d{1,2})/(\\d{1,2})(?![\\d:/.])' +  // 6,7   : M/D
  '|(\\d{1,2})\\s*일',                                   // 8     : D일 (범위 뒤쪽에서만 씀)
  'g');

function ymd(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;  // 2/30 같은 유령날짜
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// 글에서 날짜를 뽑는다. 연도가 없으면 defaultYear 를 쓴다.
function extractDates(text, defaultYear) {
  if (!text) return [];
  const found = [];
  const hits = [];
  DATE_TOKEN.lastIndex = 0;
  let m;
  while ((m = DATE_TOKEN.exec(String(text))) !== null) {
    if (m[1]) hits.push({ kind: 'full', y: +m[1], m: +m[2], d: +m[3], start: m.index, end: m.index + m[0].length });
    else if (m[4]) hits.push({ kind: 'md', y: defaultYear, m: +m[4], d: +m[5], start: m.index, end: m.index + m[0].length });
    else if (m[6]) hits.push({ kind: 'md', y: defaultYear, m: +m[6], d: +m[7], start: m.index, end: m.index + m[0].length });
    else hits.push({ kind: 'dayonly', d: +m[8], start: m.index, end: m.index + m[0].length });
  }
  const str = String(text);
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h.kind === 'dayonly') continue;              // 홀로 있는 'D일'은 무시
    const a = ymd(h.y, h.m, h.d);
    if (!a) continue;
    found.push(a);
    // 바로 뒤가 물결/하이픈이면 범위로 본다
    const nxt = hits[i + 1];
    if (!nxt) continue;
    if (!/^\s*[~\-–—]\s*$/.test(str.slice(h.end, nxt.start))) continue;
    const b = nxt.kind === 'dayonly' ? ymd(h.y, h.m, nxt.d) : ymd(nxt.y ?? h.y, nxt.m ?? h.m, nxt.d);
    if (!b || b <= a) continue;
    for (let cur = addDays(a, 1), guard = 0; cur <= b && guard < 62; cur = addDays(cur, 1), guard++) found.push(cur);
    i++;                                             // 범위 끝 토큰은 소비
  }
  return [...new Set(found)];
}

module.exports = function createReportRoutes(db, opts = {}) {
  const secret = opts.secret || 'staff-mgr-2026-secret';
  const bossPw = opts.bossPw || '';
  const router = express.Router();

  db.exec(`CREATE TABLE IF NOT EXISTS report_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    pin_hash TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS report_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    item_date TEXT NOT NULL,
    title TEXT,
    memo TEXT,
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);

  // 사장님도 개인 업무공간을 갖는다: role='boss' 행 1개 (멱등)
  const ucols = db.prepare("PRAGMA table_info(report_users)").all().map(c => c.name);
  if (!ucols.includes('role')) db.exec("ALTER TABLE report_users ADD COLUMN role TEXT NOT NULL DEFAULT 'staff'");
  db.prepare("INSERT INTO report_users (name, pin_hash, is_active, role) VALUES ('사장님','!',1,'boss') ON CONFLICT(name) DO NOTHING").run();
  const bossRowId = () => db.prepare("SELECT id FROM report_users WHERE role='boss'").get()?.id || null;

  // ---- 업무 내용 번역 (현황판 전용) — 결과는 DB에 캐시해 같은 문장을 다시 부르지 않는다 ----
  db.exec(`CREATE TABLE IF NOT EXISTS report_tr (
    src TEXT NOT NULL,
    target TEXT NOT NULL,
    out TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (src, target)
  )`);

  const TR_URL = opts.translateUrl || 'http://127.0.0.1:6011/api/translate';
  const rawTranslate = opts.translate || (async (text, from, to) => {
    const resp = await fetch(TR_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from, to }), signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) throw new Error('translator ' + resp.status);
    return (await resp.json()).translated;
  });

  const LANGS = ['ko', 'mn'];
  function srcLang(s) {
    if (/[가-힣]/.test(s)) return 'ko';
    if (/[\u0400-\u04FF]/.test(s)) return 'mn';   // 키릴 = 몽골어
    return null;                                    // 숫자·기호·영문만 → 번역 불필요
  }

  const getTr = db.prepare("SELECT out FROM report_tr WHERE src=? AND target=?");
  const putTr = db.prepare("INSERT OR REPLACE INTO report_tr (src, target, out) VALUES (?,?,?)");

  // 서로 다른 문장만 한 번씩 번역한다. 실패한 문장은 결과에서 빠지고 원문이 그대로 보인다.
  async function translateAll(texts, to) {
    const out = new Map();
    const todo = [];
    for (const s of new Set(texts)) {
      const from = srcLang(s);
      if (!from || from === to) continue;
      const hit = getTr.get(s, to);
      if (hit) { out.set(s, hit.out); continue; }
      todo.push({ s, from });
    }
    const LIMIT = 5;   // 번역기를 한꺼번에 때리지 않는다
    for (let i = 0; i < todo.length; i += LIMIT) {
      await Promise.all(todo.slice(i, i + LIMIT).map(async ({ s, from }) => {
        try {
          const t = String((await rawTranslate(s, from, to)) || '').trim();
          if (!t) return;
          putTr.run(s, to, t);
          out.set(s, t);
        } catch (e) { /* 번역 실패 — 원문을 그대로 보여준다 */ }
      }));
    }
    return out;
  }

  const COOKIE = { path: '/staff-manager', maxAge: 2592000000, sameSite: 'Lax', httpOnly: true, secure: true };

  router.get('/staff-list', (req, res) => {
    res.json(db.prepare("SELECT id, name FROM report_users WHERE is_active=1 AND role='staff' ORDER BY id").all());
  });

  router.post('/login', (req, res) => {
    const { name, password, boss_pw } = req.body || {};
    if (boss_pw !== undefined) {
      if (!bossPw || boss_pw !== bossPw) return res.status(401).json({ error: 'bad_password' });
      const myId = bossRowId();
      const token = jwt.sign({ isBoss: true, staff_id: myId }, secret, { expiresIn: '30d' });
      res.cookie('report_sess', token, COOKIE);
      return res.json({ ok: true, isBoss: true, my_id: myId, name: '사장님' });
    }
    const u = db.prepare("SELECT id, name, pin_hash FROM report_users WHERE name=? AND is_active=1 AND role='staff' ").get(name);
    if (!u || !bcrypt.compareSync(password || '', u.pin_hash)) return res.status(401).json({ error: 'bad_login' });
    const token = jwt.sign({ staff_id: u.id, name: u.name, isBoss: false }, secret, { expiresIn: '30d' });
    res.cookie('report_sess', token, COOKIE);
    res.json({ ok: true, isBoss: false, staff_id: u.id, name: u.name });
  });

  router.post('/logout', (req, res) => {
    res.clearCookie('report_sess', { path: '/staff-manager' });
    res.json({ ok: true });
  });

  function requireSess(req, res, next) {
    const t = req.cookies?.report_sess;
    if (!t) return res.status(401).json({ error: 'login_required' });
    try { req.rsess = jwt.verify(t, secret); next(); }
    catch (e) { return res.status(401).json({ error: 'session_expired' }); }
  }

  // ?periods=today,tomorrow → ['today','tomorrow'] / 값이 잘못되면 null / 미지정이면 undefined
  function periodsOf(req) {
    const raw = req.query.periods;
    if (raw === undefined) return undefined;
    const list = String(raw).split(',').map(x => x.trim()).filter(Boolean);
    if (!list.length || !list.every(x => PERIODS.includes(x))) return null;
    return list;
  }

  function targetStaffId(req, provided) {
    if (req.rsess.isBoss) return provided ? Number(provided) : (Number(req.rsess.staff_id) || bossRowId());
    return req.rsess.staff_id;
  }

  router.use(requireSess);

  // 세션 복원 — 앱을 벗어났다 돌아와도 다시 로그인하지 않도록
  router.get('/me', (req, res) => {
    if (req.rsess.isBoss) return res.json({ isBoss: true, my_id: bossRowId(), name: '사장님' });
    res.json({ isBoss: false, staff_id: Number(req.rsess.staff_id), name: req.rsess.name || '' });
  });

  // 사장님 전용 직원 현황판 — 활성 직원 전원을 항목과 함께 한 번에 반환
  // 달력용 날짜별 집계 — 오늘/내일 항목만 센다 (주·월·연 자유메모는 제외)
  router.get('/calendar', (req, res) => {
    const month = String(req.query.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'bad_month' });

    let sql = "SELECT item_date, staff_id, done FROM report_items WHERE period IN ('today','tomorrow') AND item_date LIKE ?";
    const args = [month + '-%'];
    if (req.rsess.isBoss) {
      const only = req.query.staff_id;
      if (only) { sql += " AND staff_id=?"; args.push(Number(only)); }
      else {
        // 사장님 본인 행은 직원 합산에서 뺀다
        sql += " AND staff_id IN (SELECT id FROM report_users WHERE is_active=1 AND role='staff')";
      }
    } else {
      sql += " AND staff_id=?"; args.push(Number(req.rsess.staff_id));
    }

    const days = {};
    const seen = {};
    for (const row of db.prepare(sql).all(...args)) {
      const d = days[row.item_date] || (days[row.item_date] = { total: 0, done: 0, staff: 0, notes: 0 });
      d.total++;
      if (row.done) d.done++;
      const key = row.item_date + '#' + row.staff_id;
      if (!seen[key]) { seen[key] = 1; d.staff++; }
    }
    // 모든 기간의 글에서 이 달에 해당하는 날짜를 찾아 함께 표시한다
    let mSql = "SELECT item_date, staff_id, title, memo FROM report_items";
    const mArgs = [];
    if (req.rsess.isBoss) {
      const only = req.query.staff_id;
      if (only) { mSql += " WHERE staff_id=?"; mArgs.push(Number(only)); }
      else mSql += " WHERE staff_id IN (SELECT id FROM report_users WHERE is_active=1 AND role='staff')";
    } else { mSql += " WHERE staff_id=?"; mArgs.push(Number(req.rsess.staff_id)); }

    for (const row of db.prepare(mSql).all(...mArgs)) {
      const year = Number(String(row.item_date).slice(0, 4)) || Number(month.slice(0, 4));
      const dates = extractDates((row.title || '') + ' ' + (row.memo || ''), year);
      for (const dt of dates) {
        if (dt.slice(0, 7) !== month) continue;
        const d = days[dt] || (days[dt] = { total: 0, done: 0, staff: 0, notes: 0 });
        d.notes = (d.notes || 0) + 1;
        const key = dt + '#' + row.staff_id;
        if (!seen[key]) { seen[key] = 1; d.staff++; }
      }
    }

    const staffTotal = db.prepare("SELECT COUNT(*) n FROM report_users WHERE is_active=1 AND role='staff'").get().n;
    res.json({ month, staffTotal, days });
  });

  // 하루 상세 — 그날 항목 + 그날이 글에서 언급된 것
  router.get('/day', (req, res) => {
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad_date' });

    let people;
    if (req.rsess.isBoss) {
      const only = req.query.staff_id;
      people = only
        ? db.prepare("SELECT id, name FROM report_users WHERE id=?").all(Number(only))
        : db.prepare("SELECT id, name FROM report_users WHERE is_active=1 AND role='staff' ORDER BY id").all();
    } else {
      people = db.prepare("SELECT id, name FROM report_users WHERE id=?").all(Number(req.rsess.staff_id));
    }
    const ids = people.map(p => p.id);
    if (!ids.length) return res.json([]);
    const ph = ids.map(() => '?').join(',');

    const items = db.prepare(
      "SELECT id, staff_id, title, memo, done FROM report_items WHERE period IN ('today','tomorrow') AND item_date=? AND staff_id IN (" + ph + ") ORDER BY id"
    ).all(date, ...ids);

    const all = db.prepare(
      "SELECT id, staff_id, period, item_date, title, memo FROM report_items WHERE staff_id IN (" + ph + ") ORDER BY id"
    ).all(...ids);

    const byId = new Map(people.map(p => [p.id, { staff_id: p.id, name: p.name, items: [], mentions: [] }]));
    for (const it of items) byId.get(it.staff_id)?.items.push(it);
    for (const row of all) {
      const year = Number(String(row.item_date).slice(0, 4)) || Number(date.slice(0, 4));
      if (!extractDates((row.title || '') + ' ' + (row.memo || ''), year).includes(date)) continue;
      byId.get(row.staff_id)?.mentions.push({ id: row.id, period: row.period, title: row.title, memo: row.memo });
    }
    res.json([...byId.values()]);
  });

  router.get('/overview', async (req, res) => {
    if (!req.rsess.isBoss) return res.status(403).json({ error: 'boss_only' });
    const { period, date } = req.query;
    const many = periodsOf(req);
    if (many === null) return res.status(400).json({ error: 'bad_period' });
    const wanted = many || (PERIODS.includes(period) ? [period] : null);
    if (!wanted) return res.status(400).json({ error: 'bad_period' });
    if (!date) return res.status(400).json({ error: 'date_required' });
    const staff = db.prepare("SELECT id, name FROM report_users WHERE is_active=1 AND role='staff' ORDER BY id").all();
    const items = db.prepare(
      "SELECT id, staff_id, title, memo, done FROM report_items WHERE period IN (" +
      wanted.map(() => '?').join(',') + ") AND item_date=? ORDER BY id"
    ).all(...wanted, date);
    const byStaff = new Map(staff.map(s => [s.id, []]));
    for (const it of items) if (byStaff.has(it.staff_id)) byStaff.get(it.staff_id).push(it);
    const rows = staff.map(s => ({ staff_id: s.id, name: s.name, items: byStaff.get(s.id) }));

    // 화면 언어와 다른 언어로 적힌 글에 번역문(title_tr/memo_tr)을 덧붙인다. 원문은 그대로 둔다.
    const lang = req.query.lang;
    if (LANGS.includes(lang)) {
      try {
        const texts = [];
        for (const row of rows) for (const it of row.items) {
          if (it.title) texts.push(it.title);
          if (it.memo) texts.push(it.memo);
        }
        const tr = await translateAll(texts, lang);
        for (const row of rows) for (const it of row.items) {
          if (it.title && tr.has(it.title)) it.title_tr = tr.get(it.title);
          if (it.memo && tr.has(it.memo)) it.memo_tr = tr.get(it.memo);
        }
      } catch (e) { /* 번역 전체 실패 — 원문 그대로 내려보낸다 */ }
    }
    res.json(rows);
  });

  router.get('/items', (req, res) => {
    const { period, date } = req.query;
    if (period && !PERIODS.includes(period)) return res.status(400).json({ error: 'bad_period' });
    const many = periodsOf(req);
    if (many === null) return res.status(400).json({ error: 'bad_period' });
    const sid = targetStaffId(req, req.query.staff_id);
    if (!sid) return res.status(400).json({ error: 'staff_id_required' });
    let sql = "SELECT * FROM report_items WHERE staff_id=?"; const p = [sid];
    if (many) { sql += " AND period IN (" + many.map(() => '?').join(',') + ")"; p.push(...many); }
    else if (period) { sql += " AND period=?"; p.push(period); }
    if (date) { sql += " AND item_date=?"; p.push(date); }
    sql += " ORDER BY id";
    res.json(db.prepare(sql).all(...p));
  });

  router.post('/items', (req, res) => {
    const { period, item_date, title, memo } = req.body || {};
    if (!PERIODS.includes(period)) return res.status(400).json({ error: 'bad_period' });
    if (!item_date) return res.status(400).json({ error: 'item_date_required' });
    const sid = targetStaffId(req, req.body.staff_id);
    if (!sid) return res.status(400).json({ error: 'staff_id_required' });
    const r = db.prepare("INSERT INTO report_items (staff_id, period, item_date, title, memo) VALUES (?,?,?,?,?)")
      .run(sid, period, item_date, title || '', memo || '');
    res.json({ id: r.lastInsertRowid });
  });

  router.patch('/items/:id', (req, res) => {
    const item = db.prepare("SELECT * FROM report_items WHERE id=?").get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!req.rsess.isBoss && item.staff_id !== Number(req.rsess.staff_id)) return res.status(403).json({ error: 'forbidden' });
    const fields = []; const vals = [];
    const body = req.body || {};
    for (const k of ['title', 'memo', 'done']) if (k in body) { fields.push(k + '=?'); vals.push(k === 'done' ? (body[k] ? 1 : 0) : body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'no_changes' });
    fields.push("updated_at=datetime('now','localtime')");
    vals.push(req.params.id);
    db.prepare("UPDATE report_items SET " + fields.join(', ') + " WHERE id=?").run(...vals);
    res.json({ ok: true });
  });

  router.delete('/items/:id', (req, res) => {
    const item = db.prepare("SELECT * FROM report_items WHERE id=?").get(req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!req.rsess.isBoss && item.staff_id !== Number(req.rsess.staff_id)) return res.status(403).json({ error: 'forbidden' });
    db.prepare("DELETE FROM report_items WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  // 본인 비밀번호 변경 (현재 비번 확인 후)
  router.post("/change-password", (req, res) => {
    if (req.rsess.isBoss) return res.status(403).json({ error: "boss_uses_env" });
    const { current, new_password } = req.body || {};
    if (!new_password || String(new_password).length < 4) return res.status(400).json({ error: "weak_password" });
    const u = db.prepare("SELECT id, pin_hash FROM report_users WHERE id=? AND is_active=1").get(req.rsess.staff_id);
    if (!u || !bcrypt.compareSync(current || "", u.pin_hash)) return res.status(401).json({ error: "bad_current" });
    db.prepare("UPDATE report_users SET pin_hash=? WHERE id=?").run(bcrypt.hashSync(String(new_password), 10), u.id);
    res.json({ ok: true });
  });

  // 사장님이 직원 비번 리셋
  router.post("/reset-password", (req, res) => {
    if (!req.rsess.isBoss) return res.status(403).json({ error: "boss_only" });
    const { staff_id, new_password } = req.body || {};
    if (!staff_id) return res.status(400).json({ error: "staff_id_required" });
    if (!new_password || String(new_password).length < 4) return res.status(400).json({ error: "weak_password" });
    const u = db.prepare("SELECT id, role FROM report_users WHERE id=? AND is_active=1").get(staff_id);
    if (!u) return res.status(404).json({ error: "not_found" });
    if (u.role === 'boss') return res.status(403).json({ error: "boss_row" });
    db.prepare("UPDATE report_users SET pin_hash=? WHERE id=?").run(bcrypt.hashSync(String(new_password), 10), u.id);
    res.json({ ok: true });
  });

  return router;
};
