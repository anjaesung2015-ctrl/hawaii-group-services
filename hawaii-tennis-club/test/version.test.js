// 화면 파일 버전 — 파일이 바뀌면 값이 바뀌어야 열려 있는 앱이 새로고침한다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createVersion } = require('../lib/version');

test('버전 — 같은 파일이면 그대로, 파일을 고치거나 더하면 바뀐다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htc-ver-'));
  fs.mkdirSync(path.join(dir, 'js'));
  fs.writeFileSync(path.join(dir, 'js', 'a.js'), 'one');
  const v1 = createVersion(dir)();
  assert.strictEqual(createVersion(dir)(), v1, '안 바뀌었는데 값이 달라졌다');
  fs.writeFileSync(path.join(dir, 'js', 'a.js'), 'two!');
  const v2 = createVersion(dir)();
  assert.notStrictEqual(v2, v1);
  fs.writeFileSync(path.join(dir, 'b.css'), 'x');
  assert.notStrictEqual(createVersion(dir)(), v2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('화면이 버전을 물어보는 곳은 상대 경로이고, 서버 라우트가 있다', () => {
  const pub = path.join(__dirname, '..', 'public');
  assert.match(fs.readFileSync(path.join(pub, 'js', 'update.js'), 'utf8'), /fetch\('api\/version'/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'), /app\.get\('\/api\/version'/);
  assert.match(fs.readFileSync(path.join(pub, 'js', 'app.js'), 'utf8'), /initUpdate\(\)/);
});
