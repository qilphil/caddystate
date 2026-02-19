'use strict';

const path = require('path');

const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'caddystate',
      script: 'src/app.js',
      cwd: root,

      // Single fork — SQLite does not support concurrent multi-process writes
      instances: 1,
      exec_mode: 'fork',

      // Never stop unless explicitly told to
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',

      // Logs inside the project tree
      out_file: path.join(root, 'logs', 'out.log'),
      error_file: path.join(root, 'logs', 'error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Environment for production use
      env_production: {
        NODE_ENV: 'production',
        PORT: 1240,
      },

      // Optional: override settings for local dev via `pm2 start --env development`
      env_development: {
        NODE_ENV: 'development',
        PORT: 1240,
      },
    },
  ],
};
