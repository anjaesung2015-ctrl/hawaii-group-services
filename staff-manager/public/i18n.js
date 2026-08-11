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
    dow0: '일', dow1: '월', dow2: '화', dow3: '수', dow4: '목', dow5: '금', dow6: '토'
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
    dow0: 'Ня', dow1: 'Да', dow2: 'Мя', dow3: 'Лха', dow4: 'Пү', dow5: 'Ба', dow6: 'Бя'
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
