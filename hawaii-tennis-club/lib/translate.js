// 회원이 쓴 글(공지·게시판·일정)을 화면 언어로 번역해 함께 보여준다. 원문은 절대 손대지 않는다.
//
// 번역기는 같은 서버의 translator 서비스(포트 6011)를 쓴다 — 외부 비용 없음.
// 한 번 번역한 문장은 DB(tr 테이블)에 넣어 두고 다시 부르지 않는다.
// 첫 호출이 7~8초나 걸려서, 정해진 시간(기본 6초)만 기다리고 못 끝낸 것은
// 원문을 그대로 보여준다. 못 끝낸 번역은 뒤에서 계속 돌아 캐시에 들어가므로
// 다음에 열 때는 번역문이 보인다.
const TR_URL = process.env.TRANSLATE_URL || 'http://127.0.0.1:6011/api/translate';
const TIMEOUT_MS = 8000;
const BUDGET_MS = 6000;
const CONCURRENCY = 5;
const MAX_CHARS = 1200;      // 너무 긴 글은 번역기가 토막 내거나 실패한다 — 원문을 보여준다
const TARGETS = ['en', 'ko', 'mn'];   // 번역해 줄 언어 (화면은 영어라 보통 en)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 한글이면 ko, 키릴이면 mn. 숫자·영문만이면 번역할 것이 없다.
function srcLang(s) {
  if (/[가-힣]/.test(s)) return 'ko';
  if (/[Ѐ-ӿ]/.test(s)) return 'mn';
  return null;
}

function createTranslator(db, opts = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS tr (
    src        TEXT NOT NULL,
    target     TEXT NOT NULL,
    out        TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (src, target)
  )`);

  const getTr = db.prepare('SELECT out FROM tr WHERE src=? AND target=?');
  const putTr = db.prepare('INSERT OR REPLACE INTO tr (src, target, out) VALUES (?,?,?)');

  const call = opts.translate || (async (text, from, to) => {
    const r = await fetch(TR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from, to }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) throw new Error('translator ' + r.status);
    return (await r.json()).translated;
  });

  const budget = opts.budgetMs ?? BUDGET_MS;

  // 서로 다른 문장만 한 번씩. 실패한 문장은 결과에서 빠지고 화면에는 원문만 보인다.
  async function translateAll(texts, to) {
    const out = new Map();
    if (!TARGETS.includes(to)) return out;

    const todo = [];
    for (const raw of new Set((texts || []).filter(Boolean).map(String))) {
      const s = raw.trim();
      if (!s || s.length > MAX_CHARS) continue;
      const from = srcLang(s);
      if (!from || from === to) continue;        // 이미 그 언어거나 번역할 게 없다
      const hit = getTr.get(s, to);
      if (hit) { out.set(raw, hit.out); continue; }
      todo.push({ raw, s, from });
    }
    if (!todo.length) return out;

    // 번역기를 한꺼번에 때리지 않는다
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const { raw, s, from } = todo[next++];
        try {
          const t = String((await call(s, from, to)) || '').trim();
          if (t && t !== s) { putTr.run(s, to, t); out.set(raw, t); }
        } catch (e) { /* 실패 — 원문을 그대로 보여준다 */ }
      }
    };
    const all = Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    all.catch(() => {});                          // 뒤에서 계속 돌아도 터지지 않게
    await Promise.race([all, sleep(budget)]);     // 정해진 시간만 기다린다
    return out;
  }

  // rows 의 지정한 칸을 번역해 '칸_tr' 을 덧붙인다. 원문은 그대로 둔다.
  async function attach(rows, fields, to) {
    const list = Array.isArray(rows) ? rows : [rows];
    if (!to || !list.length) return rows;
    const texts = [];
    for (const r of list) for (const f of fields) if (r?.[f]) texts.push(r[f]);
    if (!texts.length) return rows;

    const map = await translateAll(texts, to);
    if (!map.size) return rows;
    for (const r of list) {
      for (const f of fields) {
        if (r?.[f] && map.has(r[f])) r[`${f}_tr`] = map.get(r[f]);
      }
    }
    return rows;
  }

  return { translateAll, attach, srcLang };
}

module.exports = { createTranslator, srcLang, TR_URL };
