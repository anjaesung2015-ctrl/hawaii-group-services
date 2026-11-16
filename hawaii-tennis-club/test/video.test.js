// 사진첩 동영상 — 누구나 1분·50MB 까지, 첫 장면(poster) 필수, 지우면 영상 파일도, 홈 피드에 나온다
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeApp, loginAs } = require('./helper');

const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAADAAEAAQBPR+8AAAAASUVORK5CYII=';
const up = (app, p) => path.join(app.uploadDir, path.basename(p));
const files = (app) => (fs.existsSync(app.uploadDir) ? fs.readdirSync(app.uploadDir) : []);

function send(app, client, { bytes = 2000, type = 'video/mp4', duration = '12.5', poster = TINY, caption } = {}) {
  const fd = new FormData();
  if (caption) fd.append('caption', caption);
  if (duration != null) fd.append('duration', duration);
  if (poster) fd.append('poster', poster);
  if (bytes) fd.append('video', new Blob([Buffer.alloc(bytes, 7)], { type }), 'clip');
  return fetch(app.base + '/gallery/video', { method: 'POST', body: fd, headers: client ? { cookie: client.cookie } : {} })
    .then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
}

test('동영상 — 일반 회원이 올리면 사진첩·홈 피드에 영상+첫 장면으로 나오고 파일도 열린다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const r = await send(app, m, { caption: '  랠리 영상  ' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.video, /^uploads\/.+\.mp4$/);
  assert.strictEqual(fs.statSync(up(app, r.data.video)).size, 2000);

  const g = (await m.call('/gallery')).data.rows[0];
  assert.strictEqual(g.video, r.data.video);
  assert.strictEqual(g.duration, 12.5);
  assert.strictEqual(g.caption, '랠리 영상');
  assert.match(g.photo, /^uploads\//);

  const f = (await m.call('/feed')).data.rows[0];
  assert.strictEqual(f.type, 'photo');
  assert.strictEqual(f.video, r.data.video);
  assert.strictEqual(f.duration, 12.5);

  // 영상 파일은 로그인한 회원에게, 앞부분만 달라고 하면(Range) 그만큼만 — 폰 영상 재생에 필요
  const res = await fetch(app.base.replace('/api', '/') + g.video, { headers: { cookie: m.cookie, Range: 'bytes=0-99' } });
  assert.strictEqual(res.status, 206);
  assert.strictEqual((await res.arrayBuffer()).byteLength, 100);
  assert.strictEqual((await fetch(app.base.replace('/api', '/') + g.video)).status, 401);
  app.close();
});

test('동영상 — 너무 크거나 길거나 영상이 아니거나 첫 장면이 없으면 거절, 파일도 안 남는다', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  process.env.VIDEO_MAX_BYTES = '5000';
  try {
    const big = await send(app, m, { bytes: 6000 });
    assert.deepStrictEqual([big.status, big.data.error], [413, 'video_too_big']);
  } finally { delete process.env.VIDEO_MAX_BYTES; }
  assert.strictEqual((await send(app, m, { duration: '75' })).data.error, 'video_too_long');
  assert.strictEqual((await send(app, m, { duration: null })).data.error, 'bad_video');
  assert.strictEqual((await send(app, m, { type: 'application/pdf' })).data.error, 'bad_video');
  assert.strictEqual((await send(app, m, { poster: null })).data.error, 'poster_required');
  assert.strictEqual((await send(app, m, { poster: 'data:text/plain;base64,aGk=' })).data.error, 'bad_photo');
  assert.strictEqual((await send(app, m, { bytes: 0 })).data.error, 'video_required');
  await app.settle();
  assert.deepStrictEqual(files(app), []);
  assert.strictEqual((await m.call('/gallery')).data.total, 0);
  assert.strictEqual((await send(app, null)).status, 401);
  app.close();
});

test('동영상 — 지우면 영상과 첫 장면 파일이 모두 사라진다 (올린 사람·운영진만)', async () => {
  const app = makeApp();
  const m = await loginAs(app.base, '88110044', '1111');
  const a = await loginAs(app.base, '99000000', '1234');
  const { id, video, photo } = (await send(app, a)).data;
  assert.strictEqual((await m.call(`/gallery/${id}`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await a.call(`/gallery/${id}`, { method: 'DELETE' })).status, 200);
  await app.settle();
  assert.ok(!fs.existsSync(up(app, video)));
  assert.ok(!fs.existsSync(up(app, photo)));
  app.close();
});
