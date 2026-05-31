// Hawaii Group Coach App — 매주 자동 프로그램 재생성
// inseason + winter 양쪽을 매주 6일치 재구성. 백업 + 트랜잭션.

const DAY_THEMES = {
  1: { title: '기본기 + 폼교정', main: ['베이스라인', 'technical'], aux: ['정확도'] },
  2: { title: '리커버리 + 이동',  main: ['movement', 'conditioning'], aux: ['베이스라인'] },
  3: { title: '수비→공격 전환',   main: ['전환', 'tactical'],          aux: ['베이스라인'] },
  4: { title: '네트 플레이',      main: ['발리·네트'],                 aux: ['전환'] },
  5: { title: '랠리 감각',        main: ['베이스라인', '게임'],         aux: ['정확도'] },
  6: { title: '게임 + 매치',      main: ['게임', 'match'],              aux: ['mental'] },
};

const PHASES = ['inseason', 'winter'];

// 랜덤 유틸 (가중치 기반 선택 / 단순 random)
function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// drills 중 (카테고리 후보, 제외할 id Set, phase 옵션) → 1개 픽
function pickDrill(db, categories, usedIds, phase) {
  if (!categories || categories.length === 0) return null;
  const cats = Array.isArray(categories) ? categories : [categories];

  // level 가중치: inseason은 easy/medium 위주, hard 30% 확률만 통과
  // winter는 medium/hard 위주, easy 50% 확률만 통과
  const placeholders = cats.map(() => '?').join(',');
  const sql = `SELECT id, name, detail, level, category FROM drills
               WHERE category IN (${placeholders})
                 AND COALESCE(archived, 0) = 0`;
  const rows = db.prepare(sql).all(...cats);
  if (rows.length === 0) return null;

  // phase별 level 필터 + strength/conditioning/체력 가중치
  const filtered = rows.filter(r => {
    if (usedIds.has(r.id)) return false;
    const lvl = (r.level || 'medium').toLowerCase();
    if (phase === 'inseason') {
      if (lvl === 'hard' && Math.random() > 0.30) return false;
    } else if (phase === 'winter') {
      if (lvl === 'easy' && Math.random() > 0.50) return false;
    }
    return true;
  });

  // strength/conditioning/체력 가중치 적용 (samples 늘리거나 줄여서 확률 조정)
  // 단순화: 가중치만큼 동일 row를 후보 풀에 복제
  const pool = [];
  filtered.forEach(r => {
    let w = 1.0;
    if (phase === 'inseason' && (r.category === 'strength' || r.category === 'conditioning')) w = 0.5;
    if (phase === 'winter' && (r.category === 'strength' || r.category === 'conditioning' || r.category === '체력')) w = 1.5;
    const copies = Math.max(1, Math.round(w * 2)); // 2배 스케일 후 반올림 → 최소 1
    for (let i = 0; i < copies; i++) pool.push(r);
  });

  // 만약 filtered가 비었으면 (예: 너무 빡센 필터), usedIds 무시하고 fallback
  if (pool.length === 0) {
    const fallback = rows.filter(r => !usedIds.has(r.id));
    if (fallback.length === 0) return pickRandom(rows); // 정말 없으면 중복 허용
    return pickRandom(fallback);
  }
  return pickRandom(pool);
}

// 메인 카테고리 가중치 (inseason 1.2배) — 카테고리 선택 시 main을 더 자주 뽑게
function pickMainCategory(theme, phase) {
  // main 카테고리는 가중치 1.2 (inseason)
  // 단순화: theme.main에서 random 1개
  return pickRandom(theme.main);
}

function composeProgram({ db, phase, dayOfWeek, usedIdsByPhase }) {
  const theme = DAY_THEMES[dayOfWeek];
  if (!theme) throw new Error('unknown day: ' + dayOfWeek);

  const used = usedIdsByPhase[phase] || new Set();
  const blocks = [];

  // 1) 웜업 15분 — 체력 or movement
  const warmup = pickDrill(db, ['체력', 'movement'], used, phase);
  if (warmup) {
    used.add(warmup.id);
    blocks.push({ time: '15분', name: warmup.name, detail: warmup.detail || '' });
  }

  // 2) 메인 45분 — 테마 main 중 1개 카테고리에서 1드릴
  const mainCat = pickMainCategory(theme, phase);
  const main = pickDrill(db, [mainCat], used, phase);
  if (main) {
    used.add(main.id);
    blocks.push({ time: '45분', name: main.name, detail: main.detail || '' });
  }

  // 3) 보조 30분 — main 다른 카테고리 또는 aux
  const otherMains = theme.main.filter(c => c !== mainCat);
  const auxCats = [...otherMains, ...theme.aux];
  const aux = pickDrill(db, auxCats, used, phase);
  if (aux) {
    used.add(aux.id);
    blocks.push({ time: '30분', name: aux.name, detail: aux.detail || '' });
  }

  // 4) 서브·리턴 30분 — 항상 서브·리턴 카테고리에서
  const serve = pickDrill(db, ['서브·리턴'], used, phase);
  if (serve) {
    used.add(serve.id);
    blocks.push({ time: '30분', name: serve.name, detail: serve.detail || '' });
  }

  // 5) 마무리 15분 — recovery or mental
  const cool = pickDrill(db, ['recovery', 'mental'], used, phase);
  if (cool) {
    used.add(cool.id);
    blocks.push({ time: '15분', name: cool.name, detail: cool.detail || '' });
  }

  usedIdsByPhase[phase] = used;

  return {
    title: theme.title + ' (' + phase + ', auto)',
    blocks,
  };
}

function regenerateWeeklyPrograms(db, reason) {
  reason = reason || 'weekly_auto';

  // 백업 테이블이 없다면 생성 (idempotent)
  db.exec(`CREATE TABLE IF NOT EXISTS phase_programs_backup (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_at TEXT NOT NULL DEFAULT (datetime('now')),
    reason TEXT,
    phase TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    title TEXT,
    blocks TEXT
  )`);

  const tx = db.transaction(() => {
    // 1) 현재 inseason+winter row를 백업
    const existing = db.prepare(
      "SELECT phase, day_of_week, title, blocks FROM phase_programs WHERE phase IN ('inseason','winter')"
    ).all();
    const insBackup = db.prepare(
      "INSERT INTO phase_programs_backup (reason, phase, day_of_week, title, blocks) VALUES (?,?,?,?,?)"
    );
    let backedUp = 0;
    existing.forEach(r => { insBackup.run(reason, r.phase, r.day_of_week, r.title, r.blocks); backedUp++; });

    // 2) 기존 inseason+winter 삭제
    db.prepare("DELETE FROM phase_programs WHERE phase IN ('inseason','winter')").run();

    // 3) 새 프로그램 12개 생성 (phase 2 × dow 6)
    const insProg = db.prepare(
      "INSERT INTO phase_programs (phase, day_of_week, title, blocks) VALUES (?,?,?,?)"
    );
    const usedIdsByPhase = { inseason: new Set(), winter: new Set() };
    let replaced = 0;
    for (const phase of PHASES) {
      for (let dow = 1; dow <= 6; dow++) {
        const prog = composeProgram({ db, phase, dayOfWeek: dow, usedIdsByPhase });
        insProg.run(phase, dow, prog.title, JSON.stringify(prog.blocks));
        replaced++;
      }
    }

    // 4) 30일 이상 된 백업 정리
    db.prepare("DELETE FROM phase_programs_backup WHERE backup_at < datetime('now','-30 days')").run();

    return { replaced, backed_up: backedUp };
  });

  // IMMEDIATE 트랜잭션으로 write lock 즉시 획득
  return tx.immediate();
}

module.exports = { regenerateWeeklyPrograms, composeProgram };
