// 선수반 공용 — 훈련 칸 검사, 선수별 수강료, 활동 선수 목록
const { getSettings } = require('./db');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function parseSession(b = {}) {
  const title = String(b.title || '').trim().slice(0, 80);
  const session_date = YMD.test(b.session_date || '') ? b.session_date : null;
  const start_time = HHMM.test(b.start_time || '') ? b.start_time : null;
  const end_time = HHMM.test(b.end_time || '') ? b.end_time : null;
  if (!title) return { error: 'title_required' };
  if (!session_date) return { error: 'bad_date' };
  if (!start_time || !end_time) return { error: 'bad_time' };
  if (end_time <= start_time) return { error: 'end_before_start' };
  const coach = Number(b.coach_id) || null;
  return {
    title, session_date, start_time, end_time,
    court: String(b.court || '').trim().slice(0, 40) || null,
    coach_id: coach,
    memo: String(b.memo || '').trim().slice(0, 500) || null,
  };
}

// 그 선수의 월 수강료 — 선수별 금액, 없으면 설정의 기본값
const eliteFeeOf = (db, m) => (m.elite_fee > 0 ? m.elite_fee : getSettings(db).elite_fee);

const activePlayers = (db) => db.prepare(`SELECT id, name, phone, level, birth_year, photo, elite_fee, assigned_coach_id
                                          FROM member WHERE program='elite' AND status='active' ORDER BY name`).all();

// 코치로 고를 수 있는 사람 = 오너 또는 선수반 코치
const isStaffId = (db, id) => !!db.prepare(
  "SELECT 1 FROM member WHERE id=? AND program='club' AND (is_owner=1 OR elite_coach=1)").get(id);

module.exports = { parseSession, eliteFeeOf, activePlayers, isStaffId, YMD, HHMM };
