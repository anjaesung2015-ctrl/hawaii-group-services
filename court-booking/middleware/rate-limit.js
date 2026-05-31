const rateLimit = require('express-rate-limit');

const createBookingLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error_code: 'RATE_LIMITED', message_mn: 'Хэт олон захиалга илгээгдсэн.', message_en: 'Too many bookings.' }
});

const cancelLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error_code: 'RATE_LIMITED', message_mn: 'Хэт олон хүсэлт.', message_en: 'Too many requests.' }
});

const readLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error_code: 'RATE_LIMITED', message_mn: 'Хэт олон хүсэлт.', message_en: 'Too many requests.' }
});

module.exports = { createBookingLimiter, cancelLimiter, readLimiter };
