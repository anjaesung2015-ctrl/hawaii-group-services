// report-routes.js — 업무보고 API 라우트 (직원 측 + M4 관리자 측)
const express = require('express');
const jwt = require('jsonwebtoken');
const { verifyPin, issueToken, requireStaff } = require('./pin-auth');
const { translateMnKo, translateKoMn } = require('./translator-client');

// Background ko→mn translation for work_assignments (caller doesn't await)
function translateAssignmentBg(db, id) {
  setImmediate(async () => {
    const a = db.prepare("SELECT title, description FROM work_assignments WHERE id=?").get(id);
    if (!a) return;
    try {
      const tMn = a.title ? await translateKoMn(a.title) : '';
      const dMn = a.description ? await translateKoMn(a.description) : '';
      db.prepare("UPDATE work_assignments SET title_mn=?, description_mn=?, translation_status='done' WHERE id=?")
        .run(tMn, dMn, id);
    } catch (e) {
      db.prepare("UPDATE work_assignments SET translation_status='failed' WHERE id=?").run(id);
      console.error('[assignment-translate]', `id=${id}`, e.message.slice(0, 150));
    }
  });
}
const { sendWithRetry } = require('./telegram-client');

// 기존 server.js 의 SECRET 와 동일해야 함 (admin JWT 검증용)
const SECRET = process.env.STAFF_MGR_SECRET || 'staff-mgr-2026-secret';
// users.role 에 존재하는 값. 현재 users 테이블엔 'admin', 'manager' 만 존재 → 둘 다 사장권한 허용
const BOSS_ROLES = ['admin', 'manager'];

// === M5: realtime telegram alert (debounced 5min) ===
const debounceTimers = new Map(); // key: staff_id::report_date

function buildRealtimeMessage(row) {
  const dt = new Date(row.submitted_at || Date.now());
  const dateStr = dt.toLocaleDateString('ko-KR') + ' ' + dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const fmt = (label, ko, orig) => {
    const v = (ko && ko.trim()) ? ko : (orig || '').trim();
    return v ? `\n${label}: ${v.length > 120 ? v.slice(0, 120) + '...' : v}` : '';
  };
  return `✅ <b>${row.name || ''}</b>${row.name_mn ? ' (' + row.name_mn + ')' : ''} 일일보고\n🕒 ${dateStr}` +
    fmt('📝 오늘', row.field_today_ko, row.field_today) +
    fmt('📅 내일', row.field_tomorrow_ko, row.field_tomorrow) +
    fmt('⚠️ 이슈', row.field_issue_ko, row.field_issue);
}

async function notifyRealtime(db, reportId) {
  const settings = Object.fromEntries(db.prepare("SELECT key,value FROM report_settings").all().map(r => [r.key, r.value]));
  if (settings.realtime_alert !== '1') return;
  if (!settings.telegram_chat_id) return;
  const row = db.prepare(`SELECT wr.*, s.name, s.name_mn FROM work_reports wr JOIN staff s ON s.id=wr.staff_id WHERE wr.id=?`).get(reportId);
  if (!row) return;
  if (row.notified === 1) return;
  try {
    await sendWithRetry(settings.telegram_chat_id, buildRealtimeMessage(row));
    db.prepare("UPDATE work_reports SET notified=1 WHERE id=?").run(reportId);
  } catch (e) {
    db.prepare("UPDATE work_reports SET notified=-1 WHERE id=?").run(reportId);
    db.prepare("INSERT INTO report_audit (staff_id, action, detail) VALUES (?,?,?)").run(row.staff_id, 'notify_fail', (e.message || '').slice(0, 200));
  }
}

function scheduleNotify(db, reportId, staffId, date) {
  const key = `${staffId}::${date}`;
  if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key));
  const t = setTimeout(() => { notifyRealtime(db, reportId); debounceTimers.delete(key); }, 5 * 60 * 1000);
  debounceTimers.set(key, t);
}

function requireBoss(req, res, next) {
  let token = null;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) token = auth.slice(7);
  if (!token && req.cookies) token = req.cookies.staff_token || null;
  if (!token) return res.status(401).json({ error: 'admin_required' });
  try {
    const data = jwt.verify(token, SECRET);
    if (!data.role || !BOSS_ROLES.includes(data.role)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }
    req.adminUser = data;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'admin_token_invalid' });
  }
}

function todayStr() { const d=new Date(); d.setUTCHours(d.getUTCHours()+9); return d.toISOString().slice(0,10); }
function isoWeek(d=new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(),0,4));
  const week = 1 + Math.round(((t - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay()+6)%7))/7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}

module.exports = function createReportRoutes(db) {
  const r = express.Router();

  // 활성 직원 목록 (PIN 발급된 사람만)
  r.get('/staff-list', (req, res) => {
    const list = db.prepare("SELECT id, name, name_mn FROM staff WHERE is_active=1 AND pin_hash IS NOT NULL ORDER BY name").all();
    res.json(list);
  });

  // PIN 로그인
  r.post('/login', (req, res) => {
    const { staff_id, pin } = req.body || {};
    if (!staff_id || !pin) return res.status(400).json({ error: 'missing' });
    const staff = db.prepare("SELECT * FROM staff WHERE id=? AND is_active=1").get(staff_id);
    if (!staff) return res.status(404).json({ error: 'not_found' });
    const result = verifyPin(db, staff, String(pin));
    if (!result.ok) return res.status(401).json(result);
    const token = issueToken(staff.id);
    res.cookie('staff_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 8*60*60*1000 });
    res.json({ ok: true, staff: { id: staff.id, name: staff.name, name_mn: staff.name_mn } });
  });

  // 로그아웃
  r.post('/logout', (req, res) => {
    res.clearCookie('staff_token');
    res.json({ ok: true });
  });

  // 본인 정보
  r.get('/me', requireStaff, (req, res) => {
    const s = db.prepare("SELECT id, name, name_mn, phone, business, position, role FROM staff WHERE id=?").get(req.staffId);
    res.json(s || {});
  });

  // 본인 정보 변경 (이름/몽골어이름/전화/PIN)
  r.put('/me', requireStaff, (req, res) => {
    const { name, name_mn, phone, current_pin, new_pin } = req.body || {};
    const s = db.prepare("SELECT * FROM staff WHERE id=?").get(req.staffId);
    if (!s) return res.status(404).json({ error: 'not_found' });

    // PIN 변경: current_pin 검증 후 새 hash 저장
    if (new_pin !== undefined && new_pin !== '') {
      if (!/^\d{4}$/.test(String(new_pin))) return res.status(400).json({ error: 'PIN은 4자리 숫자여야 합니다' });
      const result = verifyPin(db, s, String(current_pin || ''));
      if (!result.ok) return res.status(400).json({ error: '현재 PIN이 틀립니다' });
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync(String(new_pin), 10);
      db.prepare("UPDATE staff SET pin_hash=?, pin_fail_count=0, pin_locked_until=NULL WHERE id=?").run(hash, req.staffId);
    }

    // 이름/전화는 그냥 업데이트 (PIN 인증으로 이미 본인 확인됨)
    if (name !== undefined || name_mn !== undefined || phone !== undefined) {
      db.prepare("UPDATE staff SET name=?, name_mn=?, phone=? WHERE id=?")
        .run(name ?? s.name, name_mn ?? s.name_mn, phone ?? s.phone, req.staffId);
      // users.name도 sync (해당 staff_id를 가진 user)
      if (name !== undefined && name !== s.name) {
        db.prepare("UPDATE users SET name=? WHERE staff_id=?").run(name, req.staffId);
      }
    }
    res.json({ ok: true });
  });

  // 보고 제출 (일일/주간) — M3: mn→ko 번역 통합
  r.post('/submit', requireStaff, async (req, res) => {
    const { report_type, fields } = req.body || {};
    if (!['daily','weekly'].includes(report_type)) return res.status(400).json({ error: 'invalid_type' });
    const date = report_type === 'daily' ? todayStr() : isoWeek();

    const f = fields || {};
    const fieldMap = report_type === 'daily'
      ? { today:'field_today', tomorrow:'field_tomorrow', issue:'field_issue' }
      : { done:'field_done', plan:'field_plan', suggestion:'field_suggestion' };

    const cols = {};
    let translationFailed = false;
    for (const [src, col] of Object.entries(fieldMap)) {
      const orig = (f[src] || '').trim();
      cols[col] = orig;
      const koCol = col + '_ko';
      if (!orig) { cols[koCol] = ''; continue; }
      try {
        cols[koCol] = await translateMnKo(orig);
      } catch (e) {
        cols[koCol] = null;
        translationFailed = true;
        db.prepare("INSERT INTO report_audit (staff_id, action, detail) VALUES (?,?,?)")
          .run(req.staffId, 'translate_fail', `${col}: ${e.message.slice(0,200)}`);
      }
    }
    cols.translation_status = translationFailed ? 'partial' : 'done';
    if (report_type === 'daily') cols.field_checklist = JSON.stringify(Array.isArray(f.checklist) ? f.checklist : []);

    const existing = db.prepare("SELECT id FROM work_reports WHERE staff_id=? AND report_type=? AND report_date=?").get(req.staffId, report_type, date);
    let reportId;
    let action;
    if (existing) {
      const setExpr = Object.keys(cols).map(k=>`${k}=?`).concat(["updated_at=datetime('now','localtime')"]).join(', ');
      db.prepare(`UPDATE work_reports SET ${setExpr} WHERE id=?`).run(...Object.values(cols), existing.id);
      reportId = existing.id;
      action = 'updated';
    } else {
      const colNames = ['staff_id','report_type','report_date',...Object.keys(cols)];
      const placeholders = colNames.map(()=>'?').join(',');
      const info = db.prepare(`INSERT INTO work_reports (${colNames.join(',')}) VALUES (${placeholders})`).run(req.staffId, report_type, date, ...Object.values(cols));
      reportId = info.lastInsertRowid;
      action = 'created';
    }
    // M5: schedule realtime telegram alert (5min debounce, daily only)
    if (report_type === 'daily') {
      try { scheduleNotify(db, reportId, req.staffId, date); } catch(e) { /* noop */ }
    }
    res.json({ ok: true, id: reportId, action, translation_status: cols.translation_status });
  });


  // === 직원: 본인이 받은 오늘 업무지시 ===
  r.get('/my-assignments', requireStaff, (req, res) => {
    const today = todayStr();
    const staff = db.prepare("SELECT id, business FROM staff WHERE id=?").get(req.staffId);
    if (!staff) return res.status(404).json({ error: 'staff_not_found' });
    const all = db.prepare(`SELECT * FROM work_assignments WHERE is_active=1 AND deleted_at IS NULL
      AND ((recurrence='daily') OR (recurrence='once' AND target_date=?))`).all(today);
    const filtered = all.filter(a => {
      if (a.scope === 'all') return true;
      if (a.scope === 'business') return a.scope_value === staff.business;
      if (a.scope === 'staff') return String(a.scope_value) === String(staff.id);
      return false;
    });
    // 완료 상태 join
    const compStmt = db.prepare("SELECT done, done_at FROM assignment_completions WHERE assignment_id=? AND staff_id=? AND date=?");
    const result = filtered.map(a => {
      const c = compStmt.get(a.id, staff.id, today) || { done: 0 };
      return {
        id: a.id,
        title: a.title_mn || a.title,
        description: a.description_mn || a.description,
        title_ko: a.title,
        description_ko: a.description,
        recurrence: a.recurrence,
        done: !!c.done,
        done_at: c.done_at
      };
    });
    res.json(result);
  });

  // === 직원: 본인 지시 체크/언체크 ===
  r.post('/assignment-check', requireStaff, (req, res) => {
    const { assignment_id, done } = req.body || {};
    if (!assignment_id) return res.status(400).json({ error: 'missing' });
    const today = todayStr();
    const upsert = db.prepare(`INSERT INTO assignment_completions (assignment_id, staff_id, date, done, done_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(assignment_id, staff_id, date) DO UPDATE SET done=excluded.done, done_at=excluded.done_at`);
    upsert.run(assignment_id, req.staffId, today, done ? 1 : 0, done ? new Date().toISOString() : null);
    res.json({ ok: true });
  });

    // 본인 보고 이력
  r.get('/my-reports', requireStaff, (req, res) => {
    const rows = db.prepare("SELECT id, report_type, report_date, submitted_at, updated_at FROM work_reports WHERE staff_id=? ORDER BY submitted_at DESC LIMIT 50").all(req.staffId);
    res.json(rows);
  });

  // 본인 보고 1건 상세
  r.get('/my-reports/:id', requireStaff, (req, res) => {
    const row = db.prepare("SELECT * FROM work_reports WHERE id=? AND staff_id=?").get(req.params.id, req.staffId);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  });

  // ===== 관리자(사장님) 영역 =====

  // 오늘 대시보드: 제출/미제출 직원 + 짧은 요약
  r.get('/admin/today', requireBoss, (req, res) => {
    const date = todayStr();
    const dayKo = ['일','월','화','수','목','금','토'][new Date().getDay()];
    const all = db.prepare("SELECT id, name, name_mn, work_days FROM staff WHERE is_active=1 ORDER BY name").all();
    const expected = all.filter(s => !s.work_days || s.work_days.includes(dayKo));
    const submitted = db.prepare(`SELECT wr.id, wr.staff_id, wr.submitted_at, wr.updated_at, wr.translation_status, wr.field_today_ko, wr.field_today,
      s.name, s.name_mn FROM work_reports wr JOIN staff s ON s.id=wr.staff_id
      WHERE wr.report_type='daily' AND wr.report_date=? ORDER BY wr.submitted_at DESC`).all(date);
    const submittedIds = new Set(submitted.map(s => s.staff_id));
    const missing = expected.filter(s => !submittedIds.has(s.id));
    res.json({ date, expected_count: expected.length, submitted, missing });
  });

  // 보고 1건 상세 (모든 필드 + 번역본)
  r.get('/admin/report/:id', requireBoss, (req, res) => {
    const row = db.prepare(`SELECT wr.*, s.name, s.name_mn FROM work_reports wr JOIN staff s ON s.id=wr.staff_id WHERE wr.id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  });

  // 직원 목록 + PIN 상태
  r.get('/admin/staff', requireBoss, (req, res) => {
    const list = db.prepare(`SELECT id, name, name_mn, business, is_active, pin_hash IS NOT NULL as has_pin, pin_locked_until FROM staff ORDER BY id`).all();
    res.json(list);
  });

  // PIN 재발급
  r.post('/admin/staff/:id/reissue-pin', requireBoss, (req, res) => {
    const bcrypt = require('bcryptjs');
    const pin = String(Math.floor(Math.random()*9000)+1000);
    const hash = bcrypt.hashSync(pin, 10);
    db.prepare("UPDATE staff SET pin_hash=?, pin_locked_until=NULL, pin_fail_count=0 WHERE id=?").run(hash, req.params.id);
    res.json({ ok: true, pin });
  });

  // PIN 잠금 해제
  r.post('/admin/staff/:id/unlock', requireBoss, (req, res) => {
    db.prepare("UPDATE staff SET pin_locked_until=NULL, pin_fail_count=0 WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });


  // === 관리자: 업무지시 ===
  r.get("/admin/assignments", requireBoss, (req, res) => {
    const rows = db.prepare("SELECT * FROM work_assignments WHERE deleted_at IS NULL ORDER BY is_active DESC, id DESC").all();
    const today = todayStr();
    const countStmt = db.prepare("SELECT COUNT(*) as c FROM assignment_completions WHERE assignment_id=? AND date=? AND done=1");
    rows.forEach(r => { r.done_today = countStmt.get(r.id, today).c; });
    res.json(rows);
  });

  r.post("/admin/assignments", requireBoss, (req, res) => {
    const { title, description, scope, scope_value, recurrence, target_date } = req.body || {};
    if (!title || !scope || !recurrence) return res.status(400).json({ error: "missing" });
    if (!["all","business","staff"].includes(scope)) return res.status(400).json({ error: "invalid_scope" });
    if (!["daily","once"].includes(recurrence)) return res.status(400).json({ error: "invalid_recurrence" });
    if (recurrence === "once" && !target_date) return res.status(400).json({ error: "date_required" });
    const info = db.prepare("INSERT INTO work_assignments (title, description, scope, scope_value, recurrence, target_date, is_active, translation_status) VALUES (?,?,?,?,?,?,1,'pending')")
      .run(title, description||"", scope, scope_value||"", recurrence, recurrence==="once"?target_date:null);
    translateAssignmentBg(db, info.lastInsertRowid);
    res.json({ ok: true, id: info.lastInsertRowid });
  });

  r.put("/admin/assignments/:id", requireBoss, (req, res) => {
    const id = req.params.id;
    const { title, description, scope, scope_value, recurrence, target_date, is_active } = req.body || {};
    const exists = db.prepare("SELECT id FROM work_assignments WHERE id=?").get(id);
    if (!exists) return res.status(404).json({ error: "not_found" });
    const fields = []; const vals = [];
    if (title !== undefined) { fields.push("title=?"); vals.push(title); }
    if (description !== undefined) { fields.push("description=?"); vals.push(description); }
    if (scope !== undefined) { fields.push("scope=?"); vals.push(scope); }
    if (scope_value !== undefined) { fields.push("scope_value=?"); vals.push(scope_value); }
    if (recurrence !== undefined) { fields.push("recurrence=?"); vals.push(recurrence); }
    if (target_date !== undefined) { fields.push("target_date=?"); vals.push(target_date); }
    if (is_active !== undefined) { fields.push("is_active=?"); vals.push(is_active ? 1 : 0); }
    if (!fields.length) return res.status(400).json({ error: "no_changes" });
    const titleOrDescChanged = (title !== undefined) || (description !== undefined);
    if (titleOrDescChanged) fields.push("translation_status='pending'");
    vals.push(id);
    db.prepare("UPDATE work_assignments SET " + fields.join(", ") + " WHERE id=?").run(...vals);
    if (titleOrDescChanged) translateAssignmentBg(db, id);
    res.json({ ok: true });
  });

  r.delete("/admin/assignments/:id", requireBoss, (req, res) => {
    db.prepare("UPDATE work_assignments SET deleted_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  r.get("/admin/assignments/:id/completions", requireBoss, (req, res) => {
    const id = req.params.id;
    const date = req.query.date || todayStr();
    const a = db.prepare("SELECT * FROM work_assignments WHERE id=?").get(id);
    if (!a) return res.status(404).json({ error: "not_found" });
    let staffList = db.prepare("SELECT id, name, name_mn, business FROM staff WHERE is_active=1").all();
    if (a.scope === "business") staffList = staffList.filter(s => s.business === a.scope_value);
    else if (a.scope === "staff") staffList = staffList.filter(s => String(s.id) === String(a.scope_value));
    const compStmt = db.prepare("SELECT done, done_at FROM assignment_completions WHERE assignment_id=? AND staff_id=? AND date=?");
    const result = staffList.map(s => {
      const c = compStmt.get(id, s.id, date) || {};
      return { staff_id: s.id, name: s.name, name_mn: s.name_mn, done: !!c.done, done_at: c.done_at };
    });
    res.json({ assignment: a, date, completions: result });
  });


  // === 관리자: 특정 직원의 보고 이력 ===
  r.get('/admin/staff/:id/reports', requireBoss, (req, res) => {
    const sid = req.params.id;
    const from = req.query.from;
    const to = req.query.to;
    let sql = "SELECT id, report_type, report_date, submitted_at, updated_at, translation_status FROM work_reports WHERE staff_id=?";
    const params = [sid];
    if (from) { sql += " AND report_date >= ?"; params.push(from); }
    if (to) { sql += " AND report_date <= ?"; params.push(to); }
    sql += " ORDER BY report_date DESC, submitted_at DESC LIMIT 200";
    const rows = db.prepare(sql).all(...params);
    const staff = db.prepare("SELECT id, name, name_mn, business FROM staff WHERE id=?").get(sid);
    res.json({ staff, reports: rows });
  });

  // ===== M5: 주간 종합 =====
  r.get('/admin/weekly/:week', requireBoss, (req, res) => {
    const rows = db.prepare(`SELECT wr.*, s.name, s.name_mn FROM work_reports wr JOIN staff s ON s.id=wr.staff_id
      WHERE wr.report_type='weekly' AND wr.report_date=? ORDER BY s.name`).all(req.params.week);
    res.json(rows);
  });

  // ===== M5: 설정 =====
  r.get('/admin/settings', requireBoss, (req, res) => {
    const map = Object.fromEntries(db.prepare("SELECT key,value FROM report_settings").all().map(r => [r.key, r.value]));
    res.json(map);
  });

  r.put('/admin/settings', requireBoss, (req, res) => {
    const allowed = ['telegram_chat_id', 'daily_summary_time', 'summary_mode', 'realtime_alert', 'weekly_summary', 'include_missing'];
    const body = req.body || {};
    const upsert = db.prepare("INSERT INTO report_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    for (const k of allowed) if (k in body) upsert.run(k, String(body[k]));
    res.json({ ok: true });
  });

  r.post('/admin/settings/test-telegram', requireBoss, async (req, res) => {
    const row = db.prepare("SELECT value FROM report_settings WHERE key='telegram_chat_id'").get();
    const chatId = row && row.value;
    if (!chatId) return res.status(400).json({ error: 'no_chat_id' });
    try {
      await require('./telegram-client').send(chatId, '✅ 테스트 메시지 — 설정이 올바르게 작동합니다.');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });


  // === 직원: 영구 체크리스트 (staff_checklists) ===
  r.get('/my-checklist', requireStaff, (req, res) => {
    const today = todayStr();
    const items = db.prepare("SELECT id, text, sort_order, created_at FROM staff_checklists WHERE staff_id=? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC").all(req.staffId);
    const compStmt = db.prepare("SELECT done, done_at FROM staff_checklist_completions WHERE item_id=? AND date=?");
    const result = items.map(it => {
      const c = compStmt.get(it.id, today) || { done: 0 };
      return { id: it.id, text: it.text, done: !!c.done, done_at: c.done_at };
    });
    res.json({ date: today, items: result });
  });

  r.post('/my-checklist', requireStaff, (req, res) => {
    const text = (req.body && req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'missing_text' });
    const max = db.prepare("SELECT MAX(sort_order) AS m FROM staff_checklists WHERE staff_id=?").get(req.staffId);
    const sort = (max && max.m ? max.m : 0) + 1;
    const info = db.prepare("INSERT INTO staff_checklists (staff_id, text, sort_order) VALUES (?,?,?)").run(req.staffId, text, sort);
    res.json({ ok: true, id: info.lastInsertRowid });
  });

  r.delete('/my-checklist/:id', requireStaff, (req, res) => {
    const id = req.params.id;
    const exists = db.prepare("SELECT id FROM staff_checklists WHERE id=? AND staff_id=? AND deleted_at IS NULL").get(id, req.staffId);
    if (!exists) return res.status(404).json({ error: 'not_found' });
    db.prepare("UPDATE staff_checklists SET deleted_at=datetime('now','localtime') WHERE id=?").run(id);
    res.json({ ok: true });
  });

  r.post('/my-checklist/:id/check', requireStaff, (req, res) => {
    const id = req.params.id;
    const exists = db.prepare("SELECT id FROM staff_checklists WHERE id=? AND staff_id=? AND deleted_at IS NULL").get(id, req.staffId);
    if (!exists) return res.status(404).json({ error: 'not_found' });
    const today = todayStr();
    const done = req.body && req.body.done ? 1 : 0;
    const upsert = db.prepare(`INSERT INTO staff_checklist_completions (item_id, staff_id, date, done, done_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(item_id, date) DO UPDATE SET done=excluded.done, done_at=excluded.done_at`);
    upsert.run(id, req.staffId, today, done, done ? new Date().toISOString() : null);
    res.json({ ok: true });
  });


  // === 직원: 근태 (attendance) ===
  r.get('/attendance/today', requireStaff, (req, res) => {
    const today = todayStr();
    const row = db.prepare("SELECT check_in, check_out FROM attendance WHERE staff_id=? AND date=?").get(req.staffId, today) || {};
    res.json({ date: today, check_in: row.check_in || null, check_out: row.check_out || null });
  });

  r.post('/attendance/check-in', requireStaff, (req, res) => {
    const today = todayStr();
    const now = new Date().toISOString();
    const exists = db.prepare("SELECT id, check_in FROM attendance WHERE staff_id=? AND date=?").get(req.staffId, today);
    if (exists) {
      if (exists.check_in) return res.status(400).json({ error: 'already_checked_in', check_in: exists.check_in });
      db.prepare("UPDATE attendance SET check_in=? WHERE id=?").run(now, exists.id);
    } else {
      db.prepare("INSERT INTO attendance (staff_id, date, check_in) VALUES (?,?,?)").run(req.staffId, today, now);
    }
    res.json({ ok: true, check_in: now });
  });

  r.post('/attendance/check-out', requireStaff, (req, res) => {
    const today = todayStr();
    const now = new Date().toISOString();
    const exists = db.prepare("SELECT id, check_in, check_out FROM attendance WHERE staff_id=? AND date=?").get(req.staffId, today);
    if (!exists || !exists.check_in) return res.status(400).json({ error: 'check_in_required' });
    if (exists.check_out) return res.status(400).json({ error: 'already_checked_out', check_out: exists.check_out });
    db.prepare("UPDATE attendance SET check_out=? WHERE id=?").run(now, exists.id);
    res.json({ ok: true, check_out: now });
  });

  return r;
};
