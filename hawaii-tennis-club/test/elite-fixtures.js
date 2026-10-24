// 선수반 테스트 공용 — 선수 입력값, 선수반 코치 만들기
const { loginAs } = require('./helper');

const player = (over = {}) => ({ name: 'Temuulen', phone: '77001122', birth_year: 2011, level: 'advanced',
  parent_name: 'Bold', parent_phone: '99887766', elite_fee: 700000, ...over });

async function makeStaffCoach(app) {
  // 동호인 임원 하나 + 선수반 코치 하나 (오너가 지정)
  const owner = await loginAs(app.base, '99000000', '1234');
  const c = await owner.call('/members', { method: 'POST', body: { name: 'Coach B', phone: '88002233', pin: '3333' } });
  await owner.call(`/elite/coaches/${c.data.id}`, { method: 'PUT', body: { on: true } });
  return { owner, coachId: c.data.id, coach: await loginAs(app.base, '88002233', '3333') };
}

module.exports = { player, makeStaffCoach };
