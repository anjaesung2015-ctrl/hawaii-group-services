// 초대 링크 QR 코드 — 코트에서 만난 사람이 폰 카메라로 찍으면 가입 신청서가 열린다.
// 로그인 없이 열린다(초대 창은 회원만 띄우지만 그림 자체는 비밀이 아님).
// 아무 글자나 QR 로 만들어 주는 도구가 되지 않게, 이 사이트 주소(같은 호스트)만 받는다.
const express = require('express');
const QRCode = require('qrcode');

const MAX_URL = 300;

module.exports = function inviteRoutes() {
  const router = express.Router();

  router.get('/qr.svg', async (req, res) => {
    const u = String(req.query.u || '');
    let url;
    try { url = new URL(u); } catch (e) { return res.status(400).json({ error: 'bad_url' }); }
    if (u.length > MAX_URL || !/^https?:$/.test(url.protocol) || url.host !== req.get('host')) {
      return res.status(400).json({ error: 'bad_url' });
    }
    const svg = await QRCode.toString(url.href, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('image/svg+xml').send(svg);
  });

  return router;
};
