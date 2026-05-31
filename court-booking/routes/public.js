const express = require('express');
const { db, prepare } = require('../db');
const { computeAvailability } = require('../availability');
const { apiError, sendError } = require('../errors');

const router = express.Router();

router.get('/courts', (req, res) => {
  const rows = prepare(`
    SELECT id, name_mn, group_name, sport, open_hours, price_per_hour
    FROM court WHERE active = 1 ORDER BY id
  `).all();
  res.json(rows.map(r => ({ ...r, open_hours: JSON.parse(r.open_hours) })));
});

router.get('/availability', (req, res) => {
  try {
    const court_id = parseInt(req.query.court_id, 10);
    const date = String(req.query.date || '');
    if (!court_id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw apiError('INVALID_INPUT');
    }
    const court = prepare('SELECT open_hours FROM court WHERE id=? AND active=1').get(court_id);
    if (!court) throw apiError('INVALID_INPUT');

    const taken = prepare(`
      SELECT start_time, end_time FROM booking
      WHERE court_id = ? AND booking_date = ?
        AND status NOT IN ('cancelled','no_show')
    `).all(court_id, date);

    res.json(computeAvailability({ open_hours: court.open_hours, date, taken }));
  } catch (e) {
    sendError(res, e);
  }
});

module.exports = router;
