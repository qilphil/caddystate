'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { logEvent } = require('../middleware/logger');
const { requireLogin } = require('../middleware/auth');

module.exports = function (db) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('login', { title: 'Login', flash });
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.ip;

    if (!username || !password) {
      req.session.flash = { type: 'danger', message: 'Username and password are required.' };
      return res.redirect('/login');
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());

    const valid = user && await bcrypt.compare(password, user.password);

    if (!valid) {
      logEvent(db, {
        userId: user ? user.id : null,
        username: username.trim(),
        action: 'LOGIN',
        target: username.trim(),
        status: 'FAILURE',
        detail: 'Invalid credentials',
        ip,
      });
      req.session.flash = { type: 'danger', message: 'Invalid username or password.' };
      return res.redirect('/login');
    }

    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.redirect('/login');
      }
      req.session.user = { id: user.id, username: user.username, role: user.role };

      logEvent(db, {
        userId: user.id,
        username: user.username,
        action: 'LOGIN',
        status: 'SUCCESS',
        ip,
      });

      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  });

  router.post('/logout', requireLogin, (req, res) => {
    const user = req.session.user;
    logEvent(db, {
      userId: user.id,
      username: user.username,
      action: 'LOGOUT',
      status: 'SUCCESS',
      ip: req.ip,
    });
    req.session.destroy(() => res.redirect('/login'));
  });

  return router;
};
