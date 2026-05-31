require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = parseInt(process.env.PORT || '6031', 10);

app.set('trust proxy', 1);   // nginx 뒤
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// 정적 (public/)
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// health
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// 라우터 마운트 (admin/qpay는 이후 task에서)
app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));
app.use('/qpay', require('./routes/qpay'));

require('./cron-jobs')().startSchedules();

app.listen(PORT, () => {
  console.log(`[court-booking] listening on ${PORT}`);
});
