// 회칙 — 누구나 읽을 수 있다(가입하려는 사람이 읽고 동의해야 하니까). 고치는 것은 관리자만.
const express = require('express');

const LANGS = ['ko', 'mn'];

module.exports = function docRoutes(db, auth) {
  const router = express.Router();

  const get = (lang) => db.prepare('SELECT body, version, updated_at FROM doc WHERE key=? AND lang=?').get('rules', lang);

  // 로그인 없이도 읽힌다 — 회칙은 비밀이 아니고, 가입 전에 읽어야 한다
  router.get('/rules', (req, res) => {
    const lang = LANGS.includes(req.query.lang) ? req.query.lang : 'ko';
    const row = get(lang) || get('ko');
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ lang, body: row.body, version: row.version, updated_at: row.updated_at });
  });

  // 개정 (부칙 제2조 — 임원 회의 제안, 클럽 오너 승인). 고치면 판 번호가 1 올라간다.
  router.put('/rules', auth.requireAdmin, (req, res) => {
    const lang = LANGS.includes(req.body?.lang) ? req.body.lang : null;
    const body = String(req.body?.body || '').trim();
    if (!lang) return res.status(400).json({ error: 'bad_lang' });
    if (body.length < 50) return res.status(400).json({ error: 'body_required' });

    db.prepare(`INSERT INTO doc (key, lang, body, version, updated_at, updated_by)
                VALUES ('rules', ?, ?, 1, datetime('now','localtime'), ?)
                ON CONFLICT(key, lang) DO UPDATE SET
                  body = excluded.body,
                  version = doc.version + 1,
                  updated_at = excluded.updated_at,
                  updated_by = excluded.updated_by`)
      .run(lang, body, req.me.id);
    res.json({ ok: true, ...get(lang) });
  });

  return router;
};
