// 화면 문구 — 몽골어(기본) / 한국어.
// 문구를 추가할 때는 두 언어 모두에 같은 키를 넣는다. test/i18n.test.js 가 빠진 키를 잡는다.
export const DICT = {
  mn: {
    memberOnly: 'Гишүүдэд зориулсан',
    phone: 'Утасны дугаар', pin: 'ПИН (4 орон)', login: 'Нэвтрэх', logout: 'Гарах',
    loginFail: 'Дугаар эсвэл ПИН буруу', loginLocked: '{s} секундын дараа дахин оролдоно уу',
    loginDormant: 'Таны гишүүнчлэл түр хүлээлгэд байна. Админтай холбогдоно уу.',
    loggingIn: 'Шалгаж байна…',

    tabHome: 'Үндсэн', tabSchedule: 'Хуваарь', tabDues: 'Хураамж', tabNotices: 'Мэдэгдэл', tabMembers: 'Гишүүд',

    changePin: 'ПИН солих', settings: 'Тохиргоо', cancel: 'Болих', save: 'Хадгалах',
    add: 'Нэмэх', edit: 'Засах', del: 'Устгах', close: 'Хаах', confirmDelete: 'Устгах уу?',
    saved: 'Хадгаллаа', deleted: 'Устгалаа', failed: 'Амжилтгүй', required: 'Шаардлагатай',
    admin: 'Админ', member: 'Гишүүн', adminOnly: 'Зөвхөн админ',

    upcoming: 'Дараагийн хуваарь', noUpcoming: 'Ойртож байгаа хуваарь алга',
    pinnedNotice: 'Бэхэлсэн мэдэгдэл', myDues: 'Миний хураамж', quickUnpaid: 'Энэ сар төлөөгүй',
    greetMorning: 'Сайн байна уу', today: 'Өнөөдөр',

    schedule: 'Хуваарь', newEvent: 'Хуваарь нэмэх', editEvent: 'Хуваарь засах',
    kindRegular: 'Тогтмол цугларалт', kindEvent: 'Арга хэмжээ', kindTournament: 'Тэмцээн',
    title: 'Гарчиг', kind: 'Төрөл', date: 'Өдөр', startTime: 'Эхлэх', endTime: 'Дуусах',
    courts: 'Кортын тоо', memo: 'Тэмдэглэл', upcomingTab: 'Ойрын', pastTab: 'Өнгөрсөн',
    courtsN: '{n} корт', noEvents: 'Хуваарь алга', endBeforeStart: 'Дуусах цаг эхлэхээсээ хойно байх ёстой',
    yes: 'Ирнэ', no: 'Ирэхгүй', maybe: 'Шийдээгүй',
    attendCount: 'Ирэх {n}', roster: 'Нэрс', noAnswerYet: 'Хэн ч хариулаагүй', myAnswer: 'Миний хариу',

    dues: 'Хураамж', monthlyFee: 'Сарын хураамж', joiningFee: 'Элсэх хураамж',
    paid: 'Төлсөн', unpaid: 'Төлөөгүй', paidAt: 'Төлсөн өдөр', method: 'Хэлбэр',
    cash: 'Бэлэн', transfer: 'Банкны шилжүүлэг', qpay: 'QPay',
    duesGrid: 'Гишүүдийн төлбөр', unpaidList: 'Төлөөгүй гишүүд', allPaid: 'Бүгд төлсөн 🎉',
    collected: 'Хураасан', expected: 'Байвал зохих', members: 'Гишүүн',
    myDuesEmpty: 'Хураамжийн бүртгэл алга', joiningLabel: 'Элсэх хураамж',
    markPaid: 'Төлсөн болгох', markUnpaid: 'Төлөөгүй болгох',

    notices: 'Мэдэгдэл', newNotice: 'Мэдэгдэл бичих', editNotice: 'Мэдэгдэл засах',
    body: 'Агуулга', photo: 'Зураг', pinTop: 'Дээр бэхлэх', pinned: 'Бэхэлсэн',
    noNotices: 'Мэдэгдэл алга', photoPick: 'Зураг сонгох', photoRemove: 'Зургийг хасах',
    photoTooBig: 'Зураг хэт том', readOnly: 'Зөвхөн админ бичнэ',

    memberList: 'Гишүүд', newMember: 'Гишүүн нэмэх', editMember: 'Гишүүн засах',
    name: 'Нэр', level: 'Түвшин', joinedAt: 'Элссэн өдөр', status: 'Байдал', role: 'Эрх',
    lvNewbie: 'Шинэ', lvBeginner: 'Анхан', lvIntermediate: 'Дунд', lvAdvanced: 'Дээд',
    stActive: 'Идэвхтэй', stDormant: 'Түр хүлээлгэ',
    membersN: '{n} гишүүн', activeN: 'Идэвхтэй {n}', phoneTaken: 'Ийм дугаар бүртгэлтэй байна',
    badPhone: 'Утасны дугаар 8 орон байх ёстой', pin4: 'ПИН 4 орон байх ёстой',
    resetPin: 'ПИН шинэчлэх', newPin: 'Шинэ ПИН', firstPin: 'Анхны ПИН: {pin}',
    lastAdmin: 'Хамгийн сүүлийн админыг хасч болохгүй',
    currentPin: 'Одоогийн ПИН', pinChanged: 'ПИН солигдлоо', badCurrentPin: 'Одоогийн ПИН буруу',
    clubName: 'Клубын нэр', titleRole: 'Албан тушаал',

    pushTitle: 'Утасны мэдэгдэл',
    pushWhat: 'Шинэ мэдэгдэл, шинэ бичлэг, сэтгэгдэл, хуваарь болон хураамжийн сануулга утсанд ирнэ.',
    pushTurnOn: 'Мэдэгдэл асаах',
    pushOn: 'Мэдэгдэл асаалттай',
    pushOff: 'Унтраах',
    pushOffDone: 'Унтраалаа',
    pushTest: 'Туршиж үзэх',
    pushSent: 'Илгээлээ',
    pushDenied: 'Утасны тохиргооноос мэдэгдлийг зөвшөөрнө үү',
    pushNo: 'Энэ хөтөч мэдэгдэл дэмжихгүй',
    pushNeedHome: 'iPhone дээр эхлээд үндсэн дэлгэцэд нэмэх шаардлагатай',
    pushHowIos: 'Safari доод талын Share → Add to Home Screen → дүрсээр нь дахин нээнэ үү',
    pushOtherDevice: 'Өөр {n} төхөөрөмж дээр асаалттай',
    pushNoDevice: 'Асаалттай төхөөрөмж алга',
    loading: 'Ачаалж байна…',

    tabBoard: 'Чат',
    newPost: 'Шинэ бичлэг',
    editPost: 'Бичлэг засах',
    postWhat: 'Юу болсон бэ?',
    postEmpty: 'Юм бичих эсвэл зураг нэмнэ үү',
    noPosts: 'Бичлэг алга',
    comments: 'Сэтгэгдэл',
    noComments: 'Сэтгэгдэл алга',
    commentWrite: 'Сэтгэгдэл бичих…',
    send: 'Илгээх',
    more: 'Цааш нь',
    edited: 'зассан',
    editBodyOnly: 'Зөвхөн бичвэрийг засна (зураг хасахыг бол бичлэгийг устгаад дахин оруулна уу)',
    photoMax: 'хамгийн их 4',
    agoNow: 'саяхан',
    agoMin: '{n} минутын өмнө',
    agoHour: '{n} цагийн өмнө',
    agoDay: '{n} өдрийн өмнө',

    repeat: 'Давтах (хэд хоногийг нэг дор)',
    repeatAuto: '🪄 Гарчгаас {days} гарагийг уншлаа',
    repeatFrom: 'Хугацаа (эхлэх)',
    repeatTo: 'Хугацаа (дуусах)',
    repeatPreview: '{n} хуваарь бүртгэгдэнэ',
    repeatNoDays: 'Гарагаа сонгоно уу',
    repeatNone: 'Тохирох өдөр алга',
    repeatBadRange: 'Хугацаа буруу',
    bulkDone: '{n} хуваарь бүртгэлээ',
    bulkDoneSkip: '{n} бүртгэлээ ({s} аль хэдийн байсан)',
    repeatTooMany: 'Хэт олон хуваарь (120-аас дээш)',

    joinRequest: 'Гишүүнээр бүртгүүлэх',
    joinHint: 'Хүсэлт илгээвэл админ зөвшөөрсний дараа нэвтэрч орно. ПИН-ээ өөрөө сонгоно уу.',
    joinSend: 'Хүсэлт илгээх',
    joinDone: 'Хүсэлт илгээгдлээ. Админ зөвшөөрөхийг хүлээнэ үү.',
    joinPending: 'Гишүүнчлэлийн хүсэлт',
    joinNone: 'Хүсэлт алга',
    joinApprove: 'Зөвшөөрөх',
    joinReject: 'Татгалзах',
    joinApproved: '{name} гишүүн болов',
    joinRejected: 'Татгалзлаа',
    alreadyMember: 'Энэ дугаар бүртгэлтэй байна',
    alreadyRequested: 'Та аль хэдийн хүсэлт илгээсэн байна',
    tooManyRequests: 'Хэт олон хүсэлт. Дараа дахин оролдоно уу.',

    dow: ['Ня', 'Да', 'Мя', 'Лха', 'Пү', 'Ба', 'Бя'],
  },
  ko: {
    memberOnly: '회원 전용',
    phone: '전화번호', pin: 'PIN (4자리)', login: '로그인', logout: '로그아웃',
    loginFail: '전화번호 또는 PIN이 맞지 않습니다', loginLocked: '{s}초 후에 다시 시도해 주세요',
    loginDormant: '휴면 회원입니다. 관리자에게 문의해 주세요.',
    loggingIn: '확인 중…',

    tabHome: '홈', tabSchedule: '일정', tabDues: '회비', tabNotices: '공지', tabMembers: '회원',

    changePin: 'PIN 변경', settings: '설정', cancel: '취소', save: '저장',
    add: '추가', edit: '수정', del: '삭제', close: '닫기', confirmDelete: '삭제할까요?',
    saved: '저장했습니다', deleted: '삭제했습니다', failed: '실패했습니다', required: '필수',
    admin: '관리자', member: '회원', adminOnly: '관리자만',

    upcoming: '다가오는 일정', noUpcoming: '다가오는 일정이 없습니다',
    pinnedNotice: '고정 공지', myDues: '내 회비', quickUnpaid: '이번 달 미납',
    greetMorning: '안녕하세요', today: '오늘',

    schedule: '일정', newEvent: '일정 등록', editEvent: '일정 수정',
    kindRegular: '정기모임', kindEvent: '행사', kindTournament: '대회',
    title: '제목', kind: '종류', date: '날짜', startTime: '시작', endTime: '종료',
    courts: '코트 수', memo: '메모', upcomingTab: '다가오는', pastTab: '지난',
    courtsN: '코트 {n}면', noEvents: '일정이 없습니다', endBeforeStart: '종료 시간이 시작보다 빠릅니다',
    yes: '참석', no: '불참', maybe: '미정',
    attendCount: '참석 {n}명', roster: '명단', noAnswerYet: '아직 아무도 답하지 않았습니다', myAnswer: '내 응답',

    dues: '회비', monthlyFee: '월회비', joiningFee: '입회비',
    paid: '완납', unpaid: '미납', paidAt: '납부일', method: '방법',
    cash: '현금', transfer: '계좌이체', qpay: 'QPay',
    duesGrid: '회원 납부 현황', unpaidList: '미납자', allPaid: '전원 완납 🎉',
    collected: '수납', expected: '예정', members: '회원',
    myDuesEmpty: '회비 내역이 없습니다', joiningLabel: '입회비',
    markPaid: '완납으로', markUnpaid: '미납으로',

    notices: '공지', newNotice: '공지 작성', editNotice: '공지 수정',
    body: '내용', photo: '사진', pinTop: '상단 고정', pinned: '고정',
    noNotices: '공지가 없습니다', photoPick: '사진 선택', photoRemove: '사진 빼기',
    photoTooBig: '사진이 너무 큽니다', readOnly: '관리자만 작성합니다',

    memberList: '회원 명단', newMember: '회원 추가', editMember: '회원 수정',
    name: '이름', level: '레벨', joinedAt: '가입일', status: '상태', role: '권한',
    lvNewbie: '입문', lvBeginner: '초급', lvIntermediate: '중급', lvAdvanced: '상급',
    stActive: '활동', stDormant: '휴면',
    membersN: '{n}명', activeN: '활동 {n}명', phoneTaken: '이미 등록된 전화번호입니다',
    badPhone: '전화번호는 8자리입니다', pin4: 'PIN은 4자리 숫자입니다',
    resetPin: 'PIN 재설정', newPin: '새 PIN', firstPin: '첫 PIN: {pin}',
    lastAdmin: '마지막 관리자는 바꿀 수 없습니다',
    currentPin: '현재 PIN', pinChanged: 'PIN을 바꿨습니다', badCurrentPin: '현재 PIN이 맞지 않습니다',
    clubName: '클럽 이름', titleRole: '직책',

    pushTitle: '폰 알림',
    pushWhat: '새 공지, 게시판 새 글과 댓글, 새 일정, 회비 안내가 폰으로 옵니다.',
    pushTurnOn: '알림 켜기',
    pushOn: '알림 켜짐',
    pushOff: '끄기',
    pushOffDone: '껐습니다',
    pushTest: '테스트 보내기',
    pushSent: '보냈습니다',
    pushDenied: '폰 설정에서 알림을 허용해 주세요',
    pushNo: '이 브라우저는 알림을 지원하지 않습니다',
    pushNeedHome: '아이폰은 먼저 홈 화면에 추가해야 알림이 옵니다',
    pushHowIos: '사파리 아래 공유 버튼 → 홈 화면에 추가 → 홈 화면 아이콘으로 다시 열기',
    pushOtherDevice: '다른 기기 {n}대에서 켜져 있습니다',
    pushNoDevice: '켜진 기기가 없습니다',
    loading: '불러오는 중…',

    tabBoard: '게시판',
    newPost: '글쓰기',
    editPost: '글 수정',
    postWhat: '무슨 일이 있었나요?',
    postEmpty: '내용을 쓰거나 사진을 넣어주세요',
    noPosts: '아직 글이 없습니다',
    comments: '댓글',
    noComments: '댓글이 없습니다',
    commentWrite: '댓글 쓰기…',
    send: '보내기',
    more: '더 보기',
    edited: '수정됨',
    editBodyOnly: '글만 고칩니다 (사진을 바꾸려면 글을 지우고 다시 올려주세요)',
    photoMax: '최대 4장',
    agoNow: '방금',
    agoMin: '{n}분 전',
    agoHour: '{n}시간 전',
    agoDay: '{n}일 전',

    repeat: '반복 등록 (여러 날 한 번에)',
    repeatAuto: '🪄 제목에서 {days}요일을 찾아 자동으로 골랐습니다',
    repeatFrom: '기간 시작',
    repeatTo: '기간 끝',
    repeatPreview: '{n}개 일정이 등록됩니다',
    repeatNoDays: '요일을 골라주세요',
    repeatNone: '해당하는 날짜가 없습니다',
    repeatBadRange: '기간을 확인해 주세요',
    bulkDone: '{n}개 일정을 등록했습니다',
    bulkDoneSkip: '{n}개 등록 ({s}개는 이미 있어 건너뜀)',
    repeatTooMany: '한 번에 120개를 넘을 수 없습니다. 기간을 줄여주세요',

    joinRequest: '가입 신청',
    joinHint: '신청하면 관리자 승인 후 로그인할 수 있습니다. PIN은 직접 정해 주세요.',
    joinSend: '신청하기',
    joinDone: '신청했습니다. 관리자 승인을 기다려 주세요.',
    joinPending: '가입 신청',
    joinNone: '신청 없음',
    joinApprove: '승인',
    joinReject: '거절',
    joinApproved: '{name} 님을 회원으로 등록했습니다',
    joinRejected: '거절했습니다',
    alreadyMember: '이미 등록된 전화번호입니다',
    alreadyRequested: '이미 신청하셨습니다',
    tooManyRequests: '신청이 너무 많습니다. 나중에 다시 시도해 주세요.',

    dow: ['일', '월', '화', '수', '목', '금', '토'],
  },
};

const KEY = 'htc_lang';
export let LANG = detect();

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'mn' || saved === 'ko') return saved;
    // 폰이 한국어면 한국어, 그 밖에는 몽골어(클럽 기본)
    const langs = [navigator.language, ...(navigator.languages || [])].filter(Boolean).map(String);
    return langs.some(l => l.toLowerCase().startsWith('ko')) ? 'ko' : 'mn';
  } catch (e) { return 'mn'; }
}

export function t(key, vars) {
  let s = DICT[LANG]?.[key] ?? DICT.mn[key] ?? key;
  if (Array.isArray(s)) return s;
  if (vars) for (const k in vars) s = String(s).split(`{${k}}`).join(vars[k]);
  return s;
}

export function setLang(l) {
  LANG = l === 'ko' ? 'ko' : 'mn';
  try { localStorage.setItem(KEY, LANG); } catch (e) {}
  applyStatic();
  document.documentElement.lang = LANG;
}

export const otherLang = () => (LANG === 'mn' ? 'ko' : 'mn');

// data-i18n 이 붙은 정적 문구를 현재 언어로 바꾼다
export function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-lang-toggle]').forEach(b => { b.textContent = LANG === 'mn' ? '한국어' : 'Монгол'; });
  document.documentElement.lang = LANG;
}

// 2026-10-18 → '10/18 (Ба)' 식으로. 요일 이름은 언어에 따라 바뀐다.
export function fmtDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dow = t('dow')[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d} (${dow})`;
}
export const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US');

// '2026-10-15 19:40:12' → '3시간 전'.
// 서버가 적는 시각은 울란바토르 벽시계라 폰 시간대와 다를 수 있다.
// 지금 시각도 같은 벽시계로 구해 둘을 같은 기준(UTC인 척)으로 빼면 차이는 정확하다.
const UB_NOW = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const asTs = (s) => Date.parse(String(s).replace(' ', 'T') + 'Z');

export function timeAgo(stamp) {
  const then = asTs(stamp);
  if (!Number.isFinite(then)) return String(stamp || '');
  const now = asTs(UB_NOW.format(new Date()).replace('T', ' '));
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return t('agoNow');
  if (sec < 3600) return t('agoMin', { n: Math.floor(sec / 60) });
  if (sec < 86400) return t('agoHour', { n: Math.floor(sec / 3600) });
  const days = Math.floor(sec / 86400);
  if (days <= 7) return t('agoDay', { n: days });
  return String(stamp).slice(0, 10);   // 오래된 글은 날짜로
}
export const fmtMonth = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  return LANG === 'ko' ? `${y}년 ${m}월` : `${y} оны ${m} сар`;
};
export const levelLabel = (lv) => t({ newbie: 'lvNewbie', beginner: 'lvBeginner', intermediate: 'lvIntermediate', advanced: 'lvAdvanced' }[lv] || 'lvBeginner');
export const kindLabel = (k) => t({ regular: 'kindRegular', event: 'kindEvent', tournament: 'kindTournament' }[k] || 'kindEvent');
export const methodLabel = (m) => (m ? t(m) : '');
