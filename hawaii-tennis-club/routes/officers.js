// 조직도 (회칙 제14조) — 자리는 회칙에 정해져 있고, 거기에 사람을 앉힌다.
// 회원이면 member_id 로, 회원이 아닌 분(명예회장·고문)은 이름만 적는다.
const express = require('express');
const { OFFICER_ROLES } = require('../lib/db');

const ROLES = new Map(OFFICER_ROLES.map(r => [r.role, r]));

module.exports = function officerRoutes(db, auth) {
  const router = express.Router();
  router.use(auth.requireMember);

  const rows = () => db.prepare(`
    SELECT o.role, o.member_id, o.person_name, o.note, o.sort, m.name AS member_name, m.level, m.role AS member_role
    FROM officer o LEFT JOIN member m ON m.id = o.member_id
    ORDER BY o.sort`).all();

  router.get('/', (req, res) => {
    res.json(rows().map(r => ({
      role: r.role,
      group: ROLES.get(r.role)?.group || 'exec',
      member_id: r.member_id,
      // 회원으로 지정했으면 그 이름이 늘 최신(이름을 바꿔도 따라온다), 아니면 적어둔 이름
      name: r.member_name || r.person_name || null,
      from_member: !!r.member_id,
      level: r.member_name ? r.level : null,
      note: r.note,
    })));
  });

  router.put('/:role', auth.requireAdmin, (req, res) => {
    const role = req.params.role;
    if (!ROLES.has(role)) return res.status(404).json({ error: 'not_found' });

    const b = req.body || {};
    const note = String(b.note || '').trim().slice(0, 100) || null;

    // 회원을 지정했으면 이름칸은 비운다 (둘이 어긋나지 않게)
    if (b.member_id) {
      const m = db.prepare('SELECT id FROM member WHERE id=?').get(Number(b.member_id));
      if (!m) return res.status(404).json({ error: 'member_not_found' });
      db.prepare(`UPDATE officer SET member_id=?, person_name=NULL, note=?, updated_at=datetime('now','localtime') WHERE role=?`)
        .run(m.id, note, role);
      return res.json({ ok: true });
    }

    const person = String(b.person_name || '').trim().slice(0, 40) || null;
    db.prepare(`UPDATE officer SET member_id=NULL, person_name=?, note=?, updated_at=datetime('now','localtime') WHERE role=?`)
      .run(person, note, role);
    res.json({ ok: true });
  });

  return router;
};
