require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { csrfGuard } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/error-handler');

const app = express();
const PORT = parseInt(process.env.PORT || '6031', 10);

app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(csrfGuard);

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/telegram', require('./routes/telegram-webhook')());
app.use('/qpay', require('./routes/qpay'));

app.use(notFound);
app.use(errorHandler);

require('./cron-jobs')().startSchedules();

app.listen(PORT, () => {
  console.log(`[court-booking] listening on ${PORT}`);
});
