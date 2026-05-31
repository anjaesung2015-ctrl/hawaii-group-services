function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// 1시간 단위 슬롯
function computeSlots(hours, stepMin = 60) {
  const start = toMinutes(hours.open);
  const end = toMinutes(hours.close);
  const slots = [];
  for (let t = start; t + stepMin <= end; t += stepMin) {
    slots.push({ start: toHHMM(t), end: toHHMM(t + stepMin) });
  }
  return slots;
}

// open_hours: JSON string, date: 'YYYY-MM-DD', taken: [{start_time, end_time}]
function computeAvailability({ open_hours, date, taken }) {
  const hoursMap = typeof open_hours === 'string' ? JSON.parse(open_hours) : open_hours;
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const today = hoursMap[String(dayOfWeek)];
  if (!today) return [];

  const slots = computeSlots(today);
  return slots.map(s => ({
    ...s,
    available: !taken.some(t => s.start < t.end_time && s.end > t.start_time)
  }));
}

module.exports = { computeSlots, computeAvailability, toMinutes, toHHMM };
