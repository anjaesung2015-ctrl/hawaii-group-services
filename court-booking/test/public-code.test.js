const test = require('node:test');
const assert = require('node:assert');
const { generate, isValid } = require('../public-code');

test('generate produces BK + 4 chars from base32 alphabet', () => {
  const code = generate();
  assert.match(code, /^BK[2-9A-HJKMNPQRSTUVWXYZ]{4}$/);
});

test('isValid accepts generated codes', () => {
  for (let i = 0; i < 100; i++) {
    assert.strictEqual(isValid(generate()), true);
  }
});

test('isValid rejects bad inputs', () => {
  assert.strictEqual(isValid('BK000O'), false);   // 0, O 제외
  assert.strictEqual(isValid('XX1234'), false);   // BK 접두 아님
  assert.strictEqual(isValid('BK123'), false);    // 길이
  assert.strictEqual(isValid(''), false);
  assert.strictEqual(isValid(null), false);
});

test('generate is sufficiently random (100k unique)', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(generate());
  assert.ok(seen.size >= 95, `too many collisions: ${seen.size}/100`);
});
