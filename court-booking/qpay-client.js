const https = require('https');

const BASE = 'merchant.qpay.mn';   // v2
let tokenCache = { access: null, expiresAt: 0 };

function request({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: BASE, path: `/v2${path}`, method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      },
      timeout: 10000
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          const parsed = chunks ? JSON.parse(chunks) : {};
          if (res.statusCode >= 400) return reject(new Error(`QPAY_${res.statusCode}: ${chunks}`));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('QPAY_TIMEOUT')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getAccessToken() {
  if (tokenCache.access && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.access;
  const basic = Buffer.from(`${process.env.QPAY_USERNAME}:${process.env.QPAY_PASSWORD}`).toString('base64');
  const res = await request({
    method: 'POST', path: '/auth/token',
    headers: { Authorization: `Basic ${basic}` }
  });
  tokenCache = {
    access: res.access_token,
    expiresAt: Date.now() + (res.expires_in || 86400) * 1000
  };
  return tokenCache.access;
}

async function createInvoice({ amount, description, callback_url, sender_invoice_no, receiver_code }) {
  const token = await getAccessToken();
  const res = await request({
    method: 'POST', path: '/invoice',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      invoice_code: process.env.QPAY_INVOICE_CODE,
      sender_invoice_no,
      invoice_receiver_code: receiver_code || 'guest',
      invoice_description: description,
      amount,
      callback_url
    }
  });
  // res: { invoice_id, qr_text, qr_image, urls: [{name, link}], deeplink }
  return res;
}

async function checkPayment(invoice_id) {
  const token = await getAccessToken();
  const res = await request({
    method: 'POST', path: '/payment/check',
    headers: { Authorization: `Bearer ${token}` },
    body: { object_type: 'INVOICE', object_id: invoice_id, offset: { page_number: 1, page_limit: 100 } }
  });
  // res.rows: [{payment_status: 'PAID'|...}]
  return res;
}

module.exports = { getAccessToken, createInvoice, checkPayment };
