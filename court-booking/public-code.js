// Crockford-style base32 (혼동 문자 0/O, 1/I/L 제외)
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PATTERN = /^BK[2-9A-HJKMNPQRSTUVWXYZ]{4}$/;

function randomChar() {
  return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
}

function generate() {
  let s = 'BK';
  for (let i = 0; i < 4; i++) s += randomChar();
  return s;
}

function isValid(code) {
  return typeof code === 'string' && PATTERN.test(code);
}

// DB 충돌 시 재시도 (호출자가 lookupFn 제공)
function generateUnique(lookupFn, maxRetry = 10) {
  for (let i = 0; i < maxRetry; i++) {
    const code = generate();
    if (!lookupFn(code)) return code;
  }
  throw new Error('PUBLIC_CODE_EXHAUSTED');
}

module.exports = { generate, isValid, generateUnique };
