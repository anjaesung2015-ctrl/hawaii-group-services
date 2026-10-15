// 제목에서 요일 읽어내기 — "수요일모임" → 수요일
const test = require('node:test');
const assert = require('node:assert');

// 0=일 1=월 2=화 3=수 4=목 5=금 6=토
const 일 = 0, 월 = 1, 화 = 2, 수 = 3, 목 = 4, 금 = 5, 토 = 6;

test('X요일 — 사장님 예시', async () => {
  const { weekdaysFromText } = await import('../public/js/weekdays.js');
  assert.deepStrictEqual(weekdaysFromText('수요일모임'), [수]);
  assert.deepStrictEqual(weekdaysFromText('수요일 모임'), [수]);
  assert.deepStrictEqual(weekdaysFromText('토요일 정기모임'), [토]);
  assert.deepStrictEqual(weekdaysFromText('일요일 아침 운동'), [일]);
});

test('한 제목에 요일이 여러 개', async () => {
  const { weekdaysFromText } = await import('../public/js/weekdays.js');
  assert.deepStrictEqual(weekdaysFromText('화요일 목요일 모임'), [화, 목]);
  assert.deepStrictEqual(weekdaysFromText('화목 정기모임'), [화, 목]);
  assert.deepStrictEqual(weekdaysFromText('월수금 레슨'), [월, 수, 금]);
  assert.deepStrictEqual(weekdaysFromText('화·목 모임'), [화, 목]);
  assert.deepStrictEqual(weekdaysFromText('화, 목 저녁'), [화, 목]);
});

test('매주 — 한 글자도 인정', async () => {
  const { weekdaysFromText } = await import('../public/js/weekdays.js');
  assert.deepStrictEqual(weekdaysFromText('매주 수 저녁 모임'), [수]);
  assert.deepStrictEqual(weekdaysFromText('매주 화목'), [화, 목]);
  assert.deepStrictEqual(weekdaysFromText('매 금요일'), [금]);
});

test('주말 · 평일', async () => {
  const { weekdaysFromText } = await import('../public/js/weekdays.js');
  assert.deepStrictEqual(weekdaysFromText('주말 번개모임'), [일, 토]);
  assert.deepStrictEqual(weekdaysFromText('평일 오전 레슨'), [월, 화, 수, 목, 금]);
});

test('몽골어 요일', async () => {
  const { weekdaysFromText } = await import('../public/js/weekdays.js');
  assert.deepStrictEqual(weekdaysFromText('Лхагва гарагийн цугларалт'), [수]);
  assert.deepStrictEqual(weekdaysFromText('Мягмар, пүрэв гарагт'), [화, 목]);
  assert.deepStrictEqual(weekdaysFromText('Бямба гарагийн тэмцээн'), [토]);
  assert.deepStrictEqual(weekdaysFromText('ням гарагт'), [일]);
  assert.deepStrictEqual(weekdaysFromText('Хагас сайн өдрийн цугларалт'), [토]);
});

test('요일이 아닌 것을 요일로 보지 않는다', async () => {
  const { weekdaysFromText } = await import('../public/js/weekdays.js');
  const cases = [
    '11월 정기모임',          // 달 이름
    '3개월 기념',
    '목표 세우기',            // 목
    '화목한 클럽 만들기',      // 화목 + 한글이 이어짐
    '수고하셨습니다',          // 수
    '금연 캠페인',            // 금
    '토너먼트 준비',          // 토
    '일단 모여요',            // 일
    '내부 대회',
    'Hawaiiclubday',
    '',
  ];
  for (const c of cases) {
    assert.deepStrictEqual(weekdaysFromText(c), [], `잘못 인식: ${c}`);
  }
});

test('같은 요일을 두 번 적어도 한 번만', async () => {
  const { weekdaysFromText } = await import('../public/js/weekdays.js');
  assert.deepStrictEqual(weekdaysFromText('수요일 모임 (매주 수)'), [수]);
});

test('요일 번호는 작은 것부터 (일요일이 0)', async () => {
  const { weekdaysFromText } = await import('../public/js/weekdays.js');
  assert.deepStrictEqual(weekdaysFromText('토요일 일요일 합동'), [일, 토]);
});

test('nextDateFor — 그 요일이 처음 오는 날', async () => {
  const { nextDateFor } = await import('../public/js/weekdays.js');
  // 2026-10-15 는 목요일
  assert.strictEqual(nextDateFor(목, '2026-10-15'), '2026-10-15', '오늘이 그 요일이면 오늘');
  assert.strictEqual(nextDateFor(금, '2026-10-15'), '2026-10-16');
  assert.strictEqual(nextDateFor(수, '2026-10-15'), '2026-10-21', '한 주 뒤 수요일');
  assert.strictEqual(nextDateFor(일, '2026-10-15'), '2026-10-18');
});

test('달이 바뀌어도 날짜 계산이 맞다', async () => {
  const { nextDateFor } = await import('../public/js/weekdays.js');
  // 2026-10-31 은 토요일
  assert.strictEqual(nextDateFor(월, '2026-10-31'), '2026-11-02');
  assert.strictEqual(nextDateFor(토, '2026-12-31'), '2027-01-02');
});

test('서버의 반복 등록이 이 요일 번호를 그대로 받는다', async () => {
  const { weekdaysFromText } = await import('../public/js/weekdays.js');
  const { makeApp, loginAs } = require('./helper');
  const app = makeApp();
  const a = await loginAs(app.base, '99000000', '1234');

  const days = weekdaysFromText('수요일모임');
  const r = await a.call('/events/bulk', {
    method: 'POST',
    body: { title: '수요일모임', kind: 'regular', start_time: '19:00', end_time: '21:00',
            from: '2026-11-01', to: '2026-11-30', weekdays: days },
  });
  // 2026년 11월 수요일: 4·11·18·25
  assert.deepStrictEqual(r.data.dates, ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
  app.close();
});
