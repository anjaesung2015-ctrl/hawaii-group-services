// 마스터 시드 데이터 — server.js에서 require해서 사용

// === 4단계 × 6요일 프로그램 ===
// blocks 형식: [{time, name, detail}]
const PHASE_PROGRAMS = {
  club: {
    label: '동호인 2시간 (화/목)',
    color: '#8b5cf6',
    days: {} // DB에 직접 저장됨
  },
  practice_b: {
    label: '연습기 - 초급',
    color: '#10b981',
    days: {} // DB에 직접 저장됨
  },
  practice_i: {
    label: '연습기 - 중급',
    color: '#f59e0b',
    days: {} // DB에 직접 저장됨
  },
  practice_a: {
    label: '연습기 - 상급',
    color: '#ef4444',
    days: {} // DB에 직접 저장됨
  },
  practice: { // 연습기 (시합 없을 때)
    label: '연습기 (시합 없을 때)',
    color: '#3b82f6',
    days: {
      1: { title: '기본기 + 폼교정 + 스탭', blocks: [
        {time:'15분', name:'웜업', detail:'스트레칭 + 밴드 + 짧은 볼 컨트롤'},
        {time:'45분', name:'베이스라인 안정성 + 깊이', detail:'60% 스윙으로 안정성 우선'},
        {time:'45분', name:'자세 교정', detail:'골반 회전 / 체중 이동 / 라켓 면'},
        {time:'30분', name:'스탭 훈련', detail:'사이드스텝 / 캐리오카 / 오픈스탠스 전환'},
        {time:'30분', name:'서브 마무리', detail:'퍼스트 + 세컨드 — T존 타겟'}
      ]},
      2: { title: '코트 리커버리', blocks: [
        {time:'15분', name:'웜업', detail:'스트레칭 + 푸쉬업 + 스쿼트'},
        {time:'45분', name:'좌우 리커버리', detail:'사이드 라인 → 센터'},
        {time:'45분', name:'앞뒤 리커버리', detail:'베이스라인 ↔ 서비스라인'},
        {time:'30분', name:'4코너 콘 돌기', detail:'정확한 풋워크로 4코너 순환'},
        {time:'30분', name:'서브 마무리', detail:'와이드 타겟'}
      ]},
      3: { title: '수비→공격 / 공격→네트 전환', blocks: [
        {time:'15분', name:'웜업', detail:'스트레칭 + 짧은 랠리'},
        {time:'60분', name:'수비 위치 → 어프로치 → 발리', detail:'베이스라인 뒤 → 깊은 볼 → 전진'},
        {time:'45분', name:'짧은 볼 처리 → 네트 → 마무리', detail:'발리 또는 스매시로 마무리'},
        {time:'30분', name:'공수전환 패턴', detail:'앞크로스/뒤일자 / 앞일자/뒤크로스'},
        {time:'30분', name:'서브 + 점프', detail:'점프 강조'}
      ]},
      4: { title: '네트 플레이', blocks: [
        {time:'15분', name:'웜업', detail:'스트레칭'},
        {time:'45분', name:'발리 분리 훈련', detail:'로우 / 미들 / 하이 발리'},
        {time:'45분', name:'어드밴스 + 드라이브 발리', detail:''},
        {time:'30분', name:'발리-발리 랠리 + 포칭', detail:'양쪽 모두'},
        {time:'30분', name:'스매시', detail:'오버헤드 + 점프 스매시'},
        {time:'30분', name:'서브 + 발리 콤비', detail:'서브 앤드 발리'}
      ]},
      5: { title: '랠리 감각', blocks: [
        {time:'15분', name:'웜업', detail:''},
        {time:'45분', name:'100개 랠리', detail:'60% 깊게, 힘있게'},
        {time:'45분', name:'크로스 랠리', detail:'포 vs 포 / 백 vs 백'},
        {time:'30분', name:'2:1 랠리', detail:'한 명 다운더라인, 한 명 크로스 런닝스트록'},
        {time:'30분', name:'라이징볼 + 인사이드 아웃 포핸드', detail:''},
        {time:'30분', name:'서브 + 리턴', detail:'마무리'}
      ]},
      6: { title: '게임', blocks: [
        {time:'15분', name:'웜업', detail:'스트레칭 + 프리 랠리'},
        {time:'2시간 30분', name:'단식 / 복식 게임', detail:'코트 로테이션'},
        {time:'15분', name:'마무리', detail:'서브 + 정리 스트레칭'}
      ]}
    }
  },
  inseason: { // 시즌 중
    label: '시즌 중',
    color: '#f59e0b',
    days: {
      1: { title: '기본기 종합', blocks: [
        {time:'30분', name:'랠리'},
        {time:'30분', name:'발리'},
        {time:'30분', name:'서브'},
        {time:'30분', name:'리턴'},
        {time:'30분', name:'마무리 게임'},
        {time:'30분', name:'서브 마무리'}
      ]},
      2: { title: '랠리 + 뛰는 훈련', blocks: [
        {time:'45분', name:'런닝 스트록', detail:'좌우 풀가동'},
        {time:'45분', name:'2:1 랠리', detail:'한 명 빠르게 움직이며 처리'},
        {time:'45분', name:'코스별 런닝', detail:'다운더라인/크로스 코스 지정'},
        {time:'30분', name:'서브 마무리'}
      ]},
      3: { title: '전술 랠리', blocks: [
        {time:'45분', name:'패턴 드릴', detail:'첫 볼 크로스 / 두 번째 다운더라인'},
        {time:'45분', name:'인사이드 아웃 포핸드'},
        {time:'45분', name:'어프로치 → 발리 마무리'},
        {time:'30분', name:'서브 + 리턴'}
      ]},
      4: { title: '단식 게임', blocks: [
        {time:'30분', name:'웜업 + 프리 랠리'},
        {time:'1시간 30분', name:'단식 포인트 게임', detail:'1포인트 단판 또는 3포인트 승자제'},
        {time:'30분', name:'반코트 게임', detail:'포핸드/백핸드 사이드 분리'},
        {time:'30분', name:'서브 마무리'}
      ]},
      5: { title: '복식 게임', blocks: [
        {time:'15분', name:'웜업'},
        {time:'30분', name:'발리 포지셔닝'},
        {time:'1시간 15분', name:'2 vs 2 복식 포인트 게임'},
        {time:'30분', name:'전술 미션 게임', detail:'첫 볼 크로스, 두 번째 다운더라인 등'},
        {time:'30분', name:'서브 마무리'}
      ]},
      6: { title: '전술 포인트 + 특수 기술', blocks: [
        {time:'1시간 30분', name:'평소 안하는 훈련', detail:'슬라이스 / 숏트 처리 / 패싱샷 / 드롭샷 / 로브'},
        {time:'1시간 30분', name:'전술 포인트 게임'}
      ]}
    }
  },
  winter: { // 동계훈련 (집중 강화기)
    label: '동계 훈련',
    color: '#8b5cf6',
    days: {
      1: { title: '오전 트레이닝 + 오후 (월)', blocks: [
        {time:'10:00-12:00', name:'오전: 트레이닝', detail:'지구력 / 순발력 / 민첩성 / 파워 — 코트 안 움직임, 계단, 트랙, 코어'},
        {time:'14:30-18:00', name:'오후 A조 (실전)', detail:'안정성 + 공의 깊이 / 100개 랠리'},
        {time:'14:30-18:00', name:'오후 B조 (연습구)', detail:'베이스라인 안정성 + 깊이 + 코스 (시작 30분 서브 필수)'}
      ]},
      2: { title: '오전 트레이닝 + 오후 (화)', blocks: [
        {time:'10:00-12:00', name:'오전: 트레이닝'},
        {time:'14:30-18:00', name:'오후 A조 (실전)', detail:'움직임 + 코스 나누기 / 2:1 랠리 (한 명 다운더라인, 한 명 크로스 런닝)'},
        {time:'14:30-18:00', name:'오후 B조 (연습구)', detail:'좌/우/앞/뒤 움직임 — 수비에서 공격 전환'}
      ]},
      3: { title: '오전 트레이닝 + 오후 (수)', blocks: [
        {time:'10:00-12:00', name:'오전: 트레이닝'},
        {time:'14:30-18:00', name:'오후 A조 (실전)', detail:'앞-뒤 전환 / 찬스볼·짧은볼에 이은 발리'},
        {time:'14:30-18:00', name:'오후 B조 (연습구)', detail:'어프로치 + 발리 + 스매싱'}
      ]},
      4: { title: '오전 트레이닝 + 오후 (목)', blocks: [
        {time:'10:00-12:00', name:'오전: 트레이닝'},
        {time:'14:30-18:00', name:'오후 A조 (실전)', detail:'포인트 게임 + 감각 훈련'},
        {time:'14:30-18:00', name:'오후 B조 (연습구)', detail:'베이스라인 → 네트 전환 패턴 드릴'}
      ]},
      5: { title: '오전 트레이닝 + 오후 (금)', blocks: [
        {time:'10:00-12:00', name:'오전: 트레이닝'},
        {time:'14:30-18:00', name:'오후 A조 (실전)', detail:'단식'},
        {time:'14:30-18:00', name:'오후 B조 (연습구)', detail:'랠리'}
      ]},
      6: { title: '오전 트레이닝 + 오후 (토)', blocks: [
        {time:'10:00-12:00', name:'오전: 트레이닝'},
        {time:'14:30-18:00', name:'오후 A조 (실전)', detail:'복식 / 단체전'},
        {time:'14:30-18:00', name:'오후 B조 (연습구)', detail:'게임'}
      ]}
    }
  },
  camp: { // 전지훈련 1주차 (Day 1-7)
    label: '전지훈련 (1주차)',
    color: '#ef4444',
    days: {
      1: { title: 'Day 1 — 베이스 다지기', blocks: [
        {time:'10:00-12:00', name:'오전', detail:'기본스텝 + 대쉬 (1h) / 퍼스트서브 T존 (30m) / 런닝+스트레칭 (30m)'},
        {time:'15:00-17:00', name:'오후', detail:'포핸드 & 백핸드 피딩 (1h) / 콘 돌기 & 콘 맞추기 (1h) / 서브 리턴 (30m) / 쿨다운'}
      ]},
      2: { title: 'Day 2 — 근력', blocks: [
        {time:'10:00-12:00', name:'오전', detail:'메디신볼 근력 (1h) / 세컨서브 T존 (30m) / 런닝+스트레칭'},
        {time:'15:00-17:00', name:'오후', detail:'올코트 움직임 피딩 (2h) / 세컨서브 리턴 (30m) / 쿨다운'}
      ]},
      3: { title: 'Day 3 — 코트 인지', blocks: [
        {time:'10:00-12:00', name:'오전', detail:'라인 찍기 (1h) / 와이드 퍼스트서브 (30m) / 런닝+스트레칭'},
        {time:'15:00-17:00', name:'오후', detail:'골반 회전 이해 (1h) / 어프로치 전환 (1h) / 와이드 리턴 (30m) / 쿨다운'},
        {time:'야간', name:'스윙 연습'}
      ]},
      4: { title: 'Day 4 — 점프 + 발리', blocks: [
        {time:'10:00-12:00', name:'오전', detail:'바운딩 트레이닝 (1h) / 와이드 세컨서브 (30m) / 런닝+스트레칭'},
        {time:'15:00-17:00', name:'오후', detail:'라이징볼 훈련 (1h) / 발리 기본기 (1h) / 외부 선수와 랠리 (1h)'},
        {time:'야간', name:'레크리에이션'}
      ]},
      5: { title: 'Day 5 — 패턴 드릴', blocks: [
        {time:'10:00-12:00', name:'오전', detail:'줄넘기 + 서킷 (1h) / 첫서브-세컨 구분 (30m) / 런닝+스트레칭'},
        {time:'15:00-17:00', name:'오후', detail:'패턴 & 드릴 (1h) / 인사이드 아웃 포핸드 (1h) / 랜덤 리턴 (30m)'},
        {time:'야간', name:'농구 + 축구'}
      ]},
      6: { title: 'Day 6 — 지구력', blocks: [
        {time:'10:00-12:00', name:'오전', detail:'인터벌 지구력 (1h) / 서브 + 랠리 (1h)'},
        {time:'15:00-17:00', name:'오후', detail:'기본 랠리 (30m) / 런닝 스트록'}
      ]},
      7: { title: 'Day 7 — 리그전', blocks: [
        {time:'10:00-12:00', name:'오전', detail:'기본 웜업 (30m) / 랠리 + 서브 리턴 (1h 30m)'},
        {time:'15:00-17:00', name:'오후', detail:'타겟 맞추기 / 발리스트록 / 포인트게임 리그전 (상품 O)'}
      ]}
    }
  }
};

// === 핵심 드릴 라이브러리 (26개) ===
const DRILLS = [
  {category:'베이스라인', name:'100개 랠리 (60%)', detail:'안정성 우선, 깊게 힘있게', duration:30, level:'easy'},
  {category:'베이스라인', name:'다운더라인 깊게+힘있게', detail:'스윙 뻗으면서', duration:30, level:'medium'},
  {category:'베이스라인', name:'크로스 랠리', detail:'포 vs 포 / 백 vs 백', duration:30, level:'easy'},
  {category:'베이스라인', name:'2:1 런닝 스트록', detail:'한 명 DTL, 한 명 크로스 런닝', duration:30, level:'hard'},
  {category:'베이스라인', name:'인사이드 아웃 포핸드', detail:'백사이드에서 포핸드 돌아치기', duration:30, level:'hard'},
  {category:'베이스라인', name:'라이징볼 처리', detail:'바운드 직후 일어나는 볼 잡기', duration:20, level:'hard'},
  {category:'베이스라인', name:'허리밴드 + 포핸드 돌아치기', detail:'밴드 차고 선행 후 포핸드', duration:20, level:'medium'},
  {category:'전환', name:'어프로치 + 발리', detail:'짧은 볼 어프로치 후 네트 마무리', duration:30, level:'medium'},
  {category:'전환', name:'짧은볼 → 전진 → 스매시', detail:'짧은볼 처리 후 마무리', duration:25, level:'medium'},
  {category:'전환', name:'깊은볼 → 백업 → 수비 리턴', detail:'스텝백 후 안정 리턴', duration:25, level:'medium'},
  {category:'전환', name:'4코너 리커버리', detail:'콘 돌기로 정확한 풋워크', duration:20, level:'medium'},
  {category:'전환', name:'공수전환 패턴 (앞크로스/뒤일자)', detail:'리커버리 위치 변경', duration:25, level:'medium'},
  {category:'발리·네트', name:'로우/미들/하이 발리 분리', detail:'높이별 발리 감각', duration:30, level:'easy'},
  {category:'발리·네트', name:'어드밴스 + 드라이브 발리', detail:'전진 발리 + 강한 발리', duration:25, level:'hard'},
  {category:'발리·네트', name:'발리-발리 랠리 + 포칭', detail:'양쪽 다 연습', duration:25, level:'medium'},
  {category:'발리·네트', name:'서브 앤드 발리', detail:'서브 후 즉시 네트 전진', duration:25, level:'medium'},
  {category:'서브·리턴', name:'서브 T존/와이드/바디', detail:'코스별 정확도', duration:30, level:'easy'},
  {category:'서브·리턴', name:'퍼스트 vs 세컨드 분리', detail:'키네틱 다른 두 서브', duration:30, level:'easy'},
  {category:'서브·리턴', name:'랜덤 리턴', detail:'예측 불가 서브 처리', duration:25, level:'hard'},
  {category:'서브·리턴', name:'와이드 리턴', detail:'와이드 서브 컷오프', duration:20, level:'medium'},
  {category:'게임', name:'반코트 게임', detail:'포 사이드 / 백 사이드 분리', duration:30, level:'medium'},
  {category:'게임', name:'전술 미션 게임', detail:'첫 볼 크로스, 두 번째 DTL 등', duration:30, level:'medium'},
  {category:'게임', name:'서비스 박스 안 게임', detail:'좁은 코트 컨트롤', duration:20, level:'easy'},
  {category:'게임', name:'1포인트 단판 / 3포인트 승자', duration:30, level:'easy'},
  {category:'체력', name:'줄넘기 + 서킷', detail:'심폐 + 전신', duration:60, level:'medium'},
  {category:'체력', name:'메디신볼 근력', detail:'코어 + 회전 파워', duration:60, level:'hard'},
  {category:'체력', name:'인터벌 지구력', detail:'고강도 인터벌', duration:60, level:'hard'},
  {category:'정확도', name:'콘 맞추기 / 라인 찍기', detail:'타겟 정확도', duration:20, level:'easy'}
];

// === 그룹 프리셋 ===
const GROUP_PRESETS = [
  {
    name: '엘리트 선수반',
    description: '3시간, 16:00-19:00, 정예 선수',
    duration: 180,
    blocks: [
      {time:'10분', name:'스트레칭 + 밴딩'},
      {time:'30분', name:'스트록-발리 전환'},
      {time:'30분', name:'서브 앤드 발리'},
      {time:'30분', name:'발리-발리-스매싱'},
      {time:'30분', name:'포칭 (양쪽)'},
      {time:'50분', name:'포인트 게임'}
    ]
  },
  {
    name: '동호인 선수반',
    description: '2시간, 8명, 시합 준비',
    duration: 120,
    blocks: [
      {time:'30분', name:'스트로크 (기본기 + 코스)'},
      {time:'30분', name:'발리 (네트 감각 + 발리-스트록 랠리)'},
      {time:'40분', name:'포인트 게임 (2v2 복식)'},
      {time:'20분', name:'서브 마무리'}
    ]
  },
  {
    name: '동호인 일반반',
    description: '2시간, 저녁 레슨',
    duration: 120,
    blocks: [
      {time:'30분', name:'세션 1 (10×3 마이크로 드릴)'},
      {time:'30분', name:'세션 2'},
      {time:'30분', name:'세션 3'},
      {time:'20분', name:'서브 마무리'}
    ]
  },
  {
    name: 'MK 스쿨 키즈',
    description: '플레이 앤 스테이 (3주 프로그램)',
    duration: 60,
    blocks: [
      {time:'15분', name:'볼 친해지기 (레드볼)'},
      {time:'15분', name:'포·백핸드 컨트롤'},
      {time:'15분', name:'랠리 / 포인트 게임'},
      {time:'15분', name:'자세 교정'}
    ]
  },
  {
    name: '매직테니스',
    description: '2시간, 게임 + 자세 교정',
    duration: 120,
    blocks: [
      {time:'60분', name:'매직테니스 (도구 활용 게임형 훈련)'},
      {time:'60분', name:'스윙 + 자세 교정'}
    ]
  },
  {
    name: '30분 개인 레슨',
    description: '30분, 1:1',
    duration: 30,
    blocks: [
      {time:'5분', name:'웜업 (짧은 볼)'},
      {time:'10분', name:'주제 1 (예: 발리 리커버리 양쪽)'},
      {time:'10분', name:'주제 2 (예: 포칭 — 네트 전진 / DTL 지키기)'},
      {time:'5분', name:'서브 마무리'}
    ]
  }
];

module.exports = { PHASE_PROGRAMS, DRILLS, GROUP_PRESETS };
