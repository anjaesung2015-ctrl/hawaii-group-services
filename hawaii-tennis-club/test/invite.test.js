// 초대 링크 QR — 이 사이트 주소만 그려 준다
const test = require('node:test');
const assert = require('node:assert');
const { makeApp } = require('./helper');

test('초대 QR — 같은 호스트 주소는 SVG, 다른 사이트 주소나 이상한 값은 400', async () => {
  const app = makeApp();
  const host = new URL(app.base).host;
  const ok = await fetch(`${app.base}/invite/qr.svg?u=${encodeURIComponent(`http://${host}/booking/#join`)}`);
  assert.strictEqual(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await ok.text(), /^<svg/);
  for (const u of ['https://evil.example/#join', 'javascript:alert(1)', 'not a url', `http://${host}/${'x'.repeat(400)}`]) {
    const r = await fetch(`${app.base}/invite/qr.svg?u=${encodeURIComponent(u)}`);
    assert.strictEqual(r.status, 400, u.slice(0, 40));
  }
  app.close();
});
