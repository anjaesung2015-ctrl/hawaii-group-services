// 제목에서 요일을 읽어낸다. "수요일 모임" → 수요일(3), "화목 정기모임" → 화·목.
// 0=일 … 6=토 (서버의 weekdays 와 같은 번호)
//
// 조심할 것: 한국어 요일 글자는 다른 말에도 흔히 섞인다("11월", "3개월", "목표", "화목한").
// 그래서 다음 세 가지 꼴만 요일로 본다.
//   1) X요일        — 수요일, 토요일
//   2) 매주/매 + X  — 매주 수, 매주 화목
//   3) 두 글자 이상이 홀로 붙어 있을 때 — "화목 모임", "월수금"
// 한 글자가 홀로 있는 것(그냥 "수")은 요일로 보지 않는다.

const KO = ['일', '월', '화', '수', '목', '금', '토'];

// 몽골어 요일 (어간만 — 뒤에 -гараг, -д 등이 붙어도 걸린다)
const MN = [
  [0, ['ням', 'бүтэн сайн']],
  [1, ['даваа']],
  [2, ['мягмар']],
  [3, ['лхагва']],
  [4, ['пүрэв']],
  [5, ['баасан']],
  [6, ['бямба', 'хагас сайн']],
];

const HANGUL = /[가-힣]/;

export function weekdaysFromText(text) {
  const s = String(text || '');
  const found = new Set();

  // 1) 'X요일'
  for (const m of s.matchAll(/([일월화수목금토])\s*요일/g)) found.add(KO.indexOf(m[1]));

  // 2) '매주 …' / '매 …' 뒤에 붙은 요일 글자들 (한 글자여도 인정)
  for (const m of s.matchAll(/매\s*주?\s*([일월화수목금토]+)/g)) {
    for (const ch of m[1]) found.add(KO.indexOf(ch));
  }

  // 3) 요일 글자가 두 개 이상 홀로 붙어 있을 때 ('화목', '월수금', '화·목')
  for (const m of s.matchAll(/[일월화수목금토](?:\s*[·,\/]?\s*[일월화수목금토])+/g)) {
    const before = s[m.index - 1];
    const after = s[m.index + m[0].length];
    // 앞뒤에 다른 한글이 붙어 있으면 요일이 아니다 ('화목한', '목요일수업')
    if (HANGUL.test(before || '') || HANGUL.test(after || '')) continue;
    if (/\d/.test(before || '')) continue;                  // '11월' 같은 것
    for (const ch of m[0].replace(/[^일월화수목금토]/g, '')) found.add(KO.indexOf(ch));
  }

  // 주말 · 평일
  if (/주말/.test(s)) { found.add(0); found.add(6); }
  if (/평일/.test(s)) { for (let d = 1; d <= 5; d += 1) found.add(d); }
  if (/амралтын өдөр/i.test(s)) { found.add(0); found.add(6); }

  // 몽골어 요일 이름
  const low = s.toLowerCase();
  for (const [idx, words] of MN) {
    if (words.some(w => low.includes(w))) found.add(idx);
  }

  return [...found].filter(d => d >= 0).sort((a, b) => a - b);
}

// 주어진 날짜(또는 그 이후)에서 그 요일이 처음 오는 날
export function nextDateFor(weekday, fromIso) {
  const [y, m, d] = String(fromIso).split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 7; i += 1) {
    const t = base + i * 86400000;
    if (new Date(t).getUTCDay() === weekday) return new Date(t).toISOString().slice(0, 10);
  }
  return fromIso;
}
