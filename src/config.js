export default {
  PORT: process.env.PORT || 1240,
  CADDY_ADMIN_URL: process.env.CADDY_ADMIN_URL || 'http://127.0.0.1:1071',
  DB_PATH: process.env.DB_PATH || './db/caddystate.db',
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-in-production',
  SESSION_MAX_AGE_MS: 8 * 60 * 60 * 1000,
  CREDENTIALS_FILE: './admin-credentials.env',
};
