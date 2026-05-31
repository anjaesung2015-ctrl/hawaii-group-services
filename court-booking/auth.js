// JWT 검증 미들웨어 — staff-manager SSO 호환
// staff-manager: STAFF_MGR_SECRET / cookie 'staff_token' / payload { id, username, name, role, staff_id }
// court-booking: JWT_SECRET / cookie 'token' (디폴트) 또는 JWT_COOKIE_NAME 환경변수로 'staff_token' 매핑 가능
//   payload.sub 또는 payload.id 둘 다 지원 (SSO 호환)
const jwt = require('jsonwebtoken');
const { sendError, apiError } = require('./errors');

const ALLOWED_ROLES = ['super_admin', 'manager', 'staff', 'admin'];
const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'token';

function requireAdmin(req, res, next) {
  let token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    const auth = req.headers?.authorization || '';
    if (auth.startsWith('Bearer ')) token = auth.slice(7);
  }
  if (!token) return sendError(res, apiError('NO_TOKEN'));

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!ALLOWED_ROLES.includes(payload.role)) {
      return sendError(res, apiError('INSUFFICIENT_ROLE'));
    }
    req.user = {
      id: payload.sub || payload.id,
      email: payload.email,
      role: payload.role
    };
    next();
  } catch (e) {
    return sendError(res, apiError('INVALID_TOKEN'));
  }
}

module.exports = { requireAdmin, ALLOWED_ROLES };
