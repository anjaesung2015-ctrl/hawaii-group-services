module.exports = {
  apps: [
    { name: 'fitness-crm', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/fitness-crm', max_memory_restart: '100M', exp_backoff_restart_delay: 1000, max_restarts: 50, min_uptime: 5000 },
    { name: 'shop-manager', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/shop-manager', max_memory_restart: '100M', exp_backoff_restart_delay: 1000, max_restarts: 50, min_uptime: 5000 },
    { name: 'finance-manager', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/finance-manager', max_memory_restart: '100M', exp_backoff_restart_delay: 1000, max_restarts: 50, min_uptime: 5000 },
    { name: 'center-manager', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/center-manager', max_memory_restart: '120M', exp_backoff_restart_delay: 1000, max_restarts: 50, min_uptime: 5000 },
    { name: 'lesson-manager', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/lesson-manager', max_memory_restart: '120M', exp_backoff_restart_delay: 1000, max_restarts: 50, min_uptime: 5000 },
    { name: 'touring-manager', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/touring-manager', max_memory_restart: '100M', exp_backoff_restart_delay: 1000, max_restarts: 50, min_uptime: 5000 },
    { name: 'schedule-manager', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/schedule-manager', max_memory_restart: '100M', exp_backoff_restart_delay: 1000, max_restarts: 50, min_uptime: 5000 },
    { name: 'vocab-trainer', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/vocab-trainer', max_memory_restart: '100M', exp_backoff_restart_delay: 1000, max_restarts: 50, min_uptime: 5000 },
    { name: 'fitness-trainer', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/fitness-trainer', max_memory_restart: '100M', exp_backoff_restart_delay: 1000, max_restarts: 50, min_uptime: 5000 },
    { name: 'translator', script: 'server.js', cwd: '/home/ubuntu/.openclaw/workspace/translator', max_memory_restart: '100M', env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY } },
  ]
};
