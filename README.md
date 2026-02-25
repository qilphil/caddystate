# CaddyState

A local-network monitoring and management dashboard for a [Caddy](https://caddyserver.com/) reverse proxy. Built with Express.js, it communicates with Caddy exclusively through its admin API and stores all persistent data in SQLite.

## Features

### Dashboard
- Live Caddy reachability status
- Route count, upstream UP/DOWN counts
- Recent event log (latest admin actions)

### Routes
- Full list of configured Caddy routes with server, matchers, handlers, and upstream dials
- Click any **host badge** in the Matchers column to open an inline **split-pane preview** — the table stays on the left, an iframe loads the site on the right
- Close button (×) in the top-right corner of the preview pane restores the full-width layout

### Upstreams
- Live list of all reverse-proxy upstreams reported by Caddy
- Per-upstream route label derived from matched host
- Caddy health status (UP / DOWN) from the admin API
- **Live status column** — on page load, each upstream is probed in parallel via a server-side HTTP request (5 s timeout); the result badge shows the HTTP status code (colour-coded: green 2xx, cyan 3xx, amber 4xx, red 5xx) or a short error token (`REFUSED`, `TIMEOUT`, `RESET`, `DNS`)
- **Protocol-aware links** — upstreams configured with a TLS transport (`transport.tls`) are linked and probed over `https://`; all others use `http://`
- Click any address link to open the same inline split-pane preview as the Routes page

### Metrics
- Summary cards: Caddy status, HTTP server count, total routes, upstream health ratio
- HTTP Servers table with listen addresses, route counts, protocols, and TLS policy counts; drill-down to per-server detail page
- Upstreams summary table
- TLS Automation policies
- PKI Certificate Authorities
- Logging configuration
- Admin API configuration
- Full **Prometheus metrics** from Caddy's `/metrics` endpoint, grouped by family (HTTP Server, Reverse Proxy, Admin API, Go Runtime, Process, Other) in a collapsible accordion; simple single-value metrics shown inline, labelled series expanded as sub-rows
- Link to raw full-config JSON view

### Config Editor *(admin only)*
- Add routes (match host + optional path, upstream dial)
- Delete routes
- Trigger a live Caddy config reload

### User Management *(admin only)*
- Create, edit, and delete users
- Role-based access: `admin` or `user`

### Event Log *(admin only)*
- Filterable audit trail of all significant actions (config changes, reloads, login events)

---

## Tech Stack

| Concern          | Choice                               |
|------------------|--------------------------------------|
| Runtime          | Node.js ≥ 18                         |
| Framework        | Express.js                           |
| Template engine  | Pug                                  |
| CSS framework    | Bootstrap 5 (served as static files) |
| Database         | SQLite via `better-sqlite3`          |
| Session store    | SQLite-backed `express-session`      |
| Password hashing | bcrypt                               |
| Process manager  | PM2 (optional)                       |

---

## Requirements

- Node.js 18 or later
- Yarn
- A running Caddy instance with the admin API enabled

---

## Installation

```bash
git clone https://github.com/qilphil/caddystate.git
cd caddystate
yarn install
```

---

## Running

### Development (auto-reload)

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

The server binds to `0.0.0.0:1240` by default.

---

## Configuration

All tunables live in `src/config.js` and can be overridden with environment variables:

| Variable          | Default                   | Description                   |
|-------------------|---------------------------|-------------------------------|
| `PORT`            | `1240`                    | HTTP port to listen on        |
| `CADDY_ADMIN_URL` | `http://127.0.0.1:1071`   | Caddy admin API base URL      |
| `DB_PATH`         | `./db/caddystate.db`      | SQLite database file path     |
| `SESSION_SECRET`  | `change-me-in-production` | Session signing secret        |

---

## First Login

On first startup, if no admin account exists, the app auto-creates one and writes the credentials to `admin-credentials.env` in the project root:

```
ADMIN_USER=admin
ADMIN_PASS=<generated password>
```

A message is printed to stdout. Delete or shred `admin-credentials.env` after your first login.

---

## Project Structure

```
caddystate/
├── src/
│   ├── app.js                  # Express entry point, middleware wiring
│   ├── config.js               # Centralised configuration / env vars
│   ├── db.js                   # DB init, schema migrations, seed
│   ├── middleware/
│   │   ├── auth.js             # requireLogin, requireAdmin guards
│   │   └── logger.js           # Structured event logging helper
│   ├── routes/
│   │   ├── auth.js             # POST /login, POST /logout
│   │   ├── dashboard.js        # GET /
│   │   ├── caddy.js            # GET /caddy/routes, /upstreams, /metrics,
│   │   │                       # /upstream-check, /editor; POST /routes/*
│   │   ├── users.js            # CRUD /users/*
│   │   └── logs.js             # GET /logs
│   ├── services/
│   │   └── caddy.js            # Caddy admin API calls, config parsing,
│   │                           # extractTransportProtocols, Prometheus parser
│   └── views/                  # Pug templates
│       ├── layout.pug          # Base layout (nav, Bootstrap, block scripts)
│       ├── dashboard.pug
│       ├── caddy/
│       │   ├── routes.pug      # Split-pane route viewer
│       │   ├── upstreams.pug   # Split-pane + live status upstream viewer
│       │   ├── metrics.pug     # Full metrics page
│       │   ├── metrics-server.pug
│       │   ├── metrics-raw.pug
│       │   └── editor.pug
│       ├── users/
│       └── logs/
├── public/
│   ├── css/site.css            # Custom CSS (split-pane layout, badges, …)
│   └── js/
│       ├── sort-table.js       # Click-to-sort for all .sortable tables
│       ├── split-preview.js    # Generic split-pane iframe preview
│       └── upstream-status.js  # Parallel live HTTP status probing
├── ecosystem.config.cjs        # PM2 configuration
├── package.json
└── yarn.lock
```

---

## Internal API

| Method | Path                    | Auth | Description                                 |
|--------|-------------------------|------|---------------------------------------------|
| GET    | `/caddy/upstream-check` | user | Probe an upstream: params `addr`, `proto`   |

Used internally by the upstreams page. Parameters:
- `addr` — upstream address in `host:port` format
- `proto` — `http` (default) or `https`

Returns `{"status": 200}` on success or `{"error": "REFUSED"|"TIMEOUT"|"RESET"|"DNS"|"ERROR"}` on failure, with a 5-second timeout.

---

## PM2 Commands

```bash
yarn pm2:start    # Start in production mode
yarn pm2:stop     # Stop
yarn pm2:restart  # Restart
yarn pm2:reload   # Zero-downtime reload
yarn pm2:logs     # Tail logs
yarn pm2:status   # Show process status
```

---

## Security Notes

- The Caddy admin API URL defaults to `127.0.0.1` — keep it on localhost.
- Passwords are hashed with bcrypt and never logged or stored in plain text.
- Sessions use `httpOnly`, `sameSite: lax` cookies expiring after 8 hours.
- The upstream probe endpoint validates `addr` against `/^[a-zA-Z0-9._-]+(:\d+)?$/` before making any outbound request.
- LAN/firewall restriction for the dashboard itself is expected to be enforced at the network level.

---

## Out of Scope

- HTTPS/TLS termination at the Express layer (let Caddy handle it)
- Remote Caddy instances — only a locally reachable admin API is supported
- Docker / containerisation
- Multi-tenancy / multiple Caddy instances
