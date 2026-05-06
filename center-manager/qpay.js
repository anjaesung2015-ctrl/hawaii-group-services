/**
 * QPay V2 결제 모듈
 * - 토큰 관리 (캐싱 + 만료 전 갱신)
 * - 인보이스 생성
 * - 결제 확인
 */

const QPAY_BASE = 'https://merchant.qpay.mn/v2'
// TODO: 재성님 본인 QPay 계정으로 변경 예정
const QPAY_USERNAME = '' // 재성님 QPay 아이디 입력
const QPAY_PASSWORD = '' // 재성님 QPay 비밀번호 입력
const QPAY_INVOICE_CODE = '' // 재성님 QPay 송장 코드 입력
const CALLBACK_URL = 'https://hawaiigroup.co/center/api/qpay/callback'

// 토큰 캐시
let tokenCache = {
  accessToken: null,
  refreshToken: null,
  expiresAt: 0, // Unix timestamp (ms)
}

/**
 * QPay 인증 토큰 발급/갱신
 * - 만료 5분 전에 자동 갱신
 */
async function getAccessToken() {
  const now = Date.now()

  // 캐시된 토큰이 유효하면 재사용 (만료 5분 전까지)
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 5 * 60 * 1000) {
    return tokenCache.accessToken
  }

  // 새 토큰 발급 (Basic Auth)
  const basicAuth = Buffer.from(`${QPAY_USERNAME}:${QPAY_PASSWORD}`).toString('base64')
  const res = await fetch(`${QPAY_BASE}/auth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`QPay 토큰 발급 실패: ${res.status} ${text}`)
  }

  const data = await res.json()
  tokenCache = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: now + (data.expires_in || 3600) * 1000, // 기본 1시간
  }

  console.log('✅ QPay 토큰 발급 완료')
  return tokenCache.accessToken
}

/**
 * QPay 인보이스 생성
 * @param {Object} params - { invoiceId, amount, description, callbackParam }
 * @returns {Object} - QPay 인보이스 응답 (QR코드 포함)
 */
async function createInvoice({ invoiceId, amount, description, callbackParam }) {
  const token = await getAccessToken()

  const body = {
    invoice_code: QPAY_INVOICE_CODE,
    sender_invoice_no: String(invoiceId),
    invoice_receiver_code: 'terminal',
    invoice_description: description || '체육관 이용료',
    amount: Number(amount),
    callback_url: `${CALLBACK_URL}?slot_id=${callbackParam}`,
    calback_url: `${CALLBACK_URL}?slot_id=${callbackParam}`,
  }

  const res = await fetch(`${QPAY_BASE}/invoice`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`QPay 인보이스 생성 실패: ${res.status} ${text}`)
  }

  const data = await res.json()
  console.log(`✅ QPay 인보이스 생성: slot=${callbackParam}, invoice=${data.invoice_id}`)
  return data
}

/**
 * QPay 결제 확인
 * @param {string} invoiceId - QPay 인보이스 ID
 * @returns {Object} - 결제 확인 결과
 */
async function checkPayment(invoiceId) {
  const token = await getAccessToken()

  const res = await fetch(`${QPAY_BASE}/payment/check`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      object_type: 'INVOICE',
      object_id: invoiceId,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`QPay 결제 확인 실패: ${res.status} ${text}`)
  }

  const data = await res.json()
  return data
}

module.exports = { getAccessToken, createInvoice, checkPayment }
