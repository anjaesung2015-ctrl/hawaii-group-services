// Origin 헤더 화이트리스트로 CSRF 방어 (상태변경 메서드만)
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

function csrfGuard(req, res, next) {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  // QPay 콜백은 외부 → CSRF 가드 제외 (라우트에서 직접 분기)
  if (req.path.startsWith('/qpay/')) return next();

  const origin = req.headers.origin;
  if (!origin) {
    // origin 없음: same-origin 또는 비-브라우저. 1단계 허용 (curl/POS 환경 고려)
    return next();
  }
  if (ALLOWED.length === 0 || ALLOWED.includes(origin)) return next();
  return res.status(403).json({ error_code: 'CSRF_BLOCKED', message_en: `Origin ${origin} not allowed.` });
}

module.exports = { csrfGuard };
