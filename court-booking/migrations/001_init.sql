PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE court (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name_mn         TEXT NOT NULL,
  group_name      TEXT NOT NULL DEFAULT 'main',
  sport           TEXT NOT NULL DEFAULT 'tennis' CHECK (sport IN ('tennis')),
  open_hours      TEXT NOT NULL,
  price_per_hour  INTEGER NOT NULL CHECK (price_per_hour > 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE booking (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  public_code     TEXT NOT NULL UNIQUE,
  court_id        INTEGER NOT NULL REFERENCES court(id),
  booking_date    TEXT NOT NULL,
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  guest_name      TEXT NOT NULL,
  guest_phone     TEXT NOT NULL,
  guest_email     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','cancelled','no_show','completed')),
  amount          INTEGER NOT NULL CHECK (amount >= 0),
  confirmed_at    TEXT,
  cancelled_at    TEXT,
  cancelled_by    TEXT,
  cancel_reason   TEXT,
  no_show_at      TEXT,
  no_show_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX booking_court_slot_active
  ON booking (court_id, booking_date, start_time)
  WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX booking_court_date_idx     ON booking (court_id, booking_date);
CREATE INDEX booking_status_date_idx    ON booking (status, booking_date);
CREATE INDEX booking_phone_idx          ON booking (guest_phone);

CREATE TABLE payment (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id        INTEGER NOT NULL REFERENCES booking(id),
  provider          TEXT NOT NULL DEFAULT 'qpay' CHECK (provider IN ('qpay','cash')),
  qpay_invoice_id   TEXT,
  amount            INTEGER NOT NULL CHECK (amount > 0),
  status            TEXT NOT NULL DEFAULT 'awaiting'
                    CHECK (status IN ('awaiting','paid','auto_cancelled','failed')),
  awaiting_until    TEXT,
  paid_at           TEXT,
  paid_by           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX payment_qpay_invoice_unique
  ON payment (qpay_invoice_id) WHERE qpay_invoice_id IS NOT NULL;
CREATE INDEX payment_booking_idx        ON payment (booking_id);
CREATE INDEX payment_awaiting_idx       ON payment (awaiting_until) WHERE status = 'awaiting';

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id      TEXT,
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('admin','system','customer')),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  metadata      TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_actor_idx  ON audit_log (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;

INSERT INTO court (name_mn, group_name, sport, open_hours, price_per_hour) VALUES (
  'Хавайн теннисний корт №1',
  'main',
  'tennis',
  '{"0":{"open":"06:00","close":"22:00"},"1":{"open":"06:00","close":"22:00"},"2":{"open":"06:00","close":"22:00"},"3":{"open":"06:00","close":"22:00"},"4":{"open":"06:00","close":"22:00"},"5":{"open":"06:00","close":"22:00"},"6":{"open":"06:00","close":"22:00"}}',
  30000
);

INSERT INTO schema_version (version) VALUES (1);
