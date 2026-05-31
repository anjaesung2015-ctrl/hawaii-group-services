const { sendError, apiError } = require('../errors');

function notFound(req, res) {
  res.status(404).json({ error_code: 'NOT_FOUND' });
}

function errorHandler(err, req, res, next) {
  console.error('[error]', err);
  if (err.error_code) return sendError(res, err);
  sendError(res, apiError('INTERNAL'));
}

module.exports = { notFound, errorHandler };
