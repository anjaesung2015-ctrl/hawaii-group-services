// 클럽 설정 — 회비 금액과 클럽 이름. 금액을 바꿔도 이미 기록된 납부 줄의 금액은 그대로 남는다.
const express = require('express');
const { getSettings, setSettings } = require('../lib/db');

module.exports = function settingRoutes(db, auth) {
  const router = express.Router();

  // 로그인 화면에도 클럽 이름을 띄우므로 읽기는 열어둔다 (비밀이 아니다)
  router.get('/', (req, res) => res.json(getSettings(db)));

  router.put('/', auth.requireOwner, (req, res) => {
    const b = req.body || {};
    const patch = {};
    if ('club_name' in b) {
      const name = String(b.club_name || '').trim();
      if (!name) return res.status(400).json({ error: 'club_name_required' });
      patch.club_name = name;
    }
    for (const k of ['monthly_fee', 'joining_fee', 'elite_fee']) {
      if (k in b) {
        const n = Number(b[k]);
        if (!Number.isFinite(n) || n < 0 || n > 100000000) return res.status(400).json({ error: `bad_${k}` });
        patch[k] = Math.round(n);
      }
    }
    // 계좌 — 비워도 된다(계좌 카드 숨김). 계좌번호는 숫자·공백·하이픈만.
    for (const k of ['bank_name', 'bank_holder']) {
      if (k in b) {
        const v = String(b[k] ?? '').trim();
        if (v.length > 60) return res.status(400).json({ error: `bad_${k}` });
        patch[k] = v;
      }
    }
    if ('bank_account' in b) {
      const v = String(b.bank_account ?? '').trim();
      if (v.length > 40 || !/^[\d\s-]*$/.test(v)) return res.status(400).json({ error: 'bad_bank_account' });
      patch.bank_account = v;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'no_changes' });
    res.json(setSettings(db, patch));
  });

  return router;
};
