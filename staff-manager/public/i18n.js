// 업무보고 화면 문구 사전 — 한국어 / 몽골어
// 문구를 추가할 때는 ko/mn 양쪽에 같은 키를 넣어야 한다 (test/i18n.test.js가 검사)
const I18N = {
  ko: {
    appTitle: '업무보고',
    selectName: '이름을 선택하세요',
    password: '비밀번호',
    login: '로그인',
    or: '— 또는 —',
    bossPassword: '사장님 비밀번호',
    bossLogin: '사장님 로그인',
    loginFail: '로그인 실패',

    boss: '사장님',
    myWork: '🏠 내 업무',
    allStaff: '👥 직원 현황',
    changePw: '비번변경',
    logout: '로그아웃',
    saved: '저장됨',

    today: '오늘',
    tomorrow: '내일',
    week: '주간',
    month: '월간',
    year: '연간',

    todo: '할 일',
    memo: '메모',
    addItem: '+ 항목 추가',
    freeWrite: '자유롭게 작성...',
    freeHint_week: '이번 주 방향/목표를 자유롭게 적어두세요.',
    freeHint_month: '이번 달 방향/목표를 자유롭게 적어두세요.',
    freeHint_year: '올해 방향/목표를 자유롭게 적어두세요.',

    noEntry: '아직 작성 없음',
    noTitle: '(제목 없음)',
    doneCount: '{done}/{total} 완료',
    noStaff: '직원이 없습니다',

    curPassword: '현재 비밀번호',
    newPassword: '새 비밀번호(4자 이상)',
    change: '변경',
    save: '저장',
    pwChanged: '변경됨',
    pwWrongCurrent: '현재 비번 틀림',
    pwTooShort: '4자 이상 입력',
    pwFailed: '실패',
    pwReset: '리셋 완료',
    pwSetFor: '{name} 님 새 비밀번호 설정',
    pwBossEnv: '사장님 비밀번호는 서버 설정(.env)에서 관리합니다.',
    pwPickStaff: '비밀번호를 바꾸려면 위에서 직원을 먼저 선택하세요.',

    calTitle: '{y}년 {m}월',
    dayLabel: '{d}일',
    dow0: '일', dow1: '월', dow2: '화', dow3: '수', dow4: '목', dow5: '금', dow6: '토',
    fromTab: '{tab}에 적음',
    assign: '+ 지시',
    assignTitle: '{name} 님에게 지시',
    assignWhat: '시킬 일',
    assignSend: '보내기',
    assignCancel: '취소',
    assignOk: '보냈습니다',
    assignOkNoTg: '등록됨 (텔레그램 미등록이라 알림은 못 감)',
    assignFail: '실패',
    boss1: '📌 사장님 지시',
    delAsk: '지울까요?',
    att: '근태',
    score: '종합',
    scTitle: '{m}월 직원 종합',
    scReport: '보고',
    scTask: '할 일',
    scAsg: '지시',
    scWork: '근무',
    scLate: '지각',
    scNone: '기록 없음',
    scExport: '엑셀 내려받기',
    attIn: '출근',
    attOut: '퇴근',
    attNone: '미출근',
    attWorking: '근무 중',
    attLate: '지각',
    attToday: '오늘',
    attMonth: '이번 달',
    attDays: '{n}일',
    attSummary: '{days}일 · {hours} · 지각 {late}회',
    attExport: '엑셀 내려받기',
    attStart: '출근 기준',
    attPlace: '근무지',
    attSetHere: '현재 위치로 등록',
    attNoPlace: '근무지 미등록 — 어디서나 출근됩니다',
    attFar: '근무지에서 {d}m 떨어져 있습니다 (허용 {r}m)',
    attGpsFail: '위치를 확인할 수 없습니다. 위치 권한을 켜주세요',
    attDone: '기록했습니다',
    attMark: '출근처리',
    attSaved: '저장됨',
    pushOn: '폰 알림 켜기',
    pushOk: '폰 알림 켜짐',
    pushOff: '끄기',
    pushTest: '테스트',
    pushDenied: '폰 설정에서 알림을 허용해 주세요',
    pushNeedHome: '아이폰은 먼저 홈 화면에 추가해야 알림이 옵니다',
    pushHowIos: '사파리 아래 공유 버튼 → 홈 화면에 추가 → 홈 화면 아이콘으로 다시 열기',
    pushNo: '이 브라우저는 폰 알림을 지원하지 않습니다',
    pushSent: '보냈습니다',
    alarm: '알람',
    alarmOn: '알람 켜기',
    alarmTime: '보낼 시각',
    alarmChat: '텔레그램 chat ID',
    alarmHelp: '텔레그램에서 @Jaesung2026_bot 을 찾아 아무 말이나 보낸 뒤, 사장님께 chat ID를 받아 넣으세요.',
    alarmSave: '저장',
    alarmTest: '테스트 발송',
    alarmSaved: '저장됨',
    alarmSentOk: '보냈습니다',
    alarmNoChat: 'chat ID를 먼저 넣으세요',
    alarmFailed: '실패'
  },
  mn: {
    appTitle: 'Ажлын тайлан',
    selectName: 'Нэрээ сонгоно уу',
    password: 'Нууц үг',
    login: 'Нэвтрэх',
    or: '— эсвэл —',
    bossPassword: 'Захирлын нууц үг',
    bossLogin: 'Захирал нэвтрэх',
    loginFail: 'Нэвтрэхэд алдаа гарлаа',

    boss: 'Захирал',
    myWork: '🏠 Миний ажил',
    allStaff: '👥 Ажилтнуудын байдал',
    changePw: 'Нууц үг солих',
    logout: 'Гарах',
    saved: 'Хадгаллаа',

    today: 'Өнөөдөр',
    tomorrow: 'Маргааш',
    week: 'Долоо хоног',
    month: 'Сар',
    year: 'Жил',

    todo: 'Хийх ажил',
    memo: 'Тэмдэглэл',
    addItem: '+ Ажил нэмэх',
    freeWrite: 'Чөлөөтэй бичнэ үү...',
    freeHint_week: 'Энэ долоо хоногийн зорилгоо чөлөөтэй бичнэ үү.',
    freeHint_month: 'Энэ сарын зорилгоо чөлөөтэй бичнэ үү.',
    freeHint_year: 'Энэ жилийн зорилгоо чөлөөтэй бичнэ үү.',

    noEntry: 'Хараахан бичээгүй',
    noTitle: '(гарчиггүй)',
    doneCount: '{done}/{total} гүйцэтгэсэн',
    noStaff: 'Ажилтан алга',

    curPassword: 'Одоогийн нууц үг',
    newPassword: 'Шинэ нууц үг (4-өөс дээш тэмдэгт)',
    change: 'Солих',
    save: 'Хадгалах',
    pwChanged: 'Солигдлоо',
    pwWrongCurrent: 'Одоогийн нууц үг буруу',
    pwTooShort: '4-өөс дээш тэмдэгт оруулна уу',
    pwFailed: 'Амжилтгүй',
    pwReset: 'Шинэчиллээ',
    pwSetFor: '{name}-ийн шинэ нууц үг тохируулах',
    pwBossEnv: 'Захирлын нууц үгийг серверийн тохиргооноос (.env) удирдана.',
    pwPickStaff: 'Нууц үг солихын тулд дээрээс ажилтнаа сонгоно уу.',

    calTitle: '{y} оны {m} сар',
    dayLabel: '{d}-ний өдөр',
    dow0: 'Ня', dow1: 'Да', dow2: 'Мя', dow3: 'Лха', dow4: 'Пү', dow5: 'Ба', dow6: 'Бя',
    fromTab: '{tab}-д бичсэн',
    assign: '+ Даалгавар',
    assignTitle: '{name}-д даалгавар өгөх',
    assignWhat: 'Хийх ажил',
    assignSend: 'Илгээх',
    assignCancel: 'Болих',
    assignOk: 'Илгээлээ',
    assignOkNoTg: 'Бүртгэгдлээ (Telegram бүртгэлгүй тул мэдэгдэл очсонгүй)',
    assignFail: 'Амжилтгүй',
    boss1: '📌 Захирлын даалгавар',
    delAsk: 'Устгах уу?',
    att: 'Ирц',
    score: 'Нэгтгэл',
    scTitle: '{m}-р сарын нэгтгэл',
    scReport: 'Тайлан',
    scTask: 'Ажил',
    scAsg: 'Даалгавар',
    scWork: 'Ажилласан',
    scLate: 'Хоцролт',
    scNone: 'Бүртгэл алга',
    scExport: 'Excel татах',
    attIn: 'Ирсэн',
    attOut: 'Явсан',
    attNone: 'Ирээгүй',
    attWorking: 'Ажиллаж байна',
    attLate: 'Хоцорсон',
    attToday: 'Өнөөдөр',
    attMonth: 'Энэ сар',
    attDays: '{n} өдөр',
    attSummary: '{days} өдөр · {hours} · хоцролт {late}',
    attExport: 'Excel татах',
    attStart: 'Ирэх цаг',
    attPlace: 'Ажлын байр',
    attSetHere: 'Одоогийн байршлаар бүртгэх',
    attNoPlace: 'Ажлын байр бүртгэгдээгүй — хаанаас ч ирц бүртгэнэ',
    attFar: 'Ажлын байрнаас {d}м зайтай байна (зөвшөөрөх {r}м)',
    attGpsFail: 'Байршил тогтоож чадсангүй. Байршлын зөвшөөрлийг асаана уу',
    attDone: 'Бүртгэлээ',
    attMark: 'Ирц бүртгэх',
    attSaved: 'Хадгаллаа',
    pushOn: 'Утасны мэдэгдэл асаах',
    pushOk: 'Мэдэгдэл асаалттай',
    pushOff: 'Унтраах',
    pushTest: 'Тест',
    pushDenied: 'Утасны тохиргооноос мэдэгдлийг зөвшөөрнө үү',
    pushNeedHome: 'iPhone дээр эхлээд үндсэн дэлгэцэд нэмэх шаардлагатай',
    pushHowIos: 'Safari доод талын Share → Add to Home Screen → дүрсээр нь дахин нээх',
    pushNo: 'Энэ хөтөч утасны мэдэгдэл дэмжихгүй',
    pushSent: 'Илгээлээ',
    alarm: 'Сэрүүлэг',
    alarmOn: 'Сэрүүлэг асаах',
    alarmTime: 'Илгээх цаг',
    alarmChat: 'Telegram chat ID',
    alarmHelp: 'Telegram-аас @Jaesung2026_bot-ыг олж мессеж бичээд, chat ID-гаа захирлаас аваад оруулна уу.',
    alarmSave: 'Хадгалах',
    alarmTest: 'Туршиж илгээх',
    alarmSaved: 'Хадгаллаа',
    alarmSentOk: 'Илгээлээ',
    alarmNoChat: 'Эхлээд chat ID оруулна уу',
    alarmFailed: 'Амжилтгүй'
  }
};

// 저장된 선택이 있으면 그걸, 없으면 폰 언어 설정을 본다
function detectLang() {
  try {
    const saved = localStorage.getItem('report_lang');
    if (saved === 'ko' || saved === 'mn') return saved;
    const langs = [navigator.language].concat(navigator.languages || []).filter(Boolean);
    return langs.some(l => String(l).toLowerCase().indexOf('mn') === 0) ? 'mn' : 'ko';
  } catch (e) { return 'ko'; }
}

let LANG = (typeof window === 'undefined') ? 'ko' : detectLang();

function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) || I18N.ko[key] || key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

function setLang(l) {
  LANG = (l === 'mn') ? 'mn' : 'ko';
  try { localStorage.setItem('report_lang', LANG); } catch (e) {}
  applyI18n();
}

function applyI18n() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LANG;
  document.title = t('appTitle');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('.langBtn').forEach(b => { b.textContent = LANG === 'ko' ? 'MN' : '한'; });
  // 로그인 후 화면은 JS로 그리므로 다시 그려야 언어가 반영된다
  const app = document.getElementById('appView');
  if (app && app.style.display === 'block' && typeof render === 'function') render();
}

if (typeof module !== 'undefined' && module.exports) module.exports = { I18N, t, setLang };
