# 자연어 일정 입력 (NLP Event Parser) 설계 — 2026-05-06

## 목표
사용자가 한국어 자연어로 적은 일정 ("내일 3시 미팅" 등)을 LLM이 events 테이블 필드로 파싱하고, 미리보기 카드를 보여준 뒤 [확인] 시 추가한다. 단일 사용자(admin/재성).

## 비목표
- 일정 자동 분류 학습/AI 추천 (단순 파싱만)
- 음성 입력
- 기존 일정 자연어 검색 (별개 기능)
- 마일스톤/목표 자연어 입력 (events만)

## 사용자 흐름

1. 「대시보드」 또는 「일정 > 오늘」 화면 상단에 입력바 노출
2. 사용자가 자연어 입력 후 엔터 (또는 [추가] 버튼)
3. 입력바 자리에 로딩 스피너 → 미리보기 카드 표시
4. 미리보기 카드에 파싱 결과 + 3개 버튼: [✓ 확인] [✎ 수정] [✗ 취소]
   - **확인**: `POST /api/events`로 추가 → 카드 사라지고 입력바 복귀, 현재 화면 새로고침
   - **수정**: 기존 일정 추가 모달이 prefill된 상태로 열림 → 사용자가 직접 고친 후 저장
   - **취소**: 카드 사라지고 입력바 복귀 (입력 텍스트 유지하여 재시도 가능)

## 컴포넌트

### 1. 프론트엔드 (`public/index.html`)
- **입력바 위젯**: `loadCalendarToday`의 첫 카드와 `loadDashboard` 상단에 동일하게 삽입. 단일 함수 `renderQuickAdd(targetEl)` 정의.
- **`POST /api/parse-event` 호출 함수** `parseEventText(text)`: 응답을 받아 `renderPreviewCard(parsed)` 호출.
- **미리보기 카드**: title / start_date / end_date / start_time / end_time / category / location / recurring 표시. 누락 필드는 회색 빈 칸 + ⚠️.
- **prefill 모달**: 기존 `openEventModal()` 함수를 확장 — 옵션 인자 `prefillData` 받아 폼에 채워넣음.

### 2. 백엔드 (`server.js`)
- 신규 엔드포인트 `POST /api/parse-event`:
  - body: `{ text: string }` (max 500 chars)
  - auth 미들웨어 적용 (admin only)
  - `child_process.execFile('openclaw', ['agent', '--model', 'anthropic/claude-haiku-4-5', '--prompt', PROMPT], { timeout: 12000 })` 호출
  - PROMPT는 시스템 명령 + 오늘 날짜 + 사용자 텍스트 결합 (아래 4번 참조)
  - LLM 응답 stdout에서 첫 JSON 블록 추출 → 검증 → 클라이언트로 반환
  - 응답 형태: `{ ok: true, parsed: {title, start_date, end_date, start_time, end_time, all_day, category, location, recurring, confidence}, raw: string }` 또는 `{ ok: false, error: string }`

### 3. LLM 호출 메커니즘
- **방법**: `openclaw agent --model anthropic/claude-haiku-4-5 --prompt "..."` 를 child_process로 실행
- 검증 단계: 구현 시 `ssh ... "openclaw agent --help"` 로 실제 인자 형태 확인. 만약 `--prompt` 가 없거나 stdin 방식이면 `spawn` + stdin 사용.
- **Fallback**: openclaw 실행 실패 시 (exit code != 0) → 클라이언트에 `{ok:false}` 반환 → 사용자에게 "이해 못했어요" 메시지 + 기존 ➕ 모달 열기

### 4. 시스템 프롬프트 (요약)
```
당신은 한국어 일정 파서입니다. 사용자 입력을 분석해 JSON으로만 응답하세요.

오늘 날짜: {YYYY-MM-DD} ({요일})
타임존: Asia/Ulaanbaatar (UTC+8)

출력 필드:
- title (string, 필수)
- start_date (YYYY-MM-DD, 필수)
- end_date (YYYY-MM-DD, 단일 날짜면 start_date와 같게)
- start_time (HH:MM 24h, 종일이면 null)
- end_time (HH:MM 24h, 미지정이면 null)
- all_day (boolean)
- category (work | personal | health | study | family | meeting 중 추정)
- location (string, 미지정이면 "")
- recurring (null | weekly | daily | monthly)
- confidence (0~1)

규칙:
- "오늘/내일/모레/글피"는 오늘 날짜 기준 계산
- "다음주 X요일"은 다음 발생일
- "오전/오후"는 12시간제로 해석
- 시간 누락 시 all_day=true
- 모호하면 confidence를 0.5 미만으로
- JSON 외 다른 텍스트 절대 출력 금지
```

### 5. 보안/검증
- 클라이언트 입력 길이 500자 제한
- 응답 JSON 파싱 실패 시 `{ok:false, error:'parse_failed'}` 반환
- 날짜 형식이 YYYY-MM-DD 패턴과 안 맞으면 거절
- `openclaw agent` 명령에 user input을 직접 prompt 인자로 넣을 때 shell injection 방지 — `execFile`(spawn) 사용해 인자 분리

## 데이터 흐름
```
사용자 입력
  → fetch('/api/parse-event', {text})
  → server: child_process.execFile('openclaw', ['agent', '--model', 'haiku', '--prompt', SYS+text])
  → openclaw → Claude Haiku → JSON 응답
  → server: JSON 추출 + 검증
  → 클라이언트: 미리보기 카드
  → [확인] → fetch('/api/events', {parsed fields})
  → 기존 일정 저장 흐름
```

## 테스트 시나리오 (수동)
| 입력 | 기대 |
|------|------|
| "내일 3시 미팅" | start_date=오늘+1, start_time=15:00, title=미팅, all_day=false |
| "오늘 종일 휴가" | start_date=오늘, all_day=true, title=휴가 |
| "5월 10일 점심 약속" | start_date=2026-05-10, start_time≈12:00, title=점심 약속 |
| "다음주 화요일 10시 치과" | start_date=다음 화요일, start_time=10:00 |
| "매주 월 9시 회의" | recurring=weekly, start_time=09:00 |
| "ㅁㄴㅇㄹ" (의미없음) | confidence<0.5 → 미리보기에 ⚠️ 표시, 수정 권장 |

## 위험/한계
- LLM 호출 1~5초 지연 → 로딩 스피너 필수
- Haiku 가벼운 모델이라 복잡한 한국어("그저께 그 사람이랑 했던 거 다음번에 또") 부정확 가능 → 미리보기 카드로 사용자 확인이 안전장치
- openclaw CLI 동작 방식이 버전마다 다를 수 있음 → 구현 시 실제 동작 검증 필요
- 비용: Haiku 1건당 ~0.0005달러, 게이트웨이 통해 호출. 일 100건 가정 시 월 $1.5 미만

## 롤아웃
1. dev 환경 없음. EC2 직접 배포 (단일 admin 사용자라 OK)
2. server.js 백업 → 신규 엔드포인트 추가 → pm2 reload
3. index.html 백업 → 입력바 + 미리보기 카드 추가 → 정적 자산이라 reload 불필요
4. 1~2일 사용 후 정확도 확인. 부정확하면 시스템 프롬프트 튜닝 또는 모델을 sonnet으로 승격

## 관련
- 기존 `POST /api/events` 엔드포인트 (server.js:204-209) 그대로 사용
- 기존 `openEventModal(id, date)` 함수 확장 (3번째 인자 `prefillData`)
