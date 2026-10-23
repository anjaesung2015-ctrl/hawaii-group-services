// 화면 파일(public/) 버전 지문 — 배포로 파일이 하나라도 바뀌면 값이 바뀐다.
// 폰에 열려 있는 앱이 이 값을 가끔 물어보고, 바뀌었으면 스스로 새로고침한다(public/js/update.js).
// 서버를 재시작하지 않고 파일만 바꿔도 잡히도록 매번 다시 보되, 잠깐(10초)은 기억해 둔다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEMO_MS = 10 * 1000;

function createVersion(dir) {
  let memo = null;
  let at = 0;

  function walk(d, out) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.isFile()) {
        const st = fs.statSync(p);
        out.push(`${path.relative(dir, p)}:${st.size}:${st.mtimeMs}`);
      }
    }
    return out;
  }

  return function version() {
    if (memo && Date.now() - at < MEMO_MS) return memo;
    const list = walk(dir, []).sort();
    memo = crypto.createHash('sha1').update(list.join('\n')).digest('hex').slice(0, 12);
    at = Date.now();
    return memo;
  };
}

module.exports = { createVersion };
