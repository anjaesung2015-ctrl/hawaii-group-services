module.exports = {
  apps: [{
    name: 'money',
    script: 'server.js',
    cwd: __dirname,
    max_memory_restart: '100M',
    env: { PORT: 6070, COOKIE_PATH: '/money', SECURE_COOKIE: '1' },
  }],
};
