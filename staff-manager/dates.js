// 글 속 날짜 인식 — 달력·알람이 함께 쓴다
// 지원: 2026-08-15 / 2026.8.15 / 8월 15일 / 8/15 / 범위(8/15~8/20, 8월 15일~20일)
// 일부러 지원 안 함: '8월'처럼 일이 없는 것(달 전체를 칠하지 않는다), 9:30 시각, 100/5 비율
const DATE_TOKEN = new RegExp(
  '(\\d{4})[-./](\\d{1,2})[-./](\\d{1,2})' +          // 1,2,3 : 연-월-일
  '|(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일' +            // 4,5   : M월 D일
  '|(?<![\\d:/.])(\\d{1,2})/(\\d{1,2})(?![\\d:/.])' +  // 6,7   : M/D
  '|(\\d{1,2})\\s*일',                                 // 8     : D일 (범위 뒤쪽에서만 씀)
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

function extractDates(text, defaultYear) {
  if (!text) return [];
  const str = String(text);
  const hits = [];
  DATE_TOKEN.lastIndex = 0;
  let m;
  while ((m = DATE_TOKEN.exec(str)) !== null) {
    const at = { start: m.index, end: m.index + m[0].length };
    if (m[1]) hits.push({ kind: 'full', y: +m[1], m: +m[2], d: +m[3], ...at });
    else if (m[4]) hits.push({ kind: 'md', y: defaultYear, m: +m[4], d: +m[5], ...at });
    else if (m[6]) hits.push({ kind: 'md', y: defaultYear, m: +m[6], d: +m[7], ...at });
    else hits.push({ kind: 'dayonly', d: +m[8], ...at });
  }

  const found = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (h.kind === 'dayonly') continue;              // 홀로 있는 'D일'은 무시
    const a = ymd(h.y, h.m, h.d);
    if (!a) continue;
    found.push(a);
    const nxt = hits[i + 1];
    if (!nxt) continue;
    const gap = str.slice(h.end, nxt.start);

    if (/^\s*[~\-–—]\s*$/.test(gap)) {                // 물결/하이픈이면 범위
      const b = nxt.kind === 'dayonly' ? ymd(h.y, h.m, nxt.d) : ymd(nxt.y, nxt.m, nxt.d);
      if (!b || b <= a) continue;
      for (let cur = addDays(a, 1), guard = 0; cur <= b && guard < 62; cur = addDays(cur, 1), guard++) found.push(cur);
      i++;                                            // 범위 끝 토큰 소비
      continue;
    }

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
const ONE = '(?:\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}|\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일(?![간동째차후전])|\\d{1,2}/\\d{1,2}|\\d{1,2}\\s*일(?![간동째차후전]))';
const LEADING_DATE = new RegExp('^\\s*' + ONE + '(?:\\s*[~\\-–—]\\s*' + ONE + '|[\\s,、·]+' + ONE + ')*', '');

function stripLeadingDate(text) {
  const str = String(text == null ? '' : text);
  const m = str.match(LEADING_DATE);
  if (!m) return str;
  const rest = str.slice(m[0].length).replace(/^[\s,、·:：\-~]+/, '');
  return rest ? rest : str;      // 날짜뿐이면 원문 유지
}

module.exports = { extractDates, ymd, addDays, stripLeadingDate };
