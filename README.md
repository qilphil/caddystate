# CaddyState

A local-network monitoring and management dashboard for a [Caddy](https://caddyserver.com/) reverse proxy. Built with Express.js, it communicates with Caddy exclusively through its admin API and stores all persistent data in SQLite.

## Features

- **Dashboard** — live Caddy reachability status, route/upstream counts, recent event log
- **Route viewer** — list all configured Caddy routes
- **Upstream monitor** — upstream list with live health status (UP/DOWN)
- **Metrics viewer** — raw metrics from Caddy's admin API
- **Config editor** (admin) — add and delete routes via a structured UI; trigger Caddy reloads
- **User management** (admin) — create, edit, and delete users with role-based access control
- **Event log** (admin) — filterable audit trail of all significant actions

## Tech Stack

| Concern         | Choice                              |
|-----------------|-------------------------------------|
| Runtime         | Node.js >= 18                       |
| Framework       | Express.js                          |
| Template engine | Pug                                 |
| CSS framework   | Bootstrap 5 (served as static files)|
| Package manager | Yarn                                |
| Database        | SQLite via `better-sqlite3`         |
| Session store   | SQLite-backed `express-session`     |
| Password hashing| `bcrypt`                            |

## Requirements

- Node.js 18 or later
- Yarn
- A running Caddy instance with its admin API enabled (default: `http://127.0.0.1:2019`, configured in `src/config.js`)

## Installation

```bash
git clone <repo-url> caddystate
cd caddystate
yarn install
```

## Running

### Development

```bash
yarn dev
```

### Production (direct)

```bash
yarn start
```

### Production with PM2

```bash
yarn pm2:start
```

The app binds to `0.0.0.0:1240` by default.

## Configuration

All tunable constants are in `src/config.js`. They can be overridden via environment variables:

| Variable         | Default                       | Description                     |
|------------------|-------------------------------|---------------------------------|
| `PORT`           | `1240`                        | HTTP port to listen on          |
| `CADDY_ADMIN_URL`| `http://127.0.0.1:1071`       | Caddy admin API base URL        |
| `DB_PATH`        | `./db/caddystate.db`          | SQLite database file path       |
| `SESSION_SECRET` | `change-me-in-production`     | Session signing secret          |

## First Login

On first startup, if no admin account exists, the app auto-creates one and writes the credentials to `admin-credentials.env` in the project root:

```
ADMIN_USER=admin
ADMIN_PASS=<generated password>
```

A message is printed to stdout confirming this. Delete `admin-credentials.env` after logging in — or use the button in the admin panel to delete it from the server.

## Project Structure

```
caddystate/
├── src/
│   ├── app.js              # Express entry point
│   ├── config.js           # Centralised configuration
│   ├── db.js               # DB init, schema, seed
│   ├── middleware/
│   │   ├── auth.js         # requireLogin, requireAdmin
│   │   └── logger.js       # Event logging helper
│   ├── routes/
│   │   ├── auth.js         # /login, /logout
│   │   ├── dashboard.js    # /
│   │   ├── caddy.js        # /caddy/*
│   │   ├── users.js        # /users/*
│   │   └── logs.js         # /logs
│   ├── services/
│   │   └── caddy.js        # Caddy admin API calls
│   └── views/              # Pug templates
├── public/
│   └── css/site.css        # Custom CSS overrides
├── ecosystem.config.js     # PM2 config
├── package.json
└── yarn.lock
```

## PM2 Commands

```bash
yarn pm2:start    # Start in production mode
yarn pm2:stop     # Stop
yarn pm2:restart  # Restart
yarn pm2:reload   # Zero-downtime reload
yarn pm2:logs     # Tail logs
yarn pm2:status   # Show process status
```

## Security Notes

- Caddy admin API calls are restricted to localhost (`127.0.0.1`) via `CADDY_ADMIN_URL`.
- Passwords are hashed with bcrypt (12 rounds) and never logged or stored in plain text.
- Sessions use `httpOnly` and `sameSite: lax` cookies, expiring after 8 hours of inactivity.
- LAN restriction is expected to be enforced at the network/firewall level.

## Out of Scope

- HTTPS/TLS termination at the Express layer (Caddy handles that if needed)
- Remote Caddy instances — only localhost is supported
- Docker / containerisation
- Multi-tenancy / multiple Caddy instances
