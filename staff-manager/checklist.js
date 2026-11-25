// 직무별 매일 체크리스트 — hawaii-ops 업무표(data.json)에서 만든 jobs.json 을 쓴다.
// 직원에게 직무(report_users.job)를 정해 두면, 그날 처음 오늘 탭을 열 때 그 요일 업무가
// '오늘 할 일'로 들어간다. 항목은 tpl_key 로 표시되고 직원은 지우거나 제목을 못 고친다(체크·메모만).
// 못 끝낸 체크리스트는 다음 날로 넘어가지 않는다 — 매일 새로 들어오므로 넘기면 쌓이기만 한다.
const fs = require('fs');
const path = require('path');

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
// 추가할 때 고를 수 있는 '언제'
const WHEN_MN = { '매일': 'Өдөр бүр', '출근 15분 내': 'Ирснээс 15 мин', '근무 중': 'Ажлын үеэр', '마감': 'Хаахад',
  '수시': 'Байнга', '즉시': 'Шууд', '하루 2번': 'Өдөрт 2 удаа', '3시간마다': '3 цаг тутам', '14시까지': '14:00 хүртэл',
  '월': 'Да', '화': 'Мя', '수': 'Лх', '목': 'Пү', '금': 'Ба', '토': 'Бя', '매월 첫 월': 'Сарын эхний Да' };

function loadRaw(file) {
  return JSON.parse(fs.readFileSync(file || path.join(__dirname, 'jobs.json'), 'utf8'));
}
function withKeys(jobs) {
  return jobs.map(j => ({ ...j, tasks: j.tasks.map(t => ({ ...t, key: j.key + '|' + t.ko })) }));
}
function loadJobs(file) {
  return withKeys(loadRaw(file).jobs);
}

// 'YYYY-MM-DD' 의 요일 (0=일)
function dowOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// 그 날짜에 해당하는 업무만. 일요일은 휴무라 없음.
function tasksForDate(job, date) {
  const dow = dowOf(date);
  if (dow === 0) return [];
  const day = WEEK[dow];
  const dom = Number(date.slice(8, 10));
  return job.tasks.filter(t => {
    if (t.when === '매월 첫 월') return day === '월' && dom <= 7;
    if (WEEK.includes(t.when)) return t.when === day;
    return true;
  });
}

module.exports = function createChecklist(db, opts = {}) {
  const raw = opts.jobs ? { jobs: opts.jobs, examples: opts.examples || {}, rules: opts.rules || [] } : loadRaw(opts.file);
  const jobs = opts.jobs ? opts.jobs.map(j => ({ ...j, tasks: j.tasks.map(t => ({ ...t, key: t.key || (j.key + '|' + t.ko) })) })) : withKeys(raw.jobs);
  const EXAMPLES = raw.examples || {};
  const RULES = raw.rules || [];
  const byKey = new Map(jobs.map(j => [j.key, j]));
  const taskByKey = new Map();
  for (const j of jobs) for (const t of j.tasks) taskByKey.set(t.key, t);

  // 업무표 편집 — 추가(add)·삭제(del). 원본(jobs.json)은 그대로 두고 그 위에 적용한다.
  db.exec(`CREATE TABLE IF NOT EXISTS report_job_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_key TEXT NOT NULL, action TEXT NOT NULL,
    when_ TEXT, ko TEXT NOT NULL, mn TEXT, photo TEXT, by_name TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')))`);
  const base = new Map(jobs.map(j => [j.key, j.tasks.slice()]));
  const removed = new Map();   // job_key → [원본 task] (되살리기용)
  function applyEdits() {
    const edits = db.prepare("SELECT * FROM report_job_edits ORDER BY id").all();
    removed.clear();
    for (const j of jobs) {
      const dels = new Set(edits.filter(e => e.job_key === j.key && e.action === 'del').map(e => e.ko));
      const orig = base.get(j.key) || [];
      j.tasks = orig.filter(t => !dels.has(t.ko));
      removed.set(j.key, orig.filter(t => dels.has(t.ko)));
      for (const e of edits.filter(e => e.job_key === j.key && e.action === 'add')) {
        const t = { when: e.when_, when_mn: WHEN_MN[e.when_] || e.when_, ko: e.ko, mn: e.mn || e.ko, key: j.key + '|' + e.ko, custom: true };
        if (e.photo) t.photo = e.photo;
        j.tasks.push(t);
        taskByKey.set(t.key, t);
      }
    }
  }
  applyEdits();

  const ucols = db.prepare("PRAGMA table_info(report_users)").all().map(c => c.name);
  if (!ucols.includes('job')) db.exec("ALTER TABLE report_users ADD COLUMN job TEXT");
  const icols = db.prepare("PRAGMA table_info(report_items)").all().map(c => c.name);
  if (!icols.includes('tpl_key')) db.exec("ALTER TABLE report_items ADD COLUMN tpl_key TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_items_tpl ON report_items(staff_id, item_date, tpl_key) WHERE tpl_key IS NOT NULL");

  const getJob = db.prepare("SELECT job FROM report_users WHERE id=? AND is_active=1");
  const ins = db.prepare("INSERT OR IGNORE INTO report_items (staff_id, period, item_date, title, memo, tpl_key) VALUES (?,'today',?,?,'',?)");

  // 그날 체크리스트를 채운다 (여러 번 불러도 한 번만 들어간다)
  const ensure = db.transaction((staffId, date) => {
    const job = byKey.get(getJob.get(staffId)?.job);
    if (!job) return 0;
    let n = 0;
    for (const t of tasksForDate(job, date)) n += ins.run(staffId, date, t.ko, t.key).changes;
    return n;
  });

  // 화면에 필요한 정보(언제, 몽골어)를 붙인다. DB에는 한국어 제목만 있다.
  function decorate(items) {
    for (const it of items) {
      if (!it || !it.tpl_key) continue;
      const t = taskByKey.get(it.tpl_key);
      if (!t) continue;
      it.tpl_when = t.when;
      it.tpl_when_mn = t.when_mn;
      it.tpl_mn = t.mn;
      if (t.ex) it.tpl_ex = t.ex;
      if (t.photo) it.tpl_photo = t.photo;
    }
    return items;
  }

  // 직무를 바꾸면, 오늘 들어간 예전 직무 체크리스트 중 손대지 않은 것만 치운다.
  // 체크했거나 메모를 단 것은 기록이니 남긴다.
  function clearUntouched(staffId, date, keepJob) {
    return db.prepare(
      "DELETE FROM report_items WHERE staff_id=? AND item_date=? AND tpl_key IS NOT NULL" +
      " AND done=0 AND COALESCE(memo,'')='' AND tpl_key NOT LIKE ?"
    ).run(staffId, date, (keepJob || '\u0000') + '|%').changes;
  }

  const list = () => jobs.map(j => ({ key: j.key, site: j.site, role: j.role, label_ko: j.label_ko, label_mn: j.label_mn, count: j.tasks.length }));
  const isJob = k => byKey.has(k);

  // 실제 사업장만 ('전체' = 총매니저 같은 두 사업장 담당)
  const sites = () => [...new Set(jobs.map(j => j.site))].filter(s => s !== '전체');
  const job = k => byKey.get(k) || null;

  // 그 사업장 매니저의 그날 요일 과제 (매일 업무는 빼고 요일·월초 과제만)
  function managerDayTasks(site, date) {
    const j = jobs.find(x => x.site === site && x.role === '매니저');
    if (!j) return [];
    return tasksForDate(j, date).filter(t => t.when !== '매일');
  }

  // 업무 추가: 지웠던 원본이면 되살리고, 아니면 새 줄
  function addTask(jobKey, { when, ko, mn, photo }, byName) {
    const j = byKey.get(jobKey);
    if (!j) return { error: 'bad_job' };
    ko = String(ko || '').trim().slice(0, 200);
    if (!ko) return { error: 'text_required' };
    if (j.tasks.some(t => t.ko === ko)) return { error: 'duplicate' };
    const del = db.prepare("SELECT id FROM report_job_edits WHERE job_key=? AND action='del' AND ko=?").get(jobKey, ko);
    if (del) db.prepare("DELETE FROM report_job_edits WHERE id=?").run(del.id);
    else {
      if (!WHEN_MN[when]) return { error: 'bad_when' };
      db.prepare("INSERT INTO report_job_edits (job_key, action, when_, ko, mn, photo, by_name) VALUES (?,'add',?,?,?,?,?)")
        .run(jobKey, when, ko, String(mn || '').trim().slice(0, 300) || null, ['open', 'close'].includes(photo) ? photo : null, byName || null);
    }
    applyEdits();
    return { ok: true, restored: !!del, key: jobKey + '|' + ko };
  }
  // 업무 삭제: 추가했던 줄이면 지우고, 원본이면 '삭제' 표시. 오늘 들어간 손 안 댄 항목도 치운다.
  function removeTask(jobKey, ko, date) {
    const j = byKey.get(jobKey);
    const t = j && j.tasks.find(x => x.ko === ko);
    if (!t) return { error: 'not_found' };
    if (t.custom) db.prepare("DELETE FROM report_job_edits WHERE job_key=? AND action='add' AND ko=?").run(jobKey, ko);
    else db.prepare("INSERT INTO report_job_edits (job_key, action, ko) VALUES (?,'del',?)").run(jobKey, ko);
    applyEdits();
    let photoCheck = '';
    try { db.prepare("SELECT 1 FROM report_photos LIMIT 1").get(); photoCheck = " AND id NOT IN (SELECT item_id FROM report_photos)"; } catch (e) { }
    const n = date ? db.prepare("DELETE FROM report_items WHERE tpl_key=? AND item_date>=? AND done=0 AND COALESCE(memo,'')=''" + photoCheck).run(t.key, date).changes : 0;
    return { ok: true, cleared: n };
  }
  // 그 직무를 가진 직원들의 그날 체크리스트를 다시 채운다 (새로 추가한 줄만 들어간다)
  function ensureJob(jobKey, date) {
    let n = 0;
    for (const r of db.prepare("SELECT id FROM report_users WHERE is_active=1 AND job=?").all(jobKey)) n += ensure(r.id, date);
    return n;
  }

  return { ensure, decorate, clearUntouched, list, isJob, sites, job, managerDayTasks, addTask, removeTask, ensureJob,
    whenOptions: () => Object.keys(WHEN_MN),
    examples: () => EXAMPLES, rules: () => RULES,
    table: () => jobs.map(j => ({ key: j.key, site: j.site, role: j.role, label_ko: j.label_ko, label_mn: j.label_mn,
      tasks: j.tasks.map(t => ({ when: t.when, when_mn: t.when_mn, ko: t.ko, mn: t.mn, ex: t.ex || null, out: t.out || null, photo: t.photo || null, custom: !!t.custom })),
      removed: (removed.get(j.key) || []).map(t => ({ when: t.when, ko: t.ko })) })), tasksForDate: (k, d) => tasksForDate(byKey.get(k), d) };
};

module.exports.loadJobs = loadJobs;
module.exports.tasksForDate = tasksForDate;
