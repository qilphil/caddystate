'use strict';

const express = require('express');
const session = require('express-session');
const path = require('path');
const BetterSqlite3Store = require('better-sqlite3-session-store')(session);

const config = require('./config');
const { initDb } = require('./db');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const caddyRoutes = require('./routes/caddy');
const userRoutes = require('./routes/users');
const logRoutes = require('./routes/logs');

const db = initDb();
const app = express();

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Static files
app.use('/bootstrap', express.static(path.join(__dirname, '../node_modules/bootstrap/dist')));
app.use('/public', express.static(path.join(__dirname, '../public')));

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions
app.use(session({
  store: new BetterSqlite3Store({ client: db }),
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.SESSION_MAX_AGE_MS,
  },
}));

// Expose session user to all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Routes
app.use('/', authRoutes(db));
app.use('/', dashboardRoutes(db));
app.use('/caddy', caddyRoutes(db));
app.use('/users', userRoutes(db));
app.use('/logs', logRoutes(db));

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 Not Found',
    message: 'Page not found.',
    user: req.session.user || null,
  });
});

// 500
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Server Error',
    message: err.message,
    user: req.session.user || null,
  });
});

app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`[CaddyState] Listening on http://0.0.0.0:${config.PORT}`);
});
