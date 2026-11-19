// 채팅 — 사진 여러 장 묶어 보내기 + 읽은 사람 얼굴(seen)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeApp, loginAs } = require('./helper');
const { chatPhotoDir } = require('../lib/photos');

const JPG = (s) => 'data:image/jpeg;base64,' + Buffer.from(`fake-jpeg-${s}`).toString('base64');
const login = (app) => Promise.all([loginAs(app.base, '99000000', '1234'), loginAs(app.base, '88110044', '1111')]);
const getPhoto = async (c, url) => {   // c = { base, cookie }
  const r = await fetch(`${c.base}/${url.replace(/^api\//, '')}`, { headers: c.cookie ? { cookie: c.cookie } : {} });
  return { status: r.status, body: Buffer.from(await r.arrayBuffer()).toString() };
};

test('사진 여러 장을 한 메시지로 — 순서대로 열리고, 지우면 파일이 모두 사라진다', async () => {
  const app = makeApp();
  app.db.prepare('INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)').run(app.adminId, 'https://push/a', 'k', 'a');
  const [a, m] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;

  const r = await m.call(`/chat/rooms/${club}/messages`, { method: 'POST', body: { body: 'Today', photos: [JPG(1), JPG(2), JPG(3)] } });
  assert.strictEqual(r.status, 200);
  const id = r.data.id;
  assert.deepStrictEqual(r.data.photos, [`api/chat/photo/${id}`, `api/chat/photo/${id}?i=1`, `api/chat/photo/${id}?i=2`]);
  assert.strictEqual(r.data.photo, `api/chat/photo/${id}`, '첫 장은 예전 photo 칸에도');

  for (const [i, url] of r.data.photos.entries()) {
    const p = await getPhoto({ base: app.base, cookie: a.cookie }, url);
    assert.strictEqual(p.status, 200);
    assert.strictEqual(p.body, `fake-jpeg-${i + 1}`);
  }
  assert.strictEqual((await getPhoto({ base: app.base, cookie: a.cookie }, `api/chat/photo/${id}?i=3`)).status, 404, '없는 순서');

  const list = (await a.call(`/chat/rooms/${club}/messages`)).data.messages;
  assert.strictEqual(list.at(-1).photos.length, 3);
  await app.settle();
  const push = app.sent.find(s => s.member_id === app.adminId);
  assert.ok(push, '알림');
  assert.strictEqual(push.payload.body, 'Today');

  const files = JSON.parse(app.db.prepare('SELECT photos FROM chat_msg WHERE id=?').pluck().get(id));
  assert.strictEqual(files.length, 3);
  assert.strictEqual((await m.call(`/chat/messages/${id}`, { method: 'DELETE' })).status, 200);
  await new Promise(r => setTimeout(r, 200));
  for (const f of files) assert.ok(!fs.existsSync(path.join(chatPhotoDir(app.db), f)), '파일도 지움');
  await app.close?.();
});

test('사진은 10장까지, 한 장이라도 잘못되면 통째로 거절하고 파일을 남기지 않는다', async () => {
  const app = makeApp();
  const [, m] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;
  const dir = chatPhotoDir(app.db);
  const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;

  const many = await m.call(`/chat/rooms/${club}/messages`, { method: 'POST', body: { photos: Array.from({ length: 11 }, (_, i) => JPG(i)) } });
  assert.strictEqual(many.status, 400);
  assert.strictEqual(many.data.error, 'too_many_photos');

  const bad = await m.call(`/chat/rooms/${club}/messages`, { method: 'POST', body: { photos: [JPG(1), 'data:text/html;base64,PGgxPg=='] } });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.data.error, 'bad_photo');
  await new Promise(r => setTimeout(r, 200));   // 파일 지우기는 뒤에서(fs.rm 콜백)
  assert.strictEqual(fs.existsSync(dir) ? fs.readdirSync(dir).length : 0, before, '먼저 쓴 사진도 지움');
  assert.strictEqual(app.db.prepare('SELECT COUNT(*) FROM chat_msg').pluck().get(), 0);

  const ten = await m.call(`/chat/rooms/${club}/messages`, { method: 'POST', body: { photos: Array.from({ length: 10 }, (_, i) => JPG(i)) } });
  assert.strictEqual(ten.status, 200);
  assert.strictEqual(ten.data.photos.length, 10);
  await app.close?.();
});

test('읽은 사람 얼굴 — 나는 빼고, 이름·사진·어디까지 읽었는지', async () => {
  const app = makeApp();
  const [a, m] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;
  const send = (c, body) => c.call(`/chat/rooms/${club}/messages`, { method: 'POST', body: { body } });

  const one = (await send(m, 'first')).data.id;
  let seen = (await m.call(`/chat/rooms/${club}/messages`)).data.seen;
  assert.deepStrictEqual(seen, [], '아직 아무도 안 읽음 (나는 빼고)');

  await a.call(`/chat/rooms/${club}/messages`);   // 대표가 방을 연다
  const two = (await send(m, 'second')).data.id;
  seen = (await m.call(`/chat/rooms/${club}/messages`)).data.seen;
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].id, app.adminId);
  assert.strictEqual(seen[0].name, '대표');
  assert.strictEqual(seen[0].last_id, one, '두 번째 글은 아직 안 읽음');
  assert.ok('photo' in seen[0]);

  // 폴링(?after)에도 온다
  await a.call(`/chat/rooms/${club}/messages`);
  const poll = (await m.call(`/chat/rooms/${club}/messages?after=${two}&from=${one}`)).data;
  assert.strictEqual(poll.seen[0].last_id, two);

  // 1:1 방도 — 상대만
  const dm = (await m.call('/chat/dm', { method: 'POST', body: { member_id: app.adminId } })).data.id;
  await m.call(`/chat/rooms/${dm}/messages`, { method: 'POST', body: { body: 'hi' } });
  assert.deepStrictEqual((await m.call(`/chat/rooms/${dm}/messages`)).data.seen, []);
  await a.call(`/chat/rooms/${dm}/messages`);
  assert.deepStrictEqual((await m.call(`/chat/rooms/${dm}/messages`)).data.seen.map(p => p.id), [app.adminId]);
  await app.close?.();
});
