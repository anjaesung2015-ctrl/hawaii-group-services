// retranslate-job.js — pending/failed 항목을 5분마다 재시도 (mn→ko 보고 + ko→mn 업무지시)
const { translateMnKo, translateKoMn } = require('./translator-client');

const FIELDS = [
  ['field_today','field_today_ko'],
  ['field_tomorrow','field_tomorrow_ko'],
  ['field_issue','field_issue_ko'],
  ['field_done','field_done_ko'],
  ['field_plan','field_plan_ko'],
  ['field_suggestion','field_suggestion_ko'],
];

async function runReports(db) {
  const rows = db.prepare("SELECT * FROM work_reports WHERE translation_status='partial' OR translation_status='failed' ORDER BY id DESC LIMIT 50").all();
  for (const row of rows) {
    let allOk = true;
    const updates = {};
    for (const [src, dst] of FIELDS) {
      if (row[src] && (row[dst] === null || row[dst] === undefined || row[dst] === '')) {
        try {
          updates[dst] = await translateMnKo(row[src]);
        } catch (e) {
          allOk = false;
          db.prepare("INSERT INTO report_audit (staff_id, action, detail) VALUES (?,?,?)")
            .run(row.staff_id, 'translate_retry_fail', `id=${row.id} ${dst}: ${e.message.slice(0,100)}`);
        }
      }
    }
    if (Object.keys(updates).length) {
      const setExpr = Object.keys(updates).map(k => `${k}=?`).join(', ');
      const newStatus = allOk ? 'done' : 'partial';
      db.prepare(`UPDATE work_reports SET ${setExpr}, translation_status=? WHERE id=?`)
        .run(...Object.values(updates), newStatus, row.id);
    }
  }
}

async function runAssignments(db) {
  const rows = db.prepare("SELECT id, title, description, title_mn, description_mn FROM work_assignments WHERE deleted_at IS NULL AND (translation_status IS NULL OR translation_status IN ('pending','failed','partial')) LIMIT 50").all();
  for (const row of rows) {
    const updates = {};
    let allOk = true;
    if (row.title && !row.title_mn) {
      try { updates.title_mn = await translateKoMn(row.title); } catch (e) { allOk = false; console.error('[retranslate-assign]', `id=${row.id} title:`, e.message.slice(0,100)); }
    }
    if (row.description && !row.description_mn) {
      try { updates.description_mn = await translateKoMn(row.description); } catch (e) { allOk = false; console.error('[retranslate-assign]', `id=${row.id} desc:`, e.message.slice(0,100)); }
    }
    if (Object.keys(updates).length) {
      const setExpr = Object.keys(updates).map(k => `${k}=?`).join(', ');
      db.prepare(`UPDATE work_assignments SET ${setExpr}, translation_status=? WHERE id=?`)
        .run(...Object.values(updates), allOk ? 'done' : 'partial', row.id);
    } else if (allOk && (!row.title || row.title_mn) && (!row.description || row.description_mn)) {
      db.prepare("UPDATE work_assignments SET translation_status='done' WHERE id=?").run(row.id);
    }
  }
}

async function runOnce(db) {
  await runReports(db);
  await runAssignments(db);
}

function start(db, intervalMs = 5 * 60 * 1000) {
  setInterval(() => runOnce(db).catch(e => console.error('[retranslate]', e.message)), intervalMs);
  console.log('[retranslate] background job started, interval:', intervalMs / 1000, 's');
}

module.exports = { start, runOnce };
