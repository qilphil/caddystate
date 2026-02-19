import express from 'express';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { requireAdmin } from '../middleware/auth.js';
import { logEvent } from '../middleware/logger.js';
import config from '../config.js';

export default function (db) {
  const router = express.Router();

  router.use(requireAdmin);

  router.get('/', (req, res) => {
    const users = db.prepare(
      'SELECT id, username, role, created_at, last_login FROM users ORDER BY id'
    ).all();
    const credFileExists = fs.existsSync(path.resolve(config.CREDENTIALS_FILE));
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('users/index', {
      title: 'User Management',
      user: req.session.user,
      users,
      credFileExists,
      flash,
    });
  });

  router.get('/new', (req, res) => {
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('users/form', {
      title: 'New User',
      user: req.session.user,
      editUser: null,
      flash,
    });
  });

  router.post('/', async (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password) {
      req.session.flash = { type: 'danger', message: 'Username and password are required.' };
      return res.redirect('/users/new');
    }
    if (username.length < 3 || username.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
      req.session.flash = { type: 'danger', message: 'Username must be 3–32 alphanumeric characters (a-z, 0-9, _, -).' };
      return res.redirect('/users/new');
    }
    if (password.length < 8) {
      req.session.flash = { type: 'danger', message: 'Password must be at least 8 characters.' };
      return res.redirect('/users/new');
    }

    const safeRole = role === 'admin' ? 'admin' : 'user';
    const hash = await bcrypt.hash(password, 12);

    try {
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(
        username.trim(), hash, safeRole
      );
      logEvent(db, {
        userId: req.session.user.id,
        username: req.session.user.username,
        action: 'USER_CREATED',
        target: username.trim(),
        status: 'SUCCESS',
        ip: req.ip,
      });
      req.session.flash = { type: 'success', message: `User "${username.trim()}" created.` };
      res.redirect('/users');
    } catch (err) {
      logEvent(db, {
        userId: req.session.user.id,
        username: req.session.user.username,
        action: 'USER_CREATED',
        target: username.trim(),
        status: 'FAILURE',
        detail: err.message,
        ip: req.ip,
      });
      req.session.flash = { type: 'danger', message: 'Username already exists.' };
      res.redirect('/users/new');
    }
  });

  // Must be before /:id to avoid capture
  router.post('/delete-credentials', (req, res) => {
    const credPath = path.resolve(config.CREDENTIALS_FILE);
    if (!fs.existsSync(credPath)) {
      req.session.flash = { type: 'warning', message: 'Credentials file does not exist.' };
      return res.redirect('/users');
    }
    fs.unlink(credPath, (err) => {
      if (err) {
        logEvent(db, {
          userId: req.session.user.id,
          username: req.session.user.username,
          action: 'CREDENTIALS_FILE_DELETED',
          status: 'FAILURE',
          detail: err.message,
          ip: req.ip,
        });
        req.session.flash = { type: 'danger', message: 'Failed to delete credentials file.' };
      } else {
        logEvent(db, {
          userId: req.session.user.id,
          username: req.session.user.username,
          action: 'CREDENTIALS_FILE_DELETED',
          status: 'SUCCESS',
          ip: req.ip,
        });
        req.session.flash = { type: 'success', message: 'Credentials file deleted.' };
      }
      res.redirect('/users');
    });
  });

  router.get('/:id/edit', (req, res) => {
    const editUser = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.params.id);
    if (!editUser) {
      req.session.flash = { type: 'danger', message: 'User not found.' };
      return res.redirect('/users');
    }
    res.render('users/form', {
      title: 'Edit User',
      user: req.session.user,
      editUser,
      flash: null,
    });
  });

  router.post('/:id', async (req, res) => {
    const { password, role } = req.body;
    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!targetUser) {
      req.session.flash = { type: 'danger', message: 'User not found.' };
      return res.redirect('/users');
    }

    if (targetUser.role === 'admin' && role !== 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
      if (adminCount <= 1) {
        req.session.flash = { type: 'danger', message: 'Cannot demote the last admin account.' };
        return res.redirect('/users');
      }
    }

    const safeRole = role === 'admin' ? 'admin' : 'user';
    let detail = `role=${safeRole}`;

    if (password && password.length > 0) {
      if (password.length < 8) {
        req.session.flash = { type: 'danger', message: 'Password must be at least 8 characters.' };
        return res.redirect(`/users/${req.params.id}/edit`);
      }
      const hash = await bcrypt.hash(password, 12);
      db.prepare('UPDATE users SET role = ?, password = ? WHERE id = ?').run(safeRole, hash, targetUser.id);
      detail += ', password updated';
    } else {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(safeRole, targetUser.id);
    }

    logEvent(db, {
      userId: req.session.user.id,
      username: req.session.user.username,
      action: 'USER_UPDATED',
      target: targetUser.username,
      status: 'SUCCESS',
      detail,
      ip: req.ip,
    });
    req.session.flash = { type: 'success', message: `User "${targetUser.username}" updated.` };
    res.redirect('/users');
  });

  router.post('/:id/delete', (req, res) => {
    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!targetUser) {
      req.session.flash = { type: 'danger', message: 'User not found.' };
      return res.redirect('/users');
    }
    if (targetUser.id === req.session.user.id) {
      req.session.flash = { type: 'danger', message: 'You cannot delete your own account.' };
      return res.redirect('/users');
    }
    if (targetUser.role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
      if (adminCount <= 1) {
        req.session.flash = { type: 'danger', message: 'Cannot delete the last admin account.' };
        return res.redirect('/users');
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(targetUser.id);
    logEvent(db, {
      userId: req.session.user.id,
      username: req.session.user.username,
      action: 'USER_DELETED',
      target: targetUser.username,
      status: 'SUCCESS',
      ip: req.ip,
    });
    req.session.flash = { type: 'success', message: `User "${targetUser.username}" deleted.` };
    res.redirect('/users');
  });

  return router;
}
