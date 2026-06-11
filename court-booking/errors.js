// 표준 에러 응답 생성
const CATALOG = {
  SLOT_CONFLICT:        { status: 409, mn: 'Энэ цаг саяхан өөр хэрэглэгч авлаа. Өөр цаг сонгоно уу.', en: 'This slot was just taken.' },
  BOOKING_NOT_FOUND:    { status: 404, mn: 'Захиалга олдсонгүй.', en: 'Booking not found.' },
  BOOKING_NOT_CANCELLABLE: { status: 409, mn: '24 цаг дотор захиалгыг цуцлах боломжгүй. Операторт хандана уу.', en: 'Cannot cancel within 24h.' },
  PAYMENT_EXPIRED:      { status: 410, mn: 'Төлбөрийн хугацаа дууссан.', en: 'Payment expired.' },
  INVALID_INPUT:        { status: 400, mn: 'Буруу мэдээлэл оруулсан байна.', en: 'Invalid input.' },
  DATE_OUT_OF_WINDOW:   { status: 400, mn: 'Энэ өдөр захиалгын хугацаанд ороогүй байна. Зөвхөн ойрын 2 долоо хоногийн захиалга авна.', en: 'Date is outside the booking window (next 2 weeks only).' },
  NO_TOKEN:             { status: 401, mn: 'Нэвтэрнэ үү.', en: 'Login required.' },
  INVALID_TOKEN:        { status: 401, mn: 'Хүчингүй токен.', en: 'Invalid token.' },
  INSUFFICIENT_ROLE:    { status: 403, mn: 'Эрх хүрэлцэхгүй.', en: 'Insufficient permission.' },
  PHONE_MISMATCH:       { status: 403, mn: 'Утасны сүүлийн 4 орон таарахгүй байна.', en: 'Phone last 4 digits mismatch.' },
  RATE_LIMITED:         { status: 429, mn: 'Хэт олон хүсэлт.', en: 'Too many requests.' },
  INTERNAL:             { status: 500, mn: 'Серверийн алдаа.', en: 'Server error.' }
};

function apiError(code, extra = {}) {
  const e = CATALOG[code] || CATALOG.INTERNAL;
  const err = new Error(code);
  err.error_code = code;
  err.status = e.status;
  err.message_mn = e.mn;
  err.message_en = e.en;
  err.extra = extra;
  return err;
}

function sendError(res, err) {
  const code = err.error_code || 'INTERNAL';
  const e = CATALOG[code] || CATALOG.INTERNAL;
  res.status(err.status || e.status).json({
    error_code: code,
    message_mn: err.message_mn || e.mn,
    message_en: err.message_en || e.en,
    ...err.extra
  });
}

module.exports = { apiError, sendError, CATALOG };
