// EC2 배포용 pm2 설정 — app.hawaiigroup.co/booking/ 로 서비스한다.
// (2026-10-15: 코트예약(court-booking)을 내리고 이 자리를 하와이클럽이 쓴다.
//  회원들이 이미 아는 주소·홈화면 아이콘이 /booking/ 이라 경로를 그대로 물려받았다.
//  옛 /club/ 주소는 nginx 가 /booking/ 으로 넘겨준다.)
// 실행: pm2 start ecosystem.config.cjs  (SESSION_SECRET 은 서버의 .pm2-secret 파일에서 읽는다)
const fs = require('fs');
const path = require('path');

// 세션 비밀키는 저장소에 넣지 않는다. 없으면 만들고, 있으면 그걸 계속 쓴다(재시작해도 로그아웃 안 됨).
const secretFile = path.join(__dirname, 'data', '.secret');
let secret = '';
try { secret = fs.readFileSync(secretFile, 'utf8').trim(); } catch (e) { /* 서버가 처음 뜰 때 직접 만든다 */ }

module.exports = {
  apps: [{
    name: 'hawaii-tennis-club',
    script: 'server.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: '6032',
      COOKIE_PATH: '/booking',   // 같은 도메인의 다른 서비스로 세션 쿠키가 새지 않게
      SECURE_COOKIE: '1',        // https 전용 쿠키
      ...(secret ? { SESSION_SECRET: secret } : {}),
    },
    max_memory_restart: '200M',
  }],
};
