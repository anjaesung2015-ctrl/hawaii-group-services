// translator-client.js — translator API 어댑터 (mn→ko 위주)
// API contract: POST http://127.0.0.1:6011/api/translate
//   body: { text, from, to }   (NOT source/target)
//   response: { translated }
const http = require('http');

const ENDPOINT = process.env.TRANSLATOR_URL || 'http://127.0.0.1:6011/api/translate';
const TIMEOUT_MS = 20000;
const CACHE_MAX = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return String(h >>> 0);
}

function isKorean(s) {
  if (!s) return false;
  const total = s.replace(/\s/g, '').length;
  if (!total) return false;
  const han = (s.match(/[가-힯]/g) || []).length;
  return han / total > 0.3;
}

function callApi(text, from = 'mn', to = 'ko') {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT);
    const body = JSON.stringify({ text, from, to });
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: TIMEOUT_MS
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('http ' + res.statusCode + ': ' + data.slice(0, 200)));
        }
        try {
          const j = JSON.parse(data);
          // translator returns { translated: "..." }
          const translated = j.translated || j.result || j.text || j.output || j.translation || '';
          if (!translated) reject(new Error('empty translation: ' + data.slice(0, 200)));
          else resolve(translated);
        } catch (e) {
          reject(new Error('parse fail: ' + e.message + ' raw=' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function isMongolian(s) {
  if (!s) return false;
  const total = s.replace(/\s/g, '').length;
  if (!total) return false;
  // Cyrillic block including Mongolian extras (Ө ө Ү ү)
  const cyr = (s.match(/[Ѐ-ӿԀ-ԯ]/g) || []).length;
  return cyr / total > 0.3;
}

async function translateCached(text, from, to) {
  if (!text || !text.trim()) return '';
  const h = `${from}:${to}:` + hashStr(text);
  const cached = cache.get(h);
  if (cached && cached.exp > Date.now()) return cached.text;
  const out = await callApi(text, from, to);
  cache.set(h, { text: out, exp: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return out;
}

async function translateMnKo(text) {
  if (!text || !text.trim()) return '';
  if (isKorean(text)) return text;
  return translateCached(text, 'mn', 'ko');
}

async function translateKoMn(text) {
  if (!text || !text.trim()) return '';
  if (isMongolian(text)) return text;
  return translateCached(text, 'ko', 'mn');
}

module.exports = { translateMnKo, translateKoMn, isKorean, isMongolian };
