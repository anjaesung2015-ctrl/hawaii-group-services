// 각 카테고리 100개씩 채우기 (변형 포함)
const Database = require('better-sqlite3');
const db = new Database('/home/ubuntu/.openclaw/workspace/coach-app/coach.db');

const TARGET = 100;
const insert = db.prepare("INSERT INTO drills (category, name, detail, duration, level, sets, reps, sort_idx, archived) VALUES (?,?,?,?,?,?,?,?,0)");

function pad(category, generator){
  const cur = db.prepare('SELECT COUNT(*) c FROM drills WHERE category=? AND COALESCE(archived,0)=0').get(category).c;
  const need = TARGET - cur;
  if (need <= 0) { console.log(category.padEnd(15), 'already', cur, '— skip'); return; }
  const all = generator();
  // 셔플
  for (let i = all.length-1; i>0; i--) { const j = Math.floor(Math.random()*(i+1)); [all[i],all[j]]=[all[j],all[i]]; }
  const take = all.slice(0, need);
  let added = 0;
  take.forEach((d, i) => {
    insert.run(category, d.name, d.detail||'', d.duration||null, d.level||'medium', d.sets||null, d.reps||null, 5000+i);
    added++;
  });
  console.log(category.padEnd(15), cur, '→', cur+added);
}

// === technical (스트로크 동작 × 강도 × 패턴) ===
pad('technical', () => {
  const out = [];
  const strokes = ['포핸드 크로스코트','포핸드 다운더라인','포핸드 인사이드아웃','포핸드 인사이드인','백핸드 크로스코트','백핸드 다운더라인','슬라이스 백핸드','슬라이스 백핸드 어프로치','탑스핀 백핸드','드롭샷 (포)','드롭샷 (백)','롭 (디펜시브)','롭 (어그레시브)','하이볼 (오버헤드)'];
  const counts = [20,30,50,75,100];
  const pcts = [60,70,80,90];
  strokes.forEach(s => counts.forEach(c => pcts.forEach(p => {
    out.push({name:`${s} ${c}샷 (${p}%)`, detail:'안정성·깊이·각도', duration:Math.max(8,Math.round(c/4)), level:p>=85?'hard':p>=70?'medium':'easy'});
  })));
  // 서브 변형
  ['와이드','T 코너','보디','킥','슬라이스','플랫'].forEach(d => [30,50,75,100].forEach(c => ['1차','2차'].forEach(t => {
    out.push({name:`${t} 서브 ${c}개 (${d})`, detail:`${t} 서브 ${d} 정확도`, duration:Math.round(c/5), level:t==='1차'?'medium':'hard'});
  })));
  // 발리 변형 (technical 안에)
  ['포 발리','백 발리','하프 발리'].forEach(v => [30,50,75].forEach(c => ['미니','풀'].forEach(t => {
    out.push({name:`${t} ${v} ${c}개`, detail:'네트 컨트롤', duration:Math.round(c/4), level:'medium'});
  })));
  return out;
});

// === tactical ===
pad('tactical', () => {
  const out = [];
  const patterns = ['1+1 서브 패턴','서브 앤드 발리','어프로치 → 발리 → 스매시','와이드 → 인사이드아웃','와이드 → 와이드 → 회수','크로스 → 다운라인 전환','드롭샷 → 어프로치','롭 → 베이스라인 회수','첼로 (짧은-긴 교대)','코너 압박 → 어택','수비 → 카운터','중앙 깊이 → 코너 마무리'];
  const opps = ['오른손잡이 vs','왼손잡이 vs','베이스라이너 vs','네트맨 vs','어그레시브 vs','디펜시브 vs','일반 vs'];
  const dur = [10,15,20,25];
  patterns.forEach(p => opps.forEach(o => dur.forEach(d => {
    out.push({name:`${p} (${o.replace(' vs','')})`, detail:`${o} 상대 패턴 적용 ${d}분`, duration:d, level:'hard'});
  })));
  return out;
});

// === match ===
pad('match', () => {
  const out = [];
  const formats = ['미니 매치','타이브레이커','풀 세트','No-Ad 매치','프로 8','프로 10','3세트 베스트','컨디셔날 게임','디스어드밴티지 게임','킹 오브 코트'];
  const points = [3,5,7,10,12,15,21];
  const conds = ['','(서브 와이드 강제)','(2구 안 끝내면 -1)','(슬라이스만)','(드롭샷 1번 필수)','(어프로치 필수)','(타임 제한 5분)','(서브 1번만)','(베이스라인만)','(공격 강제)'];
  formats.forEach(f => points.forEach(p => conds.forEach(c => {
    if (out.length >= 200) return;
    out.push({name:`${f} ${p}포인트 ${c}`.trim(), detail:'실전 조건 + 점수', duration:Math.max(15, p*2), level:'medium'});
  })));
  return out;
});

// === mental ===
pad('mental', () => {
  const out = [];
  const techniques = ['호흡 4-7-8','박스 호흡 (4-4-4-4)','복식 호흡','이미지 트레이닝 (성공샷)','이미지 트레이닝 (시합)','루틴 (포인트 전)','루틴 (서브 전)','루틴 (실수 후)','자기대화 (긍정)','자기대화 (지시문)','마인드풀니스','명상','시각화','집중 게임','타이머 챌린지','감정 라벨링','목표 설정','자신감 빌드업'];
  const times = [3,5,7,10,15,20];
  const ctx = ['시합 전','시합 중','시합 후','훈련 시작','훈련 중','훈련 후','매일 아침','매일 저녁'];
  techniques.forEach(t => times.forEach(m => ctx.forEach(c => {
    if (out.length >= 200) return;
    out.push({name:`${t} ${m}분 (${c})`, detail:`${c} 상황에 적용`, duration:m, level:'easy'});
  })));
  return out;
});

// === movement (풋워크) ===
pad('movement', () => {
  const out = [];
  const ex = ['사다리 드릴 (퀵 풋)','사다리 드릴 (인-아웃)','사다리 드릴 (사이드)','5콘 스파이더','3콘 셔플','콘 8자','베이스 → 네트 스프린트','사이드라인 셔플','크로스 오버 스텝','스플릿 스텝','캐리오카','드롭 스텝','어드저스트먼트 스텝','오픈 스탠스 회복'];
  const sets = [3,4,5,6,8,10];
  const dur = [10,15,20,30];
  ex.forEach(e => sets.forEach(s => dur.forEach(d => {
    if (out.length >= 200) return;
    out.push({name:`${e} (${d}초 × ${s}세트)`, detail:'발 스피드 + 정확도', duration:Math.max(5,Math.round(d*s/60)), level:s>=6?'hard':'medium', sets:s});
  })));
  return out;
});

// === strength ===
pad('strength', () => {
  const out = [];
  const ex = ['플랭크','사이드 플랭크','스쿼트','점프 스쿼트','런지 (양다리)','워킹 런지','데드리프트','풀업','푸시업','버피','싯업','크런치','러시안 트위스트','메디신볼 회전 던지기','케틀벨 스윙','박스 점프','브로드 점프','월 시트'];
  const reps = [10,12,15,20,25];
  const sets = [2,3,4,5];
  ex.forEach(e => reps.forEach(r => sets.forEach(s => {
    if (out.length >= 200) return;
    out.push({name:`${e} ${r}회 × ${s}세트`, detail:'근력 빌드업', duration:Math.max(5,s*2), level:r>=20?'hard':'medium', sets:s, reps:r});
  })));
  return out;
});

// === conditioning ===
pad('conditioning', () => {
  const out = [];
  const types = ['라이브 인터벌','스프린트 셔틀','줄넘기','코트 라인 터치','벌피','트레드밀 인터벌','자전거 인터벌','로잉','마운틴 클라이머','니업','점프잭','셔틀런','계단 오르내리기'];
  const t = [1,2,3,5];
  const sets = [3,4,5,6,8,10];
  const rec = [30,60,90];
  types.forEach(ty => t.forEach(tm => sets.forEach(s => rec.forEach(r => {
    if (out.length >= 200) return;
    out.push({name:`${ty} ${tm}분 × ${s}세트 (회복 ${r}초)`, detail:'심폐 + 인터벌', duration:Math.round(tm*s+r*s/60), level:'hard', sets:s});
  }))));
  return out;
});

// === recovery ===
pad('recovery', () => {
  const out = [];
  const methods = ['정적 스트레칭','폼롤러 (다리)','폼롤러 (등)','얼음물 (발)','얼음물 (전신)','마사지 건','요가','폼롤러 (상체)','액티브 회복 조깅','산책','수면','명상','반신욕','사우나','테이핑','깊은 호흡 회복'];
  const dur = [5,10,15,20,30,45,60];
  const ctx = ['시합 직후','다음 날','부상 회복','훈련 후','평소 루틴','주말 회복','피곤 시'];
  methods.forEach(m => dur.forEach(d => ctx.forEach(c => {
    if (out.length >= 200) return;
    out.push({name:`${m} ${d}분 (${c})`, detail:`${c} 상황 회복`, duration:d, level:'easy'});
  })));
  return out;
});

// === vision ===
pad('vision', () => {
  const out = [];
  const ex = ['볼 트래킹 (라벨 읽기)','볼 트래킹 (숫자 부르기)','주변시야 드릴','색깔 콘 부르기','반응 캐치','테니스볼 저글링 2개','테니스볼 저글링 3개','동안근 운동','초점 전환 (가까이-멀리)','한쪽 눈 가리기','시각 추적 +좌우','시각 추적 +대각선','오버헤드 캐치','반응 패들'];
  const dur = [5,8,10,15,20];
  const sets = [2,3,4,5,6,8];
  ex.forEach(e => dur.forEach(d => sets.forEach(s => {
    if (out.length >= 150) return;
    out.push({name:`${e} ${d}분 × ${s}세트`, detail:'시각 + 반응 + 트래킹', duration:Math.round(d*s/2), level:'medium', sets:s});
  })));
  return out;
});

// === nutrition ===
pad('nutrition', () => {
  const out = [];
  const items = ['수분 (물 500ml)','수분 (이온음료 500ml)','바나나','에너지바','단백질 셰이크','오트밀','계란 + 토스트','파스타 (시합 전)','샐러드 + 닭가슴살','요거트 + 베리','견과류 한줌','고구마','연어 (시합 후)','초콜릿 우유 (회복)','BCAA','크레아틴','비타민 + 미네랄','카페인 (시합 전)','전해질 보충','단백질 30g'];
  const ctx = ['시합 2시간 전','시합 1시간 전','시합 30분 전','시합 직전','시합 중','시합 직후','시합 30분 후','시합 1시간 후','훈련 전','훈련 후','아침','점심','저녁','자기 전','오후 간식'];
  items.forEach(it => ctx.forEach(c => {
    out.push({name:`${it} — ${c}`, detail:`${c} 영양 가이드`, duration:5, level:'easy'});
  }));
  return out;
});

// === 베이스라인 (한글) ===
pad('베이스라인', () => {
  const out = [];
  const types = ['크로스코트 랠리','다운더라인 랠리','대각선 패턴','직선 패턴','와이드 푸시','코너 압박','중앙 깊이','오픈 스탠스','클로즈드 스탠스','뉴트럴 스탠스'];
  const counts = [10,20,30,50,75,100];
  const pcts = [60,70,80,90];
  types.forEach(t => counts.forEach(c => pcts.forEach(p => {
    out.push({name:`${t} ${c}샷 (${p}%)`, detail:'베이스라인 안정성 + 깊이', duration:Math.max(8,Math.round(c/5)), level:p>=85?'hard':'medium'});
  })));
  return out;
});

// === 전환 (한글) ===
pad('전환', () => {
  const out = [];
  const ex = ['수비 → 공격','베이스 → 네트','네트 → 베이스','크로스 → 다운라인','슬라이스 → 탑스핀','롭 → 베이스 회수','드롭샷 → 어프로치','어프로치 → 발리 → 스매시','코너 → 중앙 회수','중앙 → 와이드'];
  const sets = [3,4,5,6,8];
  const dur = [10,15,20];
  ex.forEach(e => sets.forEach(s => dur.forEach(d => {
    out.push({name:`${e} 전환 (${d}분 × ${s}세트)`, detail:'전환 타이밍 + 회복', duration:Math.round(d*s/2), level:'hard', sets:s});
  })));
  return out;
});

// === 서브·리턴 ===
pad('서브·리턴', () => {
  const out = [];
  const types = ['1차 서브 와이드','1차 서브 T','1차 서브 보디','2차 슬라이스','2차 킥 서브','리턴 (1차)','리턴 (2차)','리턴 어택','리턴 디펜시브','블락 리턴','서브 + 1구','리턴 + 1구'];
  const counts = [20,30,50,75,100];
  const courts = ['듀스','애드','양 코트'];
  types.forEach(t => counts.forEach(c => courts.forEach(co => {
    if (out.length >= 200) return;
    out.push({name:`${t} ${c}개 (${co} 코트)`, detail:'정확도 + 패턴', duration:Math.round(c/5), level:'medium'});
  })));
  return out;
});

// === 발리·네트 ===
pad('발리·네트', () => {
  const out = [];
  const ex = ['미니 발리 (포)','미니 발리 (백)','풀 발리 (포)','풀 발리 (백)','하프 발리','드롭 발리','펀치 발리','어프로치 발리','스플릿 + 발리','발리-발리-스매시','오버헤드 스매시','첼린지 발리'];
  const counts = [20,30,50,75];
  const dist = ['네트 1.5m','네트 3m','네트 5m','서비스 라인'];
  ex.forEach(e => counts.forEach(c => dist.forEach(d => {
    if (out.length >= 200) return;
    out.push({name:`${e} ${c}개 (${d})`, detail:'네트 컨트롤', duration:Math.round(c/4), level:'medium'});
  })));
  return out;
});

// === 게임 ===
pad('게임', () => {
  const out = [];
  const types = ['5포인트 매치','7포인트 매치','10포인트 타이브레이커','킹 오브 코트','3대3 라운드','네트 점령 게임','컨디셔날 게임','디스어드밴티지 게임','풀 세트','노 애드 매치','롱-숏 게임','숨바꼭질 (블라인드)'];
  const dur = [10,15,20,30,45];
  const cond = ['','자유','서브 와이드만','베이스라인만','네트 강제','드롭샷 1번 필수','어프로치 필수','슬라이스 강제','시간 제한'];
  types.forEach(t => dur.forEach(d => cond.forEach(c => {
    if (out.length >= 200) return;
    out.push({name:`${t} ${d}분 ${c?'('+c+')':''}`.trim(), detail:'시합 시뮬레이션', duration:d, level:'medium'});
  })));
  return out;
});

// === 체력 (한글) ===
pad('체력', () => {
  const out = [];
  const ex = ['스프린트','셔틀런','계단 오르내리기','자전거','로잉','줄넘기','벌피','마운틴 클라이머','점프 스쿼트','니업','박스 점프','코어 (플랭크 시리즈)','HIIT','리거토니 코트 러닝','인터벌 트랙'];
  const t = [1,2,3,5];
  const sets = [3,4,5,6,8];
  const rec = [30,60,90];
  ex.forEach(e => t.forEach(tm => sets.forEach(s => rec.forEach(r => {
    if (out.length >= 200) return;
    out.push({name:`${e} ${tm}분 × ${s}세트 (회복 ${r}초)`, detail:'체력 + 인터벌', duration:Math.round(tm*s+r*s/60), level:'hard', sets:s});
  }))));
  return out;
});

// === 정확도 ===
pad('정확도', () => {
  const out = [];
  const targets = ['콘 1개 (1m)','콘 2개 (50cm)','콘 3개 (서비스 박스)','베이스라인 3구역','코너 4점','와이드 코너','T 코너','드롭샷 박스','롭 깊이','네트 1m 위'];
  const reps = [10,15,20,30,50];
  const stroke = ['포핸드','백핸드','서브','발리','스매시','드롭샷','롭'];
  targets.forEach(t => reps.forEach(r => stroke.forEach(s => {
    if (out.length >= 200) return;
    out.push({name:`${s} ${t} 타겟 ${r}회`, detail:`${s} 정확도 (${t})`, duration:Math.round(r/3), level:'medium', reps:r});
  })));
  return out;
});

// 결과 통계
console.log('\n=== 최종 카테고리 카운트 ===');
db.prepare("SELECT category, COUNT(*) as c FROM drills WHERE COALESCE(archived,0)=0 GROUP BY category ORDER BY c DESC").all().forEach(r => {
  console.log(' ', r.category.padEnd(15), r.c);
});
console.log('\n총:', db.prepare("SELECT COUNT(*) as c FROM drills WHERE COALESCE(archived,0)=0").get().c);
