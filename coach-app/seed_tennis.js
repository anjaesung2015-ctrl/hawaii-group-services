// 코치 앱 테니스 프로그램 업그레이드 시드
const Database = require('better-sqlite3');
const db = new Database('/home/ubuntu/.openclaw/workspace/coach-app/coach.db');

// === 1) 주간 훈련 템플릿 (월~금) 5개 + 토 시합/일 휴식 ===
const insertTpl = db.prepare("INSERT INTO templates (name, description, methodology, is_system) VALUES (?,?,?,1)");
const insertEx = db.prepare("INSERT INTO template_exercises (template_id, category, name, sets, reps, duration_min, notes, order_idx) VALUES (?,?,?,?,?,?,?,?)");

const weekly = [
  {name:'📅 월요일 — 그라운드스트로크 데이', desc:'베이스라인 안정성 · 깊이 · 컨트롤 (90분)', method:'weekly', exercises:[
    {cat:'movement', name:'다이나믹 스트레칭 + 미니 풋워크', mins:10},
    {cat:'technical', name:'미니 코트 컨트롤 랠리', mins:5, notes:'서비스 박스 안만 사용, 탑스핀 컨트롤'},
    {cat:'technical', name:'데드라인 50샷 랠리 (60-70%)', sets:3, mins:15, notes:'안정성 우선, 깊이'},
    {cat:'technical', name:'포핸드 크로스 + 다운더라인 패턴', sets:2, mins:10},
    {cat:'technical', name:'백핸드 크로스 + 다운더라인 패턴', sets:2, mins:10},
    {cat:'tactical', name:'와이드 푸시 → 인사이드아웃 어택', sets:3, mins:15, notes:'코너 압박 후 공격 전환'},
    {cat:'match', name:'5포인트 미니 매치 × 3', sets:3, mins:15},
    {cat:'recovery', name:'쿨다운 스트레칭', mins:10}
  ]},
  {name:'📅 화요일 — 서브 + 리턴 데이', desc:'1·2차 서브 정확도 · 리턴 공격성 (90분)', method:'weekly', exercises:[
    {cat:'movement', name:'어깨 + 코어 활성화 워밍업', mins:10},
    {cat:'technical', name:'1차 서브 100개 (와이드 30 / T 30 / 보디 40)', mins:25, notes:'각 코너 명확히 타겟'},
    {cat:'technical', name:'2차 슬라이스 50개 (안전 + 키커)', mins:15},
    {cat:'tactical', name:'1+1 서브 패턴 (서브 후 즉시 한방)', sets:3, mins:15},
    {cat:'technical', name:'리턴 — 1차(딥) / 2차(공격) 교대', sets:2, mins:15},
    {cat:'match', name:'서브 게임 × 4 (양 코트 교대)', mins:10}
  ]},
  {name:'📅 수요일 — 발리 / 네트 데이', desc:'어프로치 · 발리 · 스매시 + 네트 점령 (90분)', method:'weekly', exercises:[
    {cat:'movement', name:'스플릿 스텝 + 사이드 셔플', mins:10},
    {cat:'technical', name:'미니 발리 — 포/백 교대 (네트 1.5m)', sets:2, mins:15},
    {cat:'technical', name:'풀 발리 — 네트에서 5m 거리', sets:3, mins:15},
    {cat:'technical', name:'어프로치 → 1발리 → 스매시 콤보', sets:3, mins:15},
    {cat:'tactical', name:'서브 앤드 발리 (양 코트)', sets:2, mins:15},
    {cat:'match', name:'네트 점령 게임 (먼저 네트 = 승)', mins:10},
    {cat:'recovery', name:'스트레칭 + 폼롤러', mins:10}
  ]},
  {name:'📅 목요일 — 풋워크 + 체력 데이', desc:'스피드 · 회복 · 코트 커버리지 (90분)', method:'weekly', exercises:[
    {cat:'movement', name:'다이나믹 워밍업 + 저글링', mins:10},
    {cat:'movement', name:'사다리 드릴 (퀵 풋, 인-아웃, 사이드)', sets:3, mins:10},
    {cat:'movement', name:'콘 셔틀 (5콘 스파이더 드릴)', sets:4, mins:10},
    {cat:'conditioning', name:'코트 스프린트 — 베이스→네트→베이스', sets:6, mins:10},
    {cat:'technical', name:'전 코트 커버 랠리 (코치 피드 좌우)', sets:3, mins:15},
    {cat:'strength', name:'코어 — 플랭크 / 사이드 플랭크 / 바이시클', sets:3, mins:10},
    {cat:'strength', name:'하체 — 스쿼트 / 런지 / 박스 점프', sets:3, mins:15},
    {cat:'recovery', name:'쿨다운 + 정적 스트레칭', mins:10}
  ]},
  {name:'📅 금요일 — 시합 시뮬레이션', desc:'실전 점수 · 텐션 · 전술 적용 (90분)', method:'weekly', exercises:[
    {cat:'movement', name:'시합 전 풀 워밍업 루틴', mins:15},
    {cat:'tactical', name:'전술 리뷰 + 게임 플랜 짜기', mins:10, notes:'상대 분석 → 강약점 매칭'},
    {cat:'match', name:'1세트 시합 (실제 점수, 비강제)', mins:35},
    {cat:'match', name:'10포인트 타이브레이커 × 3', sets:3, mins:15},
    {cat:'mental', name:'중간 호흡 + 이미지 트레이닝', mins:5},
    {cat:'recovery', name:'쿨다운 + 시합 노트 작성', mins:10, notes:'무엇이 잘됐는지/무엇이 안됐는지 1줄씩'}
  ]}
];

for (const t of weekly) {
  const r = insertTpl.run(t.name, t.desc, t.method);
  t.exercises.forEach((e, i) => {
    insertEx.run(r.lastInsertRowid, e.cat, e.name, e.sets||null, e.reps||null, e.mins||null, e.notes||null, i);
  });
}
console.log('templates +', weekly.length, '/ exercises +', weekly.reduce((s,t)=>s+t.exercises.length,0));

// === 2) ITF Tennis 10s 페이즈 (red/orange/green) + 성인 입문 ===
const insertPhase = db.prepare("INSERT INTO phase_programs (phase, day_of_week, title, blocks) VALUES (?,?,?,?)");

const phases = [
  // 🔴 RED (U8, 폼볼, 미니 코트 11m × 5.5m)
  {phase:'itf_red', day:1, title:'🔴 빨강(U8) 1일 — 라켓과 친해지기', blocks:[
    {time:'10분', name:'몸 풀기 + 라켓 잡기', detail:'스트레칭 → 콘티넨탈 그립 / 이스턴 그립 익히기'},
    {time:'15분', name:'라켓 컨트롤 게임', detail:'바운스 10번 / 위로 토스 10번 / 좌우 핸드 스위치'},
    {time:'15분', name:'드롭 앤 히트 (포핸드)', detail:'손에서 떨어뜨려 1바운스 후 부드럽게 침'},
    {time:'15분', name:'미니 랠리 (코치 ↔ 학생)', detail:'서로 5번 주고받기 도전'},
    {time:'5분', name:'타겟 게임', detail:'코트에 콘/원 놓고 맞추면 1점'}
  ]},
  {phase:'itf_red', day:2, title:'🔴 빨강(U8) 2일 — 백핸드 도입', blocks:[
    {time:'10분', name:'몸풀기 + 라켓 컨트롤 복습', detail:'전날 한 게임 짧게 반복'},
    {time:'15분', name:'양손 백핸드 드롭 앤 히트', detail:'양손으로 라켓 잡고 옆에서 침'},
    {time:'15분', name:'포핸드 ↔ 백핸드 교대', detail:'코치가 좌우로 던져주고 어느 쪽이든 침'},
    {time:'15분', name:'미니 랠리 (양 사이드)', detail:'10번 연속 도전'},
    {time:'5분', name:'미니 게임', detail:'5점 먼저 도달하면 승리, 1바운스만 OK'}
  ]},
  {phase:'itf_red', day:3, title:'🔴 빨강(U8) 3일 — 서브 도입 + 미니 게임', blocks:[
    {time:'10분', name:'몸 풀기 + 풋워크 게임', detail:'사이드스텝 / 작은 콘 점프'},
    {time:'15분', name:'드롭 서브 (위에서 떨어뜨려)', detail:'어깨 위에서 떨어뜨린 공을 가볍게 침'},
    {time:'15분', name:'서브 + 1구 미니 랠리', detail:'서브 후 1바운스 후 스토로크'},
    {time:'15분', name:'5포인트 미니 매치 × 3', detail:'서로 게임 진행, 점수 카운트'},
    {time:'5분', name:'쿨다운 + 잘한 점 칭찬', detail:'재미가 우선'}
  ]},

  // 🟠 ORANGE (U9-10, 3/4 코트 18m × 6.5m, 압 25%)
  {phase:'itf_orange', day:1, title:'🟠 주황(U9-10) 1일 — 풀 스트로크 안정화', blocks:[
    {time:'10분', name:'다이나믹 워밍업', detail:'러닝 + 스트레칭 + 라켓 워밍업'},
    {time:'20분', name:'베이스라인 랠리 (3/4 코트)', detail:'10번 연속 랠리 도전, 안정성 우선'},
    {time:'15분', name:'크로스코트 패턴 (포/백)', detail:'코너에서 코너로 깊게'},
    {time:'15분', name:'발리 도입 (코치 피드)', detail:'네트 앞 1.5m, 부드러운 컨택트'},
    {time:'10분', name:'미니 매치', detail:'서비스 + 5포인트 게임'}
  ]},
  {phase:'itf_orange', day:2, title:'🟠 주황(U9-10) 2일 — 서브 + 리턴', blocks:[
    {time:'10분', name:'어깨 워밍업 + 서브 모션 연습', detail:'토스 → 백스윙 → 컨택트 패턴'},
    {time:'20분', name:'서브 30개 (T / 와이드)', detail:'박스 안에 들어가는지 확인'},
    {time:'15분', name:'리턴 (포/백 교대)', detail:'딥 리턴 위주, 코트 중앙으로'},
    {time:'15분', name:'서브 게임 (각자 4서브)', detail:'실전처럼 진행'},
    {time:'10분', name:'쿨다운 + 노트', detail:'잘된 점 1가지 적기'}
  ]},
  {phase:'itf_orange', day:3, title:'🟠 주황(U9-10) 3일 — 게임 + 점수', blocks:[
    {time:'10분', name:'풋워크 + 라켓 컨트롤 워밍업', detail:''},
    {time:'15분', name:'쇼트 랠리 → 롱 랠리 전환', detail:'미니에서 풀로 전환 연습'},
    {time:'15분', name:'어프로치 + 발리', detail:'짧은 공 → 네트 → 발리'},
    {time:'25분', name:'1세트 미니 매치 (4게임 우선)', detail:'실제 점수 + 코트 체인지'},
    {time:'5분', name:'쿨다운 + 시합 리뷰', detail:''}
  ]},

  // 🟢 GREEN (U10+, 풀 코트, 압 75%)
  {phase:'itf_green', day:1, title:'🟢 녹색(U10+) 1일 — 풀 코트 적응', blocks:[
    {time:'15분', name:'풀 워밍업 + 줄넘기', detail:''},
    {time:'25분', name:'베이스라인 풀코트 랠리 (70%)', detail:'15샷 연속 도전'},
    {time:'15분', name:'와이드 → 인사이드아웃 패턴', detail:'압박 + 공격 전환'},
    {time:'15분', name:'서브 + 1구', detail:'서브 후 강한 한 방'},
    {time:'15분', name:'5포인트 매치 × 3', detail:''},
    {time:'5분', name:'쿨다운', detail:''}
  ]},
  {phase:'itf_green', day:2, title:'🟢 녹색(U10+) 2일 — 네트 게임 강화', blocks:[
    {time:'15분', name:'풋워크 + 스플릿 스텝 워밍업', detail:''},
    {time:'15분', name:'발리 — 포/백 + 하프발리', detail:'네트 5m 거리'},
    {time:'15분', name:'스매시 (15회) + 어프로치 발리', detail:''},
    {time:'15분', name:'서브 앤드 발리', detail:'2차 서브 후에도 네트로'},
    {time:'15분', name:'네트 점령 게임', detail:'먼저 네트 가는 사람 우세'},
    {time:'15분', name:'쿨다운 + 비디오 셀프 리뷰', detail:''}
  ]},
  {phase:'itf_green', day:3, title:'🟢 녹색(U10+) 3일 — 시합 시뮬레이션', blocks:[
    {time:'15분', name:'풀 워밍업 (시합 직전 루틴)', detail:''},
    {time:'10분', name:'전술 게임 플랜 짜기', detail:'상대 약점 → 어떻게 공격?'},
    {time:'40분', name:'1세트 시합', detail:'실제 점수, 코트 체인지'},
    {time:'15분', name:'10포인트 타이브레이커 × 2', detail:''},
    {time:'10분', name:'쿨다운 + 시합 노트', detail:''}
  ]},

  // 👨 ADULT BEGINNER (성인 입문 4일 사이클)
  {phase:'adult_beginner', day:1, title:'👨 성인 입문 1일 — 라켓/그립/스윙 기초', blocks:[
    {time:'15분', name:'스트레칭 + 라켓 익숙해지기', detail:'그립(이스턴/콘티넨탈), 자세'},
    {time:'20분', name:'드롭 앤 히트 (포핸드)', detail:'옆에서 떨어뜨려 부드럽게 침'},
    {time:'20분', name:'코치 피드 → 포핸드 30회', detail:'느린 공으로 폼 형성'},
    {time:'20분', name:'미니 코트 랠리 도전', detail:'서비스 박스 안 5번 주고받기'},
    {time:'10분', name:'쿨다운 + Q&A', detail:''}
  ]},
  {phase:'adult_beginner', day:2, title:'👨 성인 입문 2일 — 백핸드 + 깊이', blocks:[
    {time:'15분', name:'몸풀기 + 전날 복습', detail:''},
    {time:'25분', name:'양손 백핸드 도입', detail:'양손 그립, 어깨 회전'},
    {time:'20분', name:'포/백 교대 코치 피드', detail:'좌우로 30회씩'},
    {time:'15분', name:'베이스라인 랠리 (3/4 코트, 60%)', detail:'10샷 연속 도전'},
    {time:'10분', name:'쿨다운', detail:''}
  ]},
  {phase:'adult_beginner', day:3, title:'👨 성인 입문 3일 — 서브 + 발리 입문', blocks:[
    {time:'15분', name:'어깨 워밍업 + 서브 모션', detail:'토스 + 컨택 자세'},
    {time:'20분', name:'서브 도입 — 박스 안 들어가기', detail:'1차 서브 30개, 70% 강도'},
    {time:'20분', name:'발리 — 미니 발리 (네트 1.5m)', detail:'부드러운 컨택, 라켓 면 컨트롤'},
    {time:'15분', name:'어프로치 + 1발리', detail:'짧은 공 → 네트로'},
    {time:'10분', name:'쿨다운', detail:''}
  ]},
  {phase:'adult_beginner', day:4, title:'👨 성인 입문 4일 — 첫 게임', blocks:[
    {time:'15분', name:'전체 복습 워밍업', detail:'포/백/서브/발리 짧게'},
    {time:'15분', name:'서브 게임 (각자 4서브)', detail:'점수 시스템 배우기 (15-30-40)'},
    {time:'30분', name:'미니 매치 (3게임 우선)', detail:'실전 룰 적용'},
    {time:'10분', name:'쿨다운 + 다음 사이클 안내', detail:''},
    {time:'10분', name:'전체 리뷰', detail:'잘된 점 / 다음 목표'}
  ]}
];

for (const p of phases) {
  insertPhase.run(p.phase, p.day, p.title, JSON.stringify(p.blocks));
}
console.log('phase_programs +', phases.length);

// === 3) 드릴 라이브러리 보강 (50개) ===
const insertDrill = db.prepare("INSERT INTO drills (category, name, detail, duration, level, sets, reps, sort_idx, archived) VALUES (?,?,?,?,?,?,?,?,0)");

const drills = [
  // technical (그라운드스트로크 + 서브 + 리턴 + 발리)
  {category:'technical', name:'크로스코트 50샷 패턴 (포/백)', detail:'사이드 코너에서 사이드 코너로, 70% 강도 깊이 우선', duration:15, level:'medium'},
  {category:'technical', name:'다운더라인 30샷 패턴 (포)', detail:'코너에서 직선으로 라인 따라', duration:10, level:'hard'},
  {category:'technical', name:'와이드 푸시 → 인사이드아웃', detail:'와이드 후 코트 중앙으로 들어와 강한 한방', duration:15, level:'hard'},
  {category:'technical', name:'4-shot 패턴 (서브-리턴-3rd-4th)', detail:'서비스 + 리턴 + 3구 어택 + 4구 마무리', duration:20, level:'hard'},
  {category:'technical', name:'1차 서브 와이드 100개', detail:'듀스/애드 코트 와이드 정확도', duration:20, level:'medium'},
  {category:'technical', name:'2차 슬라이스 키커 50개', detail:'안전한 2차, 상대를 박스 밖으로', duration:15, level:'medium'},
  {category:'technical', name:'서브 1+1 (서브 후 즉시 한방)', detail:'서브 → 어택 패턴 자동화', duration:15, level:'hard'},
  {category:'technical', name:'리턴 딥 — 1차 서브 30개', detail:'방어적, 코트 중앙 깊게', duration:10, level:'medium'},
  {category:'technical', name:'리턴 어택 — 2차 서브 30개', detail:'공격적, 코너로 라인 따라', duration:10, level:'hard'},
  {category:'technical', name:'미니 발리 (네트 1.5m, 30개씩 포/백)', detail:'부드러운 컨택, 라켓 면 컨트롤', duration:15, level:'easy'},
  {category:'technical', name:'풀 발리 (네트 5m, 30개씩 포/백)', detail:'네트 앞 적극적 위치 + 짧은 백스윙', duration:15, level:'medium'},
  {category:'technical', name:'하프 발리 (서비스 라인 안)', detail:'바운드 직후 빠른 컨택, 어려움', duration:10, level:'hard'},
  {category:'technical', name:'어프로치 → 1발리 → 스매시', detail:'3단계 콤보, 네트로 전진', duration:15, level:'medium'},
  {category:'technical', name:'스매시 15회 + 회복', detail:'롭 처리 + 풀 스매시', duration:10, level:'medium'},
  // tactical
  {category:'tactical', name:'서브 앤드 발리 패턴', detail:'1차 서브 후 즉시 네트, 양 코트 반복', duration:15, level:'hard'},
  {category:'tactical', name:'네트 점령 게임', detail:'먼저 네트 가는 사람 5포인트 우세', duration:15, level:'medium'},
  {category:'tactical', name:'코너 압박 → 코트 중앙 회수', detail:'와이드 + 와이드 후 인사이드 회수', duration:15, level:'hard'},
  {category:'tactical', name:'디스어드밴티지 게임 (0-30 시작)', detail:'불리한 상태에서 기술적 회복', duration:20, level:'hard'},
  {category:'tactical', name:'컨디셔널 게임 — 서브 와이드 강제', detail:'서브 위치 강제, 패턴 인식', duration:15, level:'medium'},
  {category:'tactical', name:'1구 어택 룰 (3구 안 끝내면 -1)', detail:'어택 마인드셋 강화', duration:20, level:'hard'},
  // match
  {category:'match', name:'5포인트 미니 매치 × 3', detail:'시간 짧고 텐션 학습', duration:15, level:'easy'},
  {category:'match', name:'10포인트 타이브레이커', detail:'시합 전 마무리 게임', duration:15, level:'medium'},
  {category:'match', name:'1세트 풀 시합', detail:'실제 점수, 코트 체인지', duration:40, level:'medium'},
  {category:'match', name:'No-Ad 4게임 우선 매치', detail:'빠른 진행, 결정구 강조', duration:25, level:'medium'},
  {category:'match', name:'프로 8 매치 (8게임 먼저)', detail:'중간 텐션, 실전 페이스', duration:50, level:'hard'},
  // mental
  {category:'mental', name:'호흡 4-7-8 (점수 사이)', detail:'4초 들숨 / 7초 멈춤 / 8초 날숨', duration:5, level:'easy'},
  {category:'mental', name:'이미지 트레이닝 (성공 샷)', detail:'눈 감고 성공한 샷 5번 머리에서 재생', duration:10, level:'easy'},
  {category:'mental', name:'프리포인트 루틴 (3단계)', detail:'끈으로 라켓 → 호흡 → 시각화', duration:5, level:'easy'},
  {category:'mental', name:'실수 후 회복 루틴', detail:'10초 안에 다음 포인트로 리셋', duration:5, level:'medium'},
  // movement
  {category:'movement', name:'사다리 드릴 (퀵 풋 / 인-아웃)', detail:'발 빠르기 + 정확도', duration:10, level:'easy'},
  {category:'movement', name:'5콘 스파이더 드릴', detail:'중앙에서 5방향 콘 터치 후 복귀', duration:10, level:'medium'},
  {category:'movement', name:'사이드라인 셔플 (30초 × 3)', detail:'옆 이동 스피드', duration:10, level:'medium'},
  {category:'movement', name:'스플릿 스텝 + 1샷', detail:'테이크백 직전 스플릿 자세', duration:10, level:'medium'},
  {category:'movement', name:'베이스→네트→베이스 스프린트 (6세트)', detail:'전후 이동 + 회복', duration:10, level:'hard'},
  // strength
  {category:'strength', name:'코어 — 플랭크 60초 × 3', detail:'몸통 안정화', duration:5, level:'medium'},
  {category:'strength', name:'사이드 플랭크 30초 × 3 (양쪽)', detail:'옆 코어', duration:5, level:'medium'},
  {category:'strength', name:'스쿼트 15회 × 3', detail:'하체 파워', duration:10, level:'medium'},
  {category:'strength', name:'런지 10회 × 3 (양다리)', detail:'다리 + 균형', duration:10, level:'medium'},
  {category:'strength', name:'박스 점프 10회 × 3', detail:'폭발력', duration:10, level:'hard'},
  {category:'strength', name:'메디신볼 회전 던지기 10×3', detail:'상체 회전 파워 (서브/포핸드)', duration:10, level:'hard'},
  // conditioning
  {category:'conditioning', name:'1분 라이브 + 30초 회복 (8세트)', detail:'시합 인터벌 시뮬레이션', duration:15, level:'hard'},
  {category:'conditioning', name:'줄넘기 3분 × 3', detail:'발 빠르기 + 심박수', duration:15, level:'easy'},
  {category:'conditioning', name:'400m 트랙 5세트 (회복 90초)', detail:'유산소 + 회복', duration:20, level:'hard'},
  // recovery
  {category:'recovery', name:'정적 스트레칭 풀바디', detail:'각 부위 30초씩', duration:10, level:'easy'},
  {category:'recovery', name:'폼롤러 — 다리 + 등', detail:'근막 이완', duration:10, level:'easy'},
  {category:'recovery', name:'얼음물 발 담그기 5분', detail:'시합 후 회복', duration:5, level:'easy'},
  {category:'recovery', name:'액티브 회복 — 가벼운 조깅 + 스트레칭', detail:'시합 다음날', duration:30, level:'easy'},
  // vision
  {category:'vision', name:'볼 트래킹 — 라벨 읽기', detail:'바운드 시 공의 라벨/숫자 읽기 도전', duration:10, level:'easy'},
  {category:'vision', name:'주변시야 드릴', detail:'중앙 보면서 좌우 콘 색깔 부르기', duration:10, level:'medium'},
  // 베이스라인 (한글 카테고리, 기존 보강)
  {category:'베이스라인', name:'데드라인 75샷 (70%)', detail:'안정성 + 깊이', duration:20, level:'medium'},
  {category:'베이스라인', name:'라이트 크로스 → 헤비 다운라인', detail:'속도/스핀 변화', duration:15, level:'hard'}
];

drills.forEach((d, i) => {
  insertDrill.run(d.category, d.name, d.detail, d.duration, d.level, d.sets||null, d.reps||null, 1000+i);
});
console.log('drills +', drills.length);

// 통계
const t = db.prepare('SELECT COUNT(*) c FROM templates').get().c;
const ex = db.prepare('SELECT COUNT(*) c FROM template_exercises').get().c;
const p = db.prepare('SELECT COUNT(*) c FROM phase_programs').get().c;
const dr = db.prepare('SELECT COUNT(*) c FROM drills').get().c;
console.log('\n총 합계 — templates:'+t+' / exercises:'+ex+' / phases:'+p+' / drills:'+dr);
