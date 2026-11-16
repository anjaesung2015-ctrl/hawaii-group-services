// 공지·게시판·팝업·홈 피드 — 원문을 크게, 영어 번역을 작게 (2026-11-16)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('origText — 원문이 크게, 번역은 다를 때만 작게', async () => {
  const { origText } = await import('../public/js/ui.js');
  assert.deepStrictEqual(origText({ body: '안녕', body_tr: 'Hello' }, 'body'), { text: '안녕', orig: 'Hello' });
  assert.deepStrictEqual(origText({ body: 'Hello', body_tr: 'Hello' }, 'body'), { text: 'Hello', orig: null });
  assert.deepStrictEqual(origText({ body: '안녕' }, 'body'), { text: '안녕', orig: null });
  assert.deepStrictEqual(origText({}, 'body'), { text: '', orig: null });
});

test('공지·게시판·홈 피드·팝업은 원문 크게(origText), 일정은 그대로(trText)', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', f), 'utf8');
  for (const f of ['notices.js', 'board.js', 'home.js', 'popup.js']) {
    assert.match(read(f), /origText\(/, f);
    assert.doesNotMatch(read(f), /trText\(/, f);
  }
  assert.match(read('schedule.js'), /trText\(/);
});
