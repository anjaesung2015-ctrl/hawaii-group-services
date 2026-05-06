/**
 * 앱 연동 모듈 (App Sync)
 * 각 앱에서 require하여 사용
 * 결제/매출 발생 시 → finance-manager, schedule-manager 자동 등록
 */
const http = require('http');
const jwt = require('jsonwebtoken');

const PORTS = {
  finance: 6003,
  schedule: 6007,
  center: 6004,
  lesson: 6005,
  shop: 6002,
  fitness: 6001,
};

const SECRETS = {
  finance: 'finance-mgr-2026-secret',
  schedule: 'schedule-mgr-2026-secret',
};

// 비즈니스 → 재무 카테고리 매핑
const BIZ_MAP = {
  center: { business_id: 1, categories: { court: 22, lesson: 23, tournament: 24, shop: 25, etc: 26 } },
  fitness: { business_id: 2, categories: { membership: 36, pt: 37, goods: 38, locker: 39, etc: 40, karate: 80, boxing: 81, cafe: 82 } },
  shop: { business_id: 3, categories: { tennis: 50, dewalt: 51, string: 52, etc: 53, sale: 91 } },
  lesson: { business_id: 4, categories: { monthly: 60, onetime: 61, advanced: 70, intermediate: 71, academy: 77 } },
};

function makeToken(secret) {
  return jwt.sign({ id: 1, username: 'sync', name: 'AppSync', role: 'admin' }, secret, { expiresIn: '1h' });
}

function post(port, path, data, secret) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: '127.0.0.1', port, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + makeToken(secret),
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 재무에 매출 등록
 * @param {string} source - 'center'|'lesson'|'shop'|'fitness'
 * @param {string} categoryKey - BIZ_MAP의 카테고리 키
 * @param {object} data - { amount, date, description, payment_method }
 */
async function syncFinance(source, categoryKey, data) {
  if (!data.amount || data.amount <= 0) return;
  const biz = BIZ_MAP[source];
  if (!biz) return;
  try {
    const result = await post(PORTS.finance, '/api/transactions', {
      type: 'income',
      amount: data.amount,
      category_id: biz.categories[categoryKey] || biz.categories.etc,
      business_id: biz.business_id,
      date: data.date || new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0],
      description: data.description || '',
      payment_method: data.payment_method || 'cash',
      reference_no: data.reference_no || `${source}-sync`,
    }, SECRETS.finance);
    console.log(`[SYNC→Finance] ${source} ₮${data.amount} → tx#${result.id}`);
    return result;
  } catch (e) {
    console.error(`[SYNC→Finance] ${source} error:`, e.message);
  }
}

/**
 * 스케줄에 이벤트 등록
 * @param {object} data - { title, date, start_time, end_time, location, description, category }
 */
async function syncSchedule(data) {
  try {
    const result = await post(PORTS.schedule, '/api/events', {
      title: data.title,
      category: data.category || 'business',
      start_date: data.date,
      end_date: data.date,
      start_time: data.start_time,
      end_time: data.end_time,
      location: data.location || '',
      description: data.description || '',
      related_business: data.source || '',
      color: data.color || '#22c55e',
    }, SECRETS.schedule);
    console.log(`[SYNC→Schedule] ${data.title} → event#${result.id}`);
    return result;
  } catch (e) {
    console.error(`[SYNC→Schedule] error:`, e.message);
  }
}

/**
 * 재무에 환불 등록
 */
async function syncRefund(source, categoryKey, data) {
  if (!data.amount || data.amount <= 0) return;
  const biz = BIZ_MAP[source];
  if (!biz) return;
  try {
    const result = await post(PORTS.finance, '/api/transactions', {
      type: 'expense',
      amount: data.amount,
      category_id: biz.categories[categoryKey] || biz.categories.etc,
      business_id: biz.business_id,
      date: data.date || new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0],
      description: '[환불] ' + (data.description || ''),
      payment_method: data.payment_method || 'cash',
    }, SECRETS.finance);
    console.log(`[SYNC→Finance] REFUND ${source} ₮${data.amount}`);
    return result;
  } catch (e) {
    console.error(`[SYNC→Finance] refund error:`, e.message);
  }
}

module.exports = { syncFinance, syncSchedule, syncRefund, BIZ_MAP };
