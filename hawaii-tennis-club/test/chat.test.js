// 채팅 — 클럽 전체방 + 1:1
const test = require('node:test');
const assert = require('node:assert');
const { makeApp, loginAs } = require('./helper');

// 세 번째 회원 + 세 사람 모두 폰 알림 구독
function setup() {
  const app = makeApp();
  const third = app.db.prepare(`INSERT INTO member (name, phone, pin_hash, role, level, status, joined_at)
                                VALUES ('Сарнай','95550001',?,'member','beginner','active','2026-05-01')`)
    .run(app.dbmod.hashPin('2222')).lastInsertRowid;
  for (const id of [app.adminId, app.memberId, third]) {
    app.db.prepare('INSERT INTO push_sub (member_id, endpoint, p256dh, auth) VALUES (?,?,?,?)').run(id, `https://push/${id}`, 'k', 'a');
  }
  return { app, third };
}
const login = (app) => Promise.all([
  loginAs(app.base, '99000000', '1234'),
  loginAs(app.base, '88110044', '1111'),
  loginAs(app.base, '95550001', '2222'),
]);
const send = (c, room, body) => c.call(`/chat/rooms/${room}/messages`, { method: 'POST', body: { body } });
const recipients = (app) => app.sent.map(s => s.member_id).sort();

test('전체방은 처음부터 있고 누구나 쓰고 읽는다', async () => {
  const { app } = setup();
  const [a, m] = await login(app);
  const rooms = (await m.call('/chat/rooms')).data;
  assert.strictEqual(rooms.length, 1);
  assert.strictEqual(rooms[0].kind, 'club');
  const club = rooms[0].id;

  const r = await send(a, club, '  Hello everyone  ');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.body, 'Hello everyone');
  assert.strictEqual(r.data.mine, true);

  const got = (await m.call(`/chat/rooms/${club}/messages`)).data;
  assert.strictEqual(got.messages.length, 1);
  assert.strictEqual(got.messages[0].name, '대표');
  assert.strictEqual(got.messages[0].mine, false);
  app.close();
});

test('안 읽은 수 — 남이 보낸 것만 세고, 방을 열면 0', async () => {
  const { app } = setup();
  const [a, m] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;
  await send(a, club, 'one');
  await send(a, club, 'two');
  assert.strictEqual((await m.call('/chat/unread')).data.count, 2);
  assert.strictEqual((await a.call('/chat/unread')).data.count, 0, '내가 보낸 건 안 읽은 게 아니다');
  await m.call(`/chat/rooms/${club}/messages`);
  assert.strictEqual((await m.call('/chat/unread')).data.count, 0);
  app.close();
});

test('?after= 는 그 뒤 새 메시지만, ?before= 는 더 옛날 것', async () => {
  const { app } = setup();
  const [a, m] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;
  const ids = [];
  for (let i = 0; i < 55; i++) ids.push((await send(a, club, `msg ${i}`)).data.id);

  const first = (await m.call(`/chat/rooms/${club}/messages`)).data;
  assert.strictEqual(first.messages.length, 50);
  assert.strictEqual(first.has_more, true);
  assert.strictEqual(first.messages.at(-1).body, 'msg 54', '오래된 것→새 것 순서');

  const older = (await m.call(`/chat/rooms/${club}/messages?before=${first.messages[0].id}`)).data;
  assert.strictEqual(older.messages.length, 5);
  assert.strictEqual(older.messages[0].body, 'msg 0');

  const newer = (await m.call(`/chat/rooms/${club}/messages?after=${ids[52]}`)).data;
  assert.deepStrictEqual(newer.messages.map(x => x.body), ['msg 53', 'msg 54']);
  app.close();
});

test('1:1 방 — 누가 먼저 걸어도 같은 방, 남은 못 본다', async () => {
  const { app, third } = setup();
  const [a, m, s] = await login(app);
  const r1 = (await m.call('/chat/dm', { method: 'POST', body: { member_id: app.adminId } })).data.id;
  const r2 = (await a.call('/chat/dm', { method: 'POST', body: { member_id: app.memberId } })).data.id;
  assert.strictEqual(r1, r2);

  assert.strictEqual((await m.call('/chat/rooms')).data.length, 1, '말을 안 건 1:1 방은 목록에 없다');
  await send(m, r1, 'Coach, lesson tomorrow?');
  const rooms = (await a.call('/chat/rooms')).data;
  assert.strictEqual(rooms.length, 2);
  assert.strictEqual(rooms[1].other.name, 'Батбаяр');
  assert.strictEqual(rooms[1].unread, 1);

  assert.strictEqual((await s.call(`/chat/rooms/${r1}/messages`)).status, 404, '제3자는 1:1 방을 못 연다');
  assert.strictEqual((await send(s, r1, 'hi')).status, 404);
  assert.ok(!(await s.call('/chat/rooms')).data.some(r => r.id === r1));
  assert.ok(third);
  app.close();
});

test('1:1 — 나 자신·없는 회원·탈퇴 회원과는 못 연다', async () => {
  const { app, third } = setup();
  const [, m] = await login(app);
  assert.strictEqual((await m.call('/chat/dm', { method: 'POST', body: { member_id: app.memberId } })).status, 400);
  assert.strictEqual((await m.call('/chat/dm', { method: 'POST', body: { member_id: 9999 } })).status, 404);
  app.db.prepare("UPDATE member SET status='dormant' WHERE id=?").run(third);
  assert.strictEqual((await m.call('/chat/dm', { method: 'POST', body: { member_id: third } })).status, 404);
  app.close();
});

test('빈 메시지·너무 긴 메시지는 400', async () => {
  const { app } = setup();
  const [, m] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;
  assert.strictEqual((await send(m, club, '   ')).status, 400);
  assert.strictEqual((await send(m, club, 'x'.repeat(1001))).status, 400);
  app.close();
});

test('알림 — 1:1 은 상대만, 전체방은 나 빼고 전원', async () => {
  const { app, third } = setup();
  const [a, m] = await login(app);
  const dm = (await m.call('/chat/dm', { method: 'POST', body: { member_id: app.adminId } })).data.id;
  await send(m, dm, 'hi coach');
  await app.settle();
  assert.deepStrictEqual(recipients(app), [app.adminId]);
  assert.strictEqual(app.sent[0].payload.url, `#chat-${dm}`);
  assert.match(app.sent[0].payload.title, /Батбаяр/);

  app.sent.length = 0;
  const club = (await a.call('/chat/rooms')).data[0].id;
  await send(a, club, 'Court 3 is open');
  await app.settle();
  assert.deepStrictEqual(recipients(app), [app.memberId, third].sort());
  app.close();
});

test('알림 — 지금 그 방을 보고 있는 사람에게는 안 보낸다', async () => {
  const { app, third } = setup();
  const [a, m] = await login(app);
  const club = (await a.call('/chat/rooms')).data[0].id;
  await m.call(`/chat/rooms/${club}/messages`);       // 회원 m 이 방을 열어 둔 상태
  await send(a, club, 'anyone here?');
  await app.settle();
  assert.deepStrictEqual(recipients(app), [third]);
  app.close();
});

test('지우기 — 쓴 사람만, 전체방은 임원도', async () => {
  const { app } = setup();
  const [a, m, s] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;
  const mine = (await send(m, club, 'oops')).data.id;
  const other = (await send(s, club, 'spam')).data.id;

  assert.strictEqual((await m.call(`/chat/messages/${other}`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await m.call(`/chat/messages/${mine}`, { method: 'DELETE' })).status, 200);
  assert.strictEqual((await a.call(`/chat/messages/${other}`, { method: 'DELETE' })).status, 200, '임원은 전체방 글을 지운다');
  assert.strictEqual((await m.call(`/chat/rooms/${club}/messages`)).data.messages.length, 0);

  // 1:1 방 글은 임원이라도 남의 것을 못 지운다(방에 못 들어가므로 404)
  const dm = (await m.call('/chat/dm', { method: 'POST', body: { member_id: app.memberId + 1 } })).data.id;
  const priv = (await send(m, dm, 'private')).data.id;
  assert.strictEqual((await a.call(`/chat/messages/${priv}`, { method: 'DELETE' })).status, 404);
  app.close();
});

test('회원을 지우면 1:1 방은 사라지고 전체방 글은 남는다', async () => {
  const { app } = setup();
  const [a, m] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;
  await send(m, club, 'bye all');
  const dm = (await m.call('/chat/dm', { method: 'POST', body: { member_id: app.adminId } })).data.id;
  await send(m, dm, 'bye coach');

  assert.strictEqual((await a.call(`/members/${app.memberId}`, { method: 'DELETE' })).status, 200);
  const msgs = (await a.call(`/chat/rooms/${club}/messages`)).data.messages;
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].member_id, null);
  assert.strictEqual((await a.call(`/chat/rooms/${dm}/messages`)).status, 404);
  app.close();
});

test('로그인 안 하면 채팅 API 는 401', async () => {
  const { app } = setup();
  const r = await fetch(`${app.base}/chat/rooms`);
  assert.strictEqual(r.status, 401);
  app.close();
});

// ---- 사진 ----
const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR } = require('../lib/photos');
const JPG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');

test('사진만, 또는 사진+설명을 보낸다 — 파일로 저장되고 지우면 파일도 사라진다', async () => {
  const { app } = setup();
  const [a, m] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;

  const only = await m.call(`/chat/rooms/${club}/messages`, { method: 'POST', body: { photo: JPG } });
  assert.strictEqual(only.status, 200);
  assert.match(only.data.photo, /^uploads\/.+\.jpg$/, '앞에 / 없는 상대 경로');
  assert.strictEqual(only.data.body, '');
  const file = path.join(UPLOAD_DIR, path.basename(only.data.photo));
  assert.ok(fs.existsSync(file));

  const cap = await m.call(`/chat/rooms/${club}/messages`, { method: 'POST', body: { body: 'Our court today', photo: JPG } });
  assert.strictEqual(cap.data.body, 'Our court today');
  assert.ok(cap.data.photo);

  const list = (await a.call(`/chat/rooms/${club}/messages`)).data.messages;
  assert.deepStrictEqual(list.map(x => [x.body, !!x.photo]), [['', true], ['Our court today', true]]);

  await m.call(`/chat/messages/${only.data.id}`, { method: 'DELETE' });
  await new Promise(r => setTimeout(r, 50));
  assert.ok(!fs.existsSync(file), '지운 메시지의 사진 파일이 남았다');
  await m.call(`/chat/messages/${cap.data.id}`, { method: 'DELETE' });
  app.close();
});

test('사진만 보내면 알림 본문은 📷 Photo', async () => {
  const { app } = setup();
  const [a, m] = await login(app);
  const dm = (await m.call('/chat/dm', { method: 'POST', body: { member_id: app.adminId } })).data.id;
  const r = await m.call(`/chat/rooms/${dm}/messages`, { method: 'POST', body: { photo: JPG } });
  await app.settle();
  assert.strictEqual(app.sent[0].payload.body, '📷 Photo');
  await m.call(`/chat/messages/${r.data.id}`, { method: 'DELETE' });
  assert.ok(a);
  app.close();
});

test('사진이 아닌 것·너무 큰 사진은 400', async () => {
  const { app } = setup();
  const [, m] = await login(app);
  const club = (await m.call('/chat/rooms')).data[0].id;
  const bad = await m.call(`/chat/rooms/${club}/messages`, { method: 'POST', body: { photo: 'data:text/html;base64,PGgxPg==' } });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.data.error, 'bad_photo');
  const big = 'data:image/jpeg;base64,' + Buffer.alloc(3 * 1024 * 1024 + 10).toString('base64');
  const r = await m.call(`/chat/rooms/${club}/messages`, { method: 'POST', body: { photo: big } });
  assert.ok(r.status === 400 || r.status === 413);
  assert.strictEqual((await m.call(`/chat/rooms/${club}/messages`)).data.messages.length, 0, '실패하면 메시지도 안 남는다');
  app.close();
});
