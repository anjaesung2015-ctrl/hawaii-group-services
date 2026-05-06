# Schedule-Manager UX 단순화 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사이드바 4개는 그대로 두되, 「일정」 메뉴 안에 [오늘][주간][월간][연간][타임라인] 5개 뷰 토글을 넣어 숨어있던 화면을 모두 도달 가능하게 만든다. 모바일은 하단 탭바.

**Architecture:** 단일 `public/index.html` SPA. 9개 `sec-*` 컨테이너 중 `sec-weekly/year/calendar/timeblock/timenote/timeline` 6개를 `sec-calendar`의 자식 sub-view로 통합. `showSec(name, sub)` 라우터에 sub-view 인자 추가. URL hash 형식 `#calendar/today`. API와 DB는 손대지 않는다.

**Tech Stack:** Vanilla JS (no framework), Express + better-sqlite3 백엔드(미수정), single-file HTML, pm2.

**작업 환경:** EC2 `/home/ubuntu/.openclaw/workspace/schedule-manager/`. 모든 명령은 SSH 접속 후 실행:
```
ssh -i ~/eunice-key.pem ubuntu@3.93.96.130
```

**테스트 메모:** 기존 자동 테스트 인프라가 없는 SPA이므로, 각 태스크마다 (a) Node syntax check (b) 브라우저 수동 점검 (c) 콘솔 에러 0 — 이 3가지로 검증한다.

---

## 파일 구조

| 파일 | 책임 | 변경 |
|------|------|------|
| `public/index.html` | UI/JS 전체 | 수정 (탭바 추가, 라우터 확장, [오늘] 통합 뷰) |
| `public/index.html.bak-uxsimplify-20260505` | 롤백용 백업 | 신규 (Task 1) |
| `public/index.html.bak-simplify-20260502-013627` | 오래된 백업 | 삭제 (Task 1) |
| `server.js` | API | 변경 없음 |
| `schedule.db` | DB | 변경 없음 |

---

## Task 1: 백업 + 오래된 백업 정리

**Files:**
- Create: `public/index.html.bak-uxsimplify-20260505`
- Delete: `public/index.html.bak-simplify-20260502-013627`

- [ ] **Step 1.1: 작업용 백업 생성**

```
cd /home/ubuntu/.openclaw/workspace/schedule-manager
cp public/index.html public/index.html.bak-uxsimplify-20260505
ls -la public/index.html*
```
Expected: 두 파일 모두 표시됨 (원본 + 새 백업).

- [ ] **Step 1.2: 오래된 백업 삭제**

```
rm public/index.html.bak-simplify-20260502-013627
ls public/*.bak* 2>/dev/null || echo 'no other bak files'
```
Expected: 새 백업만 남음.

- [ ] **Step 1.3: 커밋 (git 사용 중이면)**

```
cd /home/ubuntu/.openclaw/workspace/schedule-manager && git status 2>&1 | head -3
```
git 저장소면 `git add -A && git commit -m 'chore: cleanup old backup, add work backup'`. 아니면 스킵.

---

## Task 2: 라우터 확장 — sub-view 지원

기존 `showSec(name)`에 두 번째 인자 `sub`를 추가하고, URL hash `#calendar/week` 파싱 지원.

**Files:**
- Modify: `public/index.html:148-155` (showSec 함수)
- Modify: `public/index.html:1169-1170` (popstate + hash 초기 처리)

- [ ] **Step 2.1: 현재 showSec 라인 확인**

```
sed -n '148,156p' public/index.html
```
Expected: 현재 `function showSec(n,noPush){...}` 정의가 보임.

- [ ] **Step 2.2: showSec를 sub-view 지원 형태로 교체**

기존 (148-156)을 다음 코드로 교체:

```javascript
const CAL_SUBS = ['today','week','month','year','timeline'];
function showSec(n, sub, noPush){
  if(n==='calendar' && !sub) sub = 'today';
  const hash = (n==='calendar') ? ('calendar/'+sub) : n;
  if(!noPush && hash !== _curSec) history.pushState({sec:n, sub:sub}, '', '#'+hash);
  _curSec = hash;
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(s=>s.classList.remove('active'));
  document.getElementById('sec-'+n)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(item=>{
    var oc=item.getAttribute('onclick')||'';
    if(oc.indexOf("showSec('"+n+"')")>=0) item.classList.add('active');
  });
  try{
    if(n==='calendar'){ loadCalendarSub(sub); }
    else { ({dashboard:loadDashboard, milestones:loadMilestones, goals:loadGoals})[n]?.(); }
  }catch(e){ console.error(n+' error:', e); }
}
function loadCalendarSub(sub){
  if(!CAL_SUBS.includes(sub)) sub = 'today';
  document.querySelectorAll('#sec-calendar .cal-sub').forEach(el=>el.classList.remove('active'));
  document.getElementById('cal-sub-'+sub)?.classList.add('active');
  document.querySelectorAll('#sec-calendar .cal-tab').forEach(t=>t.classList.toggle('active', t.dataset.sub===sub));
  ({today:loadCalendarToday, week:loadWeekly, month:loadCalendar, year:loadYear, timeline:loadTimeline})[sub]?.();
}
```

- [ ] **Step 2.3: popstate + hash 초기 처리 강화**

기존 (1169-1170 두 줄):
```javascript
window.addEventListener('popstate',e=>{if(e.state&&e.state.sec)showSec(e.state.sec,true);else showSec('dashboard',true);});
if(location.hash){const h=location.hash.slice(1);if(h)setTimeout(()=>showSec(h,true),100);}
```

신규로 교체:
```javascript
window.addEventListener('popstate', e=>{
  if(e.state && e.state.sec) showSec(e.state.sec, e.state.sub, true);
  else showSec('dashboard', null, true);
});
if(location.hash){
  const h = location.hash.slice(1);
  if(h){ const [main, sub] = h.split('/'); setTimeout(()=>showSec(main, sub, true), 100); }
}
```

- [ ] **Step 2.4: showApp 첫 진입 동작 확인 (변경 불필요)**

```
sed -n '136p' public/index.html
```
첫 화면이 `loadDashboard()` 호출이라 그대로 OK.

- [ ] **Step 2.5: Node syntax check**

```
node -e "const fs=require('fs'); const html=fs.readFileSync('public/index.html','utf8'); const m=html.match(/<script>([\s\S]*?)<\/script>/); new Function(m[1]); console.log('JS OK');"
```
Expected: `JS OK`. 에러 시 신규 코드 오타 점검.

---

## Task 3: 「일정」 안에 뷰 토글 UI 추가

`#sec-calendar` 안에 탭바 + 5개 자식 컨테이너를 만들고, 기존 `#sec-weekly/year/timeblock/timenote/timeline` 5개 컨테이너 div를 제거. 5개 자식 컨테이너로 대체.

**Files:**
- Modify: `public/index.html:103-111` (section 컨테이너 묶음)
- Modify: `public/index.html` (style 블록)

- [ ] **Step 3.1: section 컨테이너 묶음 교체**

기존 (103-111)을 신규로 교체:

신규:
```html
    <div class="section active" id="sec-dashboard"></div>
    <div class="section" id="sec-calendar">
      <div class="cal-tabs">
        <div class="cal-tab active" data-sub="today"    onclick="showSec('calendar','today')">📍 오늘</div>
        <div class="cal-tab"        data-sub="week"     onclick="showSec('calendar','week')">📆 주간</div>
        <div class="cal-tab"        data-sub="month"    onclick="showSec('calendar','month')">🗓️ 월간</div>
        <div class="cal-tab"        data-sub="year"     onclick="showSec('calendar','year')">📅 연간</div>
        <div class="cal-tab"        data-sub="timeline" onclick="showSec('calendar','timeline')">📜 타임라인</div>
      </div>
      <div class="cal-sub active" id="cal-sub-today"></div>
      <div class="cal-sub"        id="cal-sub-week"></div>
      <div class="cal-sub"        id="cal-sub-month"></div>
      <div class="cal-sub"        id="cal-sub-year"></div>
      <div class="cal-sub"        id="cal-sub-timeline"></div>
    </div>
    <div class="section" id="sec-milestones"></div>
    <div class="section" id="sec-goals"></div>
```

→ 결과: 기존 `sec-weekly/year/timeblock/timenote/timeline` 5개 컨테이너 div가 제거됨.

- [ ] **Step 3.2: CSS 추가 (탭바 스타일)**

`<style>` 블록 끝(`</style>` 직전)에 추가:
```css
.cal-tabs{display:flex;gap:0;overflow-x:auto;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:0.8rem;-webkit-overflow-scrolling:touch}
.cal-tab{padding:0.6rem 0.9rem;font-size:0.85rem;white-space:nowrap;cursor:pointer;color:var(--text2);border-bottom:2px solid transparent;transition:all 0.15s}
.cal-tab:hover{color:var(--text)}
.cal-tab.active{color:var(--primary);border-color:var(--primary);font-weight:600}
.cal-sub{display:none}
.cal-sub.active{display:block}
```

- [ ] **Step 3.3: 기존 load함수의 출력 대상 변경**

기존 함수들이 직접 sec-* 컨테이너에 innerHTML을 쓴다. 자식 컨테이너로 ID만 변경.

위치 확인:
```
grep -n "getElementById('sec-weekly')" public/index.html
grep -n "getElementById('sec-year')"   public/index.html
grep -n "getElementById('sec-calendar')" public/index.html
grep -n "getElementById('sec-timeline')" public/index.html
```

각각 변경 (sed로 일괄 치환):
```
sed -i "s/getElementById('sec-weekly')/getElementById('cal-sub-week')/g" public/index.html
sed -i "s/getElementById('sec-year')/getElementById('cal-sub-year')/g" public/index.html
sed -i "s/getElementById('sec-timeline')/getElementById('cal-sub-timeline')/g" public/index.html
```

⚠️ `sec-calendar`는 자식 컨테이너(cal-sub-month)로 바꿔야 하지만 일괄 치환은 위험 (다른 곳에서도 sec-calendar 참조 가능). 수동으로 각 위치 확인 후:
```
grep -n "getElementById('sec-calendar')" public/index.html
```
모달 close 후 reload 분기(Task 3.4)에서 처리하는 부분 외의 `getElementById('sec-calendar').innerHTML = ...` 같은 출력 위치만 `cal-sub-month`로 변경.

- [ ] **Step 3.4: 모달 close 후 reload 분기 수정 (1153-1165 부근)**

기존 패턴 (3곳 동일):
```javascript
if(active?.id==='sec-weekly')loadWeekly();else if(active?.id==='sec-year')loadYear();else if(active?.id==='sec-calendar')loadCalendar();else if(active?.id==='sec-timeline')loadTimeline();else loadDashboard();
```

신규로 교체 (3곳 모두):
```javascript
if(active?.id==='sec-calendar'){ loadCalendarSub((_curSec.split('/')[1])||'today'); }
else if(active?.id==='sec-milestones') loadMilestones();
else if(active?.id==='sec-goals') loadGoals();
else loadDashboard();
```

위치 확인:
```
grep -n "active?.id==='sec-weekly'" public/index.html
```

- [ ] **Step 3.5: 사이드바 일정 클릭 동작 확인 (변경 불필요)**

기존 line 98:
```html
<div class="nav-item" onclick="showSec('calendar')">...</div>
```
`showSec('calendar')` → Task 2.2에서 sub 미지정시 `today`로 자동 처리됨.

- [ ] **Step 3.6: Node syntax check**

```
node -e "const fs=require('fs'); const html=fs.readFileSync('public/index.html','utf8'); const m=html.match(/<script>([\s\S]*?)<\/script>/); new Function(m[1]); console.log('JS OK');"
```

---

## Task 4: 「오늘」 통합 화면 (loadCalendarToday)

[오늘] 탭은 그날 일정 + timeblock(시간 계획) + timenote(회고)를 한 페이지에 세로로.

**범위 한정:** 이 Task는 **읽기 전용**. 일지 입력/타임블록 편집 UI는 후속 작업(현재 timenote 사용량 2건으로 낮은 우선순위). 기존 `loadTimeblock`/`loadTimenote` 함수 본문은 그대로 두되 라우터에서 더 이상 호출되지 않음 — 후속 정리 작업에서 제거 예정.

**Files:**
- Modify: `public/index.html` (loadDashboard 정의 line 158 위에 추가)

- [ ] **Step 4.1: time-notes 응답 형태 확인**

```
sed -n '272,302p' /home/ubuntu/.openclaw/workspace/schedule-manager/server.js
```
응답이 배열인지 단일 객체인지 확인 → 다음 단계 코드 조정.

- [ ] **Step 4.2: loadCalendarToday 함수 추가**

`async function loadDashboard(){` (line 158) 직전에 추가:

```javascript
async function loadCalendarToday(){
  const today = todayUB();
  const target = document.getElementById('cal-sub-today');
  if(!target) return;
  target.innerHTML = '<div style="text-align:center;color:var(--text2);padding:2rem">로딩중...</div>';
  try{
    const [dash, blocks, notesRaw] = await Promise.all([
      apiFetch('/api/dashboard').then(r=>r.json()),
      apiFetch('/api/timeblocks?date='+today).then(r=>r.ok?r.json():[]).catch(()=>[]),
      apiFetch('/api/time-notes?date='+today).then(r=>r.ok?r.json():null).catch(()=>null)
    ]);
    const notes = Array.isArray(notesRaw) ? (notesRaw.find(n=>n.note_date===today)||null) : notesRaw;
    const todays = (dash.upcoming||[]).filter(e=> e.start_date<=today && (e.end_date||e.start_date)>=today);
    const active = dash.active||[];
    const all = [...active, ...todays];
    target.innerHTML = `
      <h2 style="margin-bottom:0.8rem">📍 오늘 ${today}</h2>
      <div class="card">
        <h3 style="font-size:0.95rem;margin-bottom:0.5rem">📌 오늘 일정 (${all.length})</h3>
        ${all.map(e=>`
          <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.85rem">
            <span style="font-size:1.1rem">${CAT_ICONS[e.category]||'📌'}</span>
            <span style="background:${e.color||CAT_COLORS[e.category]||'#666'};width:8px;height:8px;border-radius:50%"></span>
            <strong style="flex:1;cursor:pointer" onclick="openEventDetail(${e.id})">${e.title}</strong>
            <span style="color:var(--text2);font-size:0.78rem">${e.location||''}</span>
          </div>`).join('') || '<p style="color:var(--text2);text-align:center">오늘 일정 없음</p>'}
      </div>
      <div class="card">
        <h3 style="font-size:0.95rem;margin-bottom:0.5rem;display:flex;justify-content:space-between">
          ⏱️ 시간 계획
          <button class="btn btn-sm" onclick="showSec('calendar','week')">주간으로 →</button>
        </h3>
        ${(blocks||[]).length ? blocks.map(b=>`
          <div style="display:flex;gap:0.5rem;padding:0.3rem 0;font-size:0.85rem">
            <span style="color:var(--primary);font-weight:600;min-width:80px">${b.start_time||''}-${b.end_time||''}</span>
            <span style="flex:1">${b.title||b.activity||''}</span>
          </div>`).join('') : '<p style="color:var(--text2);text-align:center">시간 블록 없음 (주간 탭에서 추가)</p>'}
      </div>
      <div class="card">
        <h3 style="font-size:0.95rem;margin-bottom:0.5rem">📓 오늘 일지</h3>
        ${notes ? `
          <div style="font-size:0.85rem;line-height:1.7">
            <div><strong>계획:</strong> ${notes.planned||'<span style=\"color:var(--text2)\">없음</span>'}</div>
            <div><strong>실제:</strong> ${notes.actual||'<span style=\"color:var(--text2)\">없음</span>'}</div>
            <div><strong>오늘 점수:</strong> ${notes.score||0} / 10  ${notes.mood||''}</div>
            <div style="margin-top:0.5rem"><strong>잘한 점:</strong> ${notes.wins||'-'}</div>
            <div><strong>개선:</strong> ${notes.improvements||'-'}</div>
            <div><strong>내일:</strong> ${notes.tomorrow||'-'}</div>
          </div>` : '<p style="color:var(--text2);text-align:center">오늘 일지 없음</p>'}
      </div>`;
  }catch(err){
    console.error('loadCalendarToday error:', err);
    target.innerHTML = '<p style="color:var(--danger);text-align:center;padding:2rem">로딩 실패</p>';
  }
}
```

- [ ] **Step 4.3: Node syntax check**

```
node -e "const fs=require('fs'); const html=fs.readFileSync('public/index.html','utf8'); const m=html.match(/<script>([\s\S]*?)<\/script>/); new Function(m[1]); console.log('JS OK');"
```

---

## Task 5: 모바일 하단 탭바 CSS

폭 768px 이하에서 좌측 사이드바를 하단 가로 탭바로 변경.

**Files:**
- Modify: `public/index.html` (`<style>` 블록)

- [ ] **Step 5.1: 사이드바 셀렉터 확인**

```
grep -n 'class="sidebar' public/index.html | head -3
```
실제 클래스명 확인 (`.sidebar` 인지 다른 이름인지).

- [ ] **Step 5.2: 미디어쿼리 추가**

`<style>` 블록 끝(`</style>` 직전)에 추가:
```css
@media (max-width: 768px) {
  .sidebar {
    position: fixed; left: 0; right: 0; bottom: 0; top: auto;
    width: 100%; height: 60px;
    flex-direction: row; justify-content: space-around; align-items: center;
    border-top: 1px solid rgba(255,255,255,0.08); border-right: none;
    overflow-x: auto; padding: 0; z-index: 99;
    background: var(--card);
  }
  .sidebar > a, .sidebar > div { font-size: 0.7rem; padding: 0.4rem 0.5rem; flex: 1; text-align: center; }
  .sidebar i { display: block; font-size: 1rem; margin-bottom: 2px; }
  .content { padding-bottom: 76px; max-width: 100%; }
  #fab-btn { bottom: 76px !important; }
}
```

⚠️ Step 5.1에서 확인한 실제 셀렉터로 `.sidebar`를 치환.

- [ ] **Step 5.3: 모바일 폭 시각 점검**

브라우저 개발자 도구로 폭 375px (iPhone) 시뮬레이션:
- 사이드바가 하단으로 이동
- 콘텐츠 마지막 줄이 가려지지 않음
- FAB(+) 버튼이 하단탭바 위에 위치

---

## Task 6: 배포 + 수동 검증

- [ ] **Step 6.1: pm2 재시작**

```
pm2 restart schedule-manager
pm2 status schedule-manager
```
Expected: status `online`, restart count 증가.

- [ ] **Step 6.2: 서버 응답 확인**

```
curl -sI http://localhost:6007/ | head -5
```
Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 6.3: 브라우저 데스크톱 체크리스트**

`https://app.hawaiigroup.co/schedule-manager/` 에 admin 로그인 후:
- [ ] 사이드바 4개 메뉴 보임 (대시보드, 일정, 마일스톤, 목표)
- [ ] 「일정」 클릭 → [오늘] 탭 활성, URL `#calendar/today`
- [ ] [오늘] 탭에 "오늘 일정 / 시간 계획 / 오늘 일지" 카드 3개
- [ ] [주간] 클릭 → URL `#calendar/week`, 7일 가로 보임
- [ ] [월간] 클릭 → 월간 달력 격자
- [ ] [연간] 클릭 → 12개월 그리드
- [ ] [타임라인] 클릭 → 시간순 일정 리스트
- [ ] 새로고침(F5) 후 마지막 탭 그대로 유지
- [ ] 뒤로가기 정상 동작
- [ ] 우하단 `+` 버튼 모든 화면에서 보임, 클릭 시 일정 추가 모달
- [ ] 일정 추가 후 모달 닫히면 현재 탭 자동 새로고침
- [ ] 콘솔 에러 0개

- [ ] **Step 6.4: 브라우저 모바일 체크리스트 (개발자도구 375px)**

- [ ] 사이드바가 화면 하단 가로 탭바로 변경
- [ ] 콘텐츠 마지막 줄이 탭바에 가리지 않음
- [ ] FAB(+) 버튼이 탭바 위에 위치
- [ ] [오늘][주간][월간][연간][타임라인] 가로 스크롤로 모두 접근

- [ ] **Step 6.5: 데이터 무결성 확인**

```
node -e "const db=require('better-sqlite3')('schedule.db'); console.log('events:', db.prepare('SELECT COUNT(*) c FROM events').get().c); console.log('milestones:', db.prepare('SELECT COUNT(*) c FROM milestones').get().c); console.log('goals:', db.prepare('SELECT COUNT(*) c FROM goals').get().c);"
```
Expected: events: ~592, milestones: ~35, goals: ~29.

- [ ] **Step 6.6: 롤백 절차 (문제 발생 시에만)**

```
cd /home/ubuntu/.openclaw/workspace/schedule-manager
cp public/index.html.bak-uxsimplify-20260505 public/index.html
pm2 restart schedule-manager
```

- [ ] **Step 6.7: 사용자 확인 후 백업 정리**

재성님께 동작 OK 받으면:
```
rm public/index.html.bak-uxsimplify-20260505
```

---

## 완료 기준

- 사이드바 4개, 「일정」 안에 [오늘][주간][월간][연간][타임라인] 5개 탭 동작
- URL hash로 sub-view 유지
- [오늘] 탭에 일정+timeblock+timenote 통합 표시
- 모바일에서 하단 탭바
- 콘솔 에러 0
- DB row count 변화 없음
- 사용자 OK
