// 홈 피드 — 게시판 글·사진첩 사진·공지·대회 성적을 올린 시간 순으로 섞어 2열 카드로 보여준다.
// 무한 스크롤: 응답의 next(커서)를 ?before= 로 다시 보내면 그다음 묶음.
// 커서 = 'created_at#종류#id(10자리)' — 같은 시각에 올린 것끼리도 순서가 흔들리지 않는다.
const express = require('express');

const KINDS = ['post', 'photo', 'notice', 'result'];
const PAGE = 20;

// 종류마다 같은 칸으로 맞춘다: type, id, member_id, created_at, title, excerpt, photo, photos, likes, comments, sub, author, author_photo, skey
const PARTS = {
  post: `SELECT 'post' AS type, p.id, p.member_id, p.created_at, p.body AS title, NULL AS excerpt, NULL AS video,
           (SELECT pp.path FROM post_photo pp WHERE pp.post_id = p.id ORDER BY pp.sort, pp.id LIMIT 1) AS photo,
           (SELECT COUNT(*) FROM post_photo pp WHERE pp.post_id = p.id) AS photos,
           (SELECT COUNT(*) FROM post_like l WHERE l.post_id = p.id) AS likes,
           (SELECT COUNT(*) FROM comment c WHERE c.post_id = p.id) AS comments,
           NULL AS sub, m.name AS author, m.photo AS author_photo,
           p.created_at || '#post#' || printf('%010d', p.id) AS skey
         FROM post p JOIN member m ON m.id = p.member_id`,
  photo: `SELECT 'photo' AS type, g.id, g.member_id, g.created_at, g.caption AS title, NULL AS excerpt, g.video, g.photo, 1 AS photos, 0 AS likes, 0 AS comments,
           NULL AS sub, m.name AS author, m.photo AS author_photo, g.created_at || '#photo#' || printf('%010d', g.id) AS skey
         FROM gallery_photo g LEFT JOIN member m ON m.id = g.member_id`,
  notice: `SELECT 'notice' AS type, n.id, n.created_by AS member_id, n.created_at, n.title, substr(n.body, 1, 160) AS excerpt, NULL AS video, n.photo,
           COALESCE(json_array_length(n.photos), n.photo IS NOT NULL) AS photos, 0 AS likes, 0 AS comments, NULL AS sub, m.name AS author, m.photo AS author_photo,
           n.created_at || '#notice#' || printf('%010d', n.id) AS skey
         FROM notice n LEFT JOIN member m ON m.id = n.created_by`,
  result: `SELECT 'result' AS type, r.id, r.created_by AS member_id, r.created_at, r.title, r.division AS excerpt, NULL AS video,
           (SELECT rp.photo FROM result_photo rp WHERE rp.result_id = r.id ORDER BY rp.id LIMIT 1) AS photo,
           (SELECT COUNT(*) FROM result_photo rp WHERE rp.result_id = r.id) AS photos, 0 AS likes, 0 AS comments, r.kind AS sub,
           m.name AS author, m.photo AS author_photo, r.created_at || '#result#' || printf('%010d', r.id) AS skey
         FROM result r LEFT JOIN member m ON m.id = r.created_by`,
};

module.exports = function feedRoutes(db, auth, tr) {
  const router = express.Router();
  router.use(auth.requireClub);

  router.get('/', async (req, res) => {
    const kinds = KINDS.includes(req.query.kind) ? [req.query.kind] : KINDS;
    const before = String(req.query.before || '') || '￿';
    const limit = Math.min(40, Math.max(1, Number(req.query.limit) || PAGE));
    const rows = db.prepare(`SELECT * FROM (${kinds.map(k => PARTS[k]).join(' UNION ALL ')})
                             WHERE skey < ? ORDER BY skey DESC LIMIT ?`).all(before, limit);

    // 성적 카드에는 1등(같은 순위 여럿이면 함께) 이름을 붙인다
    const rids = rows.filter(r => r.type === 'result').map(r => r.id);
    if (rids.length) {
      const top = db.prepare(`SELECT e.result_id, e.place, COALESCE(m.name, e.person_name) AS name
                              FROM result_entry e LEFT JOIN member m ON m.id = e.member_id
                              WHERE e.result_id IN (${rids.map(() => '?').join(',')})
                                AND e.place = (SELECT MIN(place) FROM result_entry x WHERE x.result_id = e.result_id)
                              ORDER BY e.sort, e.id`).all(...rids);
      for (const r of rows.filter(x => x.type === 'result')) {
        const w = top.filter(e => e.result_id === r.id);
        r.kind = r.sub;
        r.place = w[0]?.place || null;
        r.winners = w.map(e => e.name);
        r.sub = null;
      }
    }

    // 동영상 카드에는 길이(초)를 붙인다
    const vids = rows.filter(r => r.type === 'photo' && r.video).map(r => r.id);
    if (vids.length) {
      const dur = new Map(db.prepare(`SELECT id, duration FROM gallery_photo WHERE id IN (${vids.map(() => '?').join(',')})`).all(...vids).map(x => [x.id, x.duration]));
      for (const r of rows) if (r.type === 'photo' && r.video) r.duration = dur.get(r.id) ?? null;
    }

    // 회원이 쓴 글은 화면 언어로 번역한 title_tr·excerpt_tr 를 덧붙인다 (원문은 그대로)
    if (tr && req.query.lang) await tr.attach(rows, ['title', 'excerpt'], String(req.query.lang));
    const out = rows.map(({ skey: _skey, ...r }) => r);
    res.json({ rows: out, next: rows.length === limit ? rows[rows.length - 1].skey : null });
  });

  return router;
};
