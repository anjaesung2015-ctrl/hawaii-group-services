const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';
const { requireAdmin } = require('../auth');

function mockReq(token, headers = {}) {
  return { cookies: token ? { token } : {}, headers, ip: '127.0.0.1' };
}
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  return res;
}

test('토큰 없음 → 401 NO_TOKEN', () => {
  const res = mockRes(); let next = false;
  requireAdmin(mockReq(null), res, () => { next = true; });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.error_code, 'NO_TOKEN');
  assert.strictEqual(next, false);
});

test('유효한 admin 토큰 → next + req.user 세팅', () => {
  const token = jwt.sign({ sub: 'u1', email: 'a@b.com', role: 'super_admin' }, 'test-secret');
  const req = mockReq(token); const res = mockRes(); let next = false;
  requireAdmin(req, res, () => { next = true; });
  assert.strictEqual(next, true);
  assert.deepStrictEqual(req.user, { id: 'u1', email: 'a@b.com', role: 'super_admin' });
});

test('role 없음 → 403', () => {
  const token = jwt.sign({ sub: 'u1', email: 'a@b.com', role: 'guest' }, 'test-secret');
  const res = mockRes(); let next = false;
  requireAdmin(mockReq(token), res, () => { next = true; });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(next, false);
});

test('만료 토큰 → 401 INVALID_TOKEN', () => {
  const token = jwt.sign({ sub: 'u1', role: 'manager' }, 'test-secret', { expiresIn: '-1s' });
  const res = mockRes(); let next = false;
  requireAdmin(mockReq(token), res, () => { next = true; });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.error_code, 'INVALID_TOKEN');
});
