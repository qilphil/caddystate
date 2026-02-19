# CaddyState — Project Specification for AI Agents

## Overview

**CaddyState** is a local-network web application built with Express.js that provides a monitoring and management dashboard for a [Caddy](https://caddyserver.com/) reverse proxy running on the same host. It communicates with Caddy exclusively through its admin API (default port `1071`). The application stores all persistent data in a SQLite database.

---

## Technology Stack

| Concern            | Choice                                      |
|--------------------|---------------------------------------------|
| Runtime            | Node.js                                     |
| Framework          | Express.js                                  |
| Template engine    | Pug                                         |
| CSS framework      | Bootstrap 5 (served as static files)        |
| Package manager    | Yarn (no npm usage)                         |
| Database           | SQLite via `better-sqlite3`                 |
| Session store      | SQLite-backed `express-session`             |
| Password hashing   | `bcrypt`                                    |

> **Bootstrap static path**: Bootstrap is installed as a yarn dependency (e.g. `bootstrap@5`). Its compiled CSS and JS files are served from `node_modules/bootstrap/dist/` via Express static middleware. Do **not** use a CDN. Updates are performed by bumping the version in `package.json` and running `yarn install`.

---

## Project Layout

```
caddystate/
├── AGENTS.md                  ← this file
├── package.json
├── yarn.lock
├── .gitignore
├── admin-credentials.env      ← generated once at init, deleted by admin after first login
├── db/
│   └── caddystate.db          ← SQLite database file (created at runtime)
├── src/
│   ├── app.js                 ← Express app entry point
│   ├── config.js              ← centralised configuration constants
│   ├── db.js                  ← database initialisation and schema migrations
│   ├── middleware/
│   │   ├── auth.js            ← requireLogin, requireAdmin middleware
│   │   └── logger.js          ← event-logging middleware helper
│   ├── routes/
│   │   ├── auth.js            ← GET/POST /login, POST /logout
│   │   ├── dashboard.js       ← GET / (main dashboard)
│   │   ├── caddy.js           ← Caddy API proxy routes
│   │   ├── users.js           ← Admin: user CRUD
│   │   └── logs.js            ← Admin: event log viewer
│   ├── services/
│   │   └── caddy.js           ← Functions that call the Caddy admin API
│   └── views/
│       ├── layout.pug
│       ├── login.pug
│       ├── dashboard.pug
│       ├── caddy/
│       │   ├── routes.pug
│       │   ├── upstreams.pug
│       │   ├── metrics.pug
│       │   └── editor.pug
│       ├── users/
│       │   ├── index.pug
│       │   └── form.pug
│       └── logs/
│           └── index.pug
└── public/
    └── css/
        └── site.css           ← Custom CSS overrides (minimal)
```

---

## Server Binding

- **Port**: `1240`
- **Bind address**: `0.0.0.0` (all interfaces)
- LAN restriction is expected to be enforced at the network/firewall level. The app itself does **not** implement IP allow-listing.
- No TLS/HTTPS is configured at the application level (Caddy upstream handles that if needed in the future).

---

## Configuration (`src/config.js`)

All environment-tuneable constants must be centralised here with sensible defaults:

```js
module.exports = {
  PORT: process.env.PORT || 1240,
  CADDY_ADMIN_URL: process.env.CADDY_ADMIN_URL || 'http://127.0.0.1:1071',
  DB_PATH: process.env.DB_PATH || './db/caddystate.db',
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-in-production',
  SESSION_MAX_AGE_MS: 8 * 60 * 60 * 1000,  // 8 hours
  CREDENTIALS_FILE: './admin-credentials.env',
};
```

---

## Database Schema (`src/db.js`)

The database is initialised on startup. All tables use `CREATE TABLE IF NOT EXISTS`.

### `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL UNIQUE,
  password    TEXT    NOT NULL,          -- bcrypt hash
  role        TEXT    NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login  TEXT
);
```

### `sessions`

Managed automatically by `better-sqlite3-session-store` (or equivalent). Do not define manually.

### `event_log`

```sql
CREATE TABLE IF NOT EXISTS event_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id     INTEGER,                   -- NULL for unauthenticated actions
  username    TEXT,                      -- denormalised snapshot at time of event
  action      TEXT    NOT NULL,          -- e.g. 'LOGIN', 'CONFIG_RELOAD', 'USER_CREATED'
  target      TEXT,                      -- optional subject (e.g. affected username, route id)
  status      TEXT    NOT NULL,          -- 'SUCCESS' | 'FAILURE'
  detail      TEXT,                      -- optional freeform detail / error message
  ip          TEXT                       -- client IP address
);
```

---

## Initialisation Sequence (`src/db.js` — called at startup)

1. Create `db/` directory if it does not exist.
2. Open (or create) the SQLite file at the configured path.
3. Run all `CREATE TABLE IF NOT EXISTS` statements.
4. Check whether any user with `role = 'admin'` exists.
5. If **no admin exists**:
   - Generate a random 16-character alphanumeric password.
   - Hash it with bcrypt (rounds: 12).
   - Insert a user `{ username: 'admin', password: <hash>, role: 'admin' }`.
   - Write `admin-credentials.env` in the project root:
     ```
     ADMIN_USER=admin
     ADMIN_PASS=<plaintext password>
     ```
   - Log to stdout: `"[INIT] Admin user created. Credentials written to admin-credentials.env — delete this file after first login."`
6. If an admin already exists, skip steps 5 and do **not** overwrite the file.

---

## Authentication & Sessions

- Use `express-session` with a SQLite-backed session store.
- Sessions expire after 8 hours of inactivity (`rolling: true`).
- Passwords are verified with `bcrypt.compare`.
- On successful login: update `users.last_login`, write a `LOGIN / SUCCESS` event log entry, then `req.session.regenerate()` before saving user info.
- On failed login: write a `LOGIN / FAILURE` event log entry (with the attempted username in `target`).
- On logout: write a `LOGOUT / SUCCESS` event log entry, then `req.session.destroy()`.

### Middleware (`src/middleware/auth.js`)

```js
// Redirect to /login if not authenticated
function requireLogin(req, res, next) { ... }

// Respond 403 or redirect if authenticated user is not admin
function requireAdmin(req, res, next) { ... }
```

---

## Event Logging

Every significant application action must be written to `event_log`. Use a helper function (not middleware) `logEvent(db, { userId, username, action, target, status, detail, ip })`.

### Actions to log (non-exhaustive)

| Action constant         | When                                         |
|-------------------------|----------------------------------------------|
| `LOGIN`                 | Every login attempt (success or failure)     |
| `LOGOUT`                | User logs out                                |
| `CONFIG_VIEW`           | Admin views Caddy config                     |
| `CONFIG_RELOAD`         | Admin POSTs a config change to Caddy         |
| `UPSTREAM_HEALTH_CHECK` | Health check triggered (manual or scheduled) |
| `USER_CREATED`          | Admin creates a new user                     |
| `USER_UPDATED`          | Admin edits a user (role change, password)   |
| `USER_DELETED`          | Admin deletes a user                         |
| `LOG_VIEWED`            | Admin opens the event log page               |
| `CREDENTIALS_FILE_DELETED` | Admin triggers deletion of the credentials file |

---

## Routes

### Authentication (`src/routes/auth.js`)

| Method | Path      | Auth      | Description                         |
|--------|-----------|-----------|-------------------------------------|
| GET    | `/login`  | none      | Render login form                   |
| POST   | `/login`  | none      | Authenticate, start session         |
| POST   | `/logout` | login     | Destroy session, redirect to /login |

### Dashboard (`src/routes/dashboard.js`)

| Method | Path | Auth  | Description                                      |
|--------|------|-------|--------------------------------------------------|
| GET    | `/`  | login | Overview: Caddy status, quick stats, recent logs |

The dashboard must show:
- Whether Caddy is reachable at its admin API endpoint.
- Count of configured routes.
- Count of upstreams and their health status (up/down).
- Last 10 event log entries (admins see all, normal users see their own).

### Caddy (`src/routes/caddy.js`) — all routes require login

| Method | Path                     | Admin only | Description                                |
|--------|--------------------------|------------|--------------------------------------------|
| GET    | `/caddy/routes`          | no         | List all routes from Caddy config          |
| GET    | `/caddy/upstreams`       | no         | List upstreams with live health check      |
| GET    | `/caddy/metrics`         | no         | Display raw metrics from Caddy (if any)    |
| GET    | `/caddy/editor`          | yes        | Structured config editor UI                |
| POST   | `/caddy/routes/add`      | yes        | Add a new route via Caddy API              |
| POST   | `/caddy/routes/:id/delete` | yes      | Remove a route via Caddy API               |
| POST   | `/caddy/reload`          | yes        | Trigger Caddy config reload                |

### Users (`src/routes/users.js`) — all routes require admin

| Method | Path               | Description                  |
|--------|--------------------|------------------------------|
| GET    | `/users`           | List all users               |
| GET    | `/users/new`       | Render create-user form      |
| POST   | `/users`           | Create a new user            |
| GET    | `/users/:id/edit`  | Render edit-user form        |
| POST   | `/users/:id`       | Update user (role/password)  |
| POST   | `/users/:id/delete`| Delete a user                |

Constraints:
- An admin cannot delete their own account.
- The last remaining admin account cannot have its role demoted.

### Logs (`src/routes/logs.js`) — requires admin

| Method | Path    | Description                                          |
|--------|---------|------------------------------------------------------|
| GET    | `/logs` | Render event log table with filtering UI             |

Supported query parameters for filtering:
- `username` — filter by username (partial match)
- `action` — filter by action constant (exact)
- `status` — `SUCCESS` | `FAILURE`
- `from` — ISO date string (inclusive lower bound on `timestamp`)
- `to` — ISO date string (inclusive upper bound on `timestamp`)
- `page` — pagination (default 1, page size 50)

Results are sorted by `timestamp DESC` by default.

---

## Caddy Admin API Integration (`src/services/caddy.js`)

All HTTP calls use `fetch` (Node 18+ built-in) or `axios`. Failures must be caught and return a structured error object rather than throwing to the route handler.

### Endpoints to consume

| Caddy endpoint              | Method | Used for                                  |
|-----------------------------|--------|-------------------------------------------|
| `/config/`                  | GET    | Fetch full running config                 |
| `/config/apps/http/servers` | GET    | List HTTP servers and routes              |
| `/config/`                  | PATCH  | Apply incremental config changes          |
| `/load`                     | POST   | Replace entire config (reload)            |
| `/reverse_proxy/upstreams`  | GET    | List upstreams with health data           |

> **Upstream health check**: The `/reverse_proxy/upstreams` endpoint returns Caddy's own health state per upstream. Additionally, implement an optional lightweight TCP reachability check (Node `net.createConnection`) as a fallback when Caddy doesn't expose health detail.

---

## Structured Config Editor (Admin)

The editor renders Caddy's current routes in a structured table showing:
- Route matcher (host, path)
- Handler type (reverse_proxy, file_server, static_response, etc.)
- Upstream addresses (if reverse_proxy)
- An **Add Route** form with fields: matcher host, matcher path, upstream address
- A **Delete** button per route (with confirmation prompt)
- A **Reload Caddy** button that POSTs to `/caddy/reload`

No raw JSON editing is exposed in the UI.

---

## Credentials File Deletion

Provide a UI element in the admin panel (e.g. on the Users page or a Settings page) that allows the admin to delete `admin-credentials.env` from the server by clicking a button. This calls a dedicated POST endpoint that:
1. Checks the file exists.
2. Deletes it via `fs.unlink`.
3. Logs a `CREDENTIALS_FILE_DELETED / SUCCESS` event.
4. Shows a success flash message.

If the file does not exist, the button/section should not be rendered (check at route render time).

---

## Views & UI

- All pages extend `layout.pug`.
- `layout.pug` includes Bootstrap 5 CSS from `/node_modules/bootstrap/dist/css/bootstrap.min.css` (served as static) and Bootstrap JS bundle.
- Navigation bar shows: Dashboard, Caddy Routes, Caddy Upstreams, Caddy Metrics; and (admin only) Config Editor, Users, Logs, Settings.
- Flash messages (success/error) are passed via `req.session.flash` and rendered in the layout.
- Tables use Bootstrap `table table-striped table-hover table-sm`.
- Status badges (UP/DOWN, SUCCESS/FAILURE) use Bootstrap `badge bg-success` / `badge bg-danger`.

---

## package.json (key dependencies)

```json
{
  "name": "caddystate",
  "version": "1.0.0",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node src/app.js",
    "dev": "nodemon src/app.js"
  },
  "dependencies": {
    "bcrypt": "^5.x",
    "better-sqlite3": "^9.x",
    "bootstrap": "^5.x",
    "connect-sqlite3": "^0.9.x",
    "express": "^4.x",
    "express-session": "^1.x",
    "pug": "^3.x"
  },
  "devDependencies": {
    "nodemon": "^3.x"
  }
}
```

Bootstrap CSS and JS are served as static files:
```js
app.use('/bootstrap', express.static(path.join(__dirname, '../node_modules/bootstrap/dist')));
```
In Pug templates reference as `/bootstrap/css/bootstrap.min.css` and `/bootstrap/js/bootstrap.bundle.min.js`.

---

## Security Notes

- Passwords are never logged, stored in plain text, or included in event log `detail` fields.
- `express-session` cookie is `httpOnly: true`, `sameSite: 'lax'`.
- All POST handlers that mutate state must verify the user is authenticated (and admin where required) before acting.
- Input from forms (usernames, route matchers) must be validated for length and character set before use.
- Caddy API calls must be fire-walled to localhost only (`127.0.0.1:1071`); this is enforced by the `CADDY_ADMIN_URL` config pointing at loopback.

---

## Out of Scope

- HTTPS / TLS termination at the Express layer (handled by Caddy if needed)
- Docker / containerisation
- Remote Caddy instances (only localhost is supported)
- Email notifications or alerting
- Metrics time-series storage or graphing
- Multi-tenancy / multiple Caddy instances
