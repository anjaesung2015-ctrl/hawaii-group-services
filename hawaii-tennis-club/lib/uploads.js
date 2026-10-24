// 사진 파일(uploads/) 내주기 — 로그인한 사람에게만, 그리고 동호인반·선수반을 섞지 않는다.
//  선수반 사진(선수반 공지·선수 프로필) → 선수와 선수반 관리자만
//  나머지(동호인 공지·게시판·회원·가입 신청 사진) → 동호인 계정만
//  선수는 코치(오너·선수반 코치) 얼굴은 본다 — 일정·명단에 코치가 나오니까
const express = require('express');

module.exports = function uploadRoutes(db, auth, dir) {
  const eliteFile = db.prepare(`SELECT 1 FROM elite_notice WHERE photo=?
                                UNION ALL SELECT 1 FROM member WHERE program='elite' AND photo=? LIMIT 1`);
  const staffFace = db.prepare(`SELECT 1 FROM member WHERE program='club' AND (is_owner=1 OR elite_coach=1) AND photo=?`);

  function canSee(me, file) {
    if (auth.isEliteStaff(me)) return true;
    const elite = !!eliteFile.get(file, file);
    if (me.program === 'elite') return elite || !!staffFace.get(file);
    return !elite;
  }

  const router = express.Router();
  router.use(auth.requireMember, (req, res, next) => {
    let file;
    try { file = 'uploads' + decodeURIComponent(req.path); } catch (e) { return res.status(404).end(); }
    // 못 보는 사진은 있는지조차 알리지 않는다
    return canSee(req.me, file) ? next() : res.status(404).end();
  });
  router.use(express.static(dir, { maxAge: '7d' }));
  return router;
};
