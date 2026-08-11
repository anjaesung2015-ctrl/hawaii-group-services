// 글 속 날짜 인식 — 달력·알람이 함께 쓴다
// 지원: 2026-08-15 / 2026.8.15 / 8월 15일 / 8/15 / 나열(8월11일 12일) / 범위(8/15~8/20)
//       요일(토요일, 이번주 금요일, 다음주 월요일) — 그 글이 속한 주를 기준으로 계산
// 일부러 지원 안 함: '8월'처럼 일이 없는 것(달 전체를 칠하지 않는다), 9:30 시각, 100/5 비율
const DOW_KO = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };  // 월요일 시작
const WEEK_SHIFT = { '이번주': 0, '금주': 0, '다음주': 7, '담주': 7, '내주': 7, '지난주': -7, '저번주': -7, '전주': -7 };

const DATE_TOKEN = new RegExp(
  '(\\d{4})[-./](\\d{1,2})[-./](\\d{1,2})' +                              // 1,2,3 : 연-월-일
  '|(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일' +                                // 4,5   : M월 D일
  '|(?<![\\d:/.])(\\d{1,2})/(\\d{1,2})(?![\\d:/.])' +                      // 6,7   : M/D
  '|(이번주|금주|다음주|담주|내주|지난주|저번주|전주)?\\s*([월화수목금토일])요일' +   // 8,9   : (주 지정)?요일
  '|(\\d{1,2})\\s*일',                                                     // 10    : D일 (나열·범위에서만)
  'g');

function ymd(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;  // 2/30 같은 유령날짜
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// baseDate 가 속한 주(월요일 시작)의 해당 요일
function weekdayOf(baseDate, dowIdx, shift) {
  const [y, m, d] = baseDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(Date.UTC(y, m - 1, d - ((dt.getUTCDay() + 6) % 7)));
  monday.setUTCDate(monday.getUTCDate() + dowIdx + shift);
  return monday.toISOString().slice(0, 10);
}

// base: 'YYYY-MM-DD'(그 글의 날짜) 또는 연도 숫자.
// 연도만 주면 요일 표현은 기준 주를 알 수 없으므로 건너뛴다.
function extractDates(text, base) {
  if (!text) return [];
  const baseDate = (typeof base === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(base)) ? base : null;
  const defaultYear = baseDate ? Number(baseDate.slice(0, 4)) : Number(base);
  const str = String(text);

  const hits = [];
  DATE_TOKEN.lastIndex = 0;
  let m;
  while ((m = DATE_TOKEN.exec(str)) !== null) {
    const at = { start: m.index, end: m.index + m[0].length };
    if (m[1]) hits.push({ kind: 'full', y: +m[1], m: +m[2], d: +m[3], ...at });
    else if (m[4]) hits.push({ kind: 'md', y: defaultYear, m: +m[4], d: +m[5], ...at });
    else if (m[6]) hits.push({ kind: 'md', y: defaultYear, m: +m[6], d: +m[7], ...at });
    else if (m[9]) hits.push({ kind: 'dow', dow: DOW_KO[m[9]], shift: WEEK_SHIFT[m[8]] || 0, ...at });
    else hits.push({ kind: 'dayonly', d: +m[10], ...at });
  }

  const resolve = (h) => {
    if (h.kind === 'dow') return baseDate ? weekdayOf(baseDate, h.dow, h.shift) : null;
    if (h.kind === 'dayonly') return null;
    return ymd(h.y, h.m, h.d);
  };

  const found = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h.kind === 'dayonly') continue;              // 홀로 있는 'D일'은 무시
    const a = resolve(h);
    if (!a) continue;
    found.push(a);

    const nxt = hits[i + 1];
    if (!nxt) continue;
    const gap = str.slice(h.end, nxt.start);

    if (/^\s*[~\-–—]\s*$/.test(gap)) {               // 물결/하이픈이면 범위
      const b = nxt.kind === 'dayonly' ? (h.kind === 'dow' ? null : ymd(h.y, h.m, nxt.d)) : resolve(nxt);
      if (!b || b <= a) continue;
      for (let cur = addDays(a, 1), guard = 0; cur <= b && guard < 62; cur = addDays(cur, 1), guard++) found.push(cur);
      i++;                                           // 범위 끝 토큰 소비
      continue;
    }

    if (h.kind === 'dow') continue;                  // 요일 뒤의 나열은 다루지 않는다

    // '8월 11일 12일 15일' 처럼 나열한 경우 — 같은 달의 날짜로 이어 붙인다
    let cur = h, j = i + 1;
    while (j < hits.length) {
      const n2 = hits[j];
      if (n2.kind !== 'dayonly') break;
      if (!/^[\s,、·]*$/.test(str.slice(cur.end, n2.start))) break;
      if (/^[간동째차후전]/.test(str.slice(n2.end))) break;   // '3일간', '2일 후' 등은 날짜가 아니다
      const extra = ymd(h.y, h.m, n2.d);
      if (!extra) break;
      found.push(extra);
      cur = n2; j++;
    }
    i = j - 1;
  }
  return [...new Set(found)];
}

// 달력 칸에는 날짜가 이미 보이므로, 글 맨 앞의 날짜 표기를 떼고 내용만 남긴다.
// '3일간', '2일 후' 같은 기간 표현과 '8시부터11시까지' 같은 시각은 건드리지 않는다.
// 날짜만 있는 글은 지울 게 없으므로 원문 그대로 둔다.
const ONE = '(?:\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}|\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일(?![간동째차후전])|\\d{1,2}/\\d{1,2}'
          + '|(?:이번주|금주|다음주|담주|내주|지난주|저번주|전주)?\\s*[월화수목금토일]요일(?:부터|까지)?'
          + '|\\d{1,2}\\s*일(?![간동째차후전]))';
const LEADING_DATE = new RegExp('^\\s*' + ONE + '(?:\\s*[~\\-–—]\\s*' + ONE + '|[\\s,、·]+' + ONE + ')*', '');

function stripLeadingDate(text) {
  const str = String(text == null ? '' : text);
  const m = str.match(LEADING_DATE);
  if (!m) return str;
  const rest = str.slice(m[0].length).replace(/^[\s,、·:：\-~]+/, '');
  return rest ? rest : str;      // 날짜뿐이면 원문 유지
}

module.exports = { extractDates, ymd, addDays, stripLeadingDate };
