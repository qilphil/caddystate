import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { logEvent } from '../middleware/logger.js';

export default function (db) {
  const router = express.Router();

  router.use(requireAdmin);

  router.get('/', (req, res) => {
    const { username, action, status, from, to, page } = req.query;
    const PAGE_SIZE = 50;
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (currentPage - 1) * PAGE_SIZE;

    const conditions = [];
    const params = [];

    if (username) {
      conditions.push('username LIKE ?');
      params.push(`%${username}%`);
    }
    if (action) {
      conditions.push('action = ?');
      params.push(action);
    }
    if (status && ['SUCCESS', 'FAILURE'].includes(status.toUpperCase())) {
      conditions.push('status = ?');
      params.push(status.toUpperCase());
    }
    if (from) {
      conditions.push('timestamp >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('timestamp <= ?');
      params.push(`${to} 23:59:59`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { count: total } = db.prepare(`SELECT COUNT(*) as count FROM event_log ${where}`).get(params);
    const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

    const logs = db.prepare(
      `SELECT * FROM event_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all([...params, PAGE_SIZE, offset]);

    const actions = db.prepare('SELECT DISTINCT action FROM event_log ORDER BY action').all().map(r => r.action);

    logEvent(db, {
      userId: req.session.user.id,
      username: req.session.user.username,
      action: 'LOG_VIEWED',
      status: 'SUCCESS',
      ip: req.ip,
    });

    const flash = req.session.flash;
    delete req.session.flash;

    res.render('logs/index', {
      title: 'Event Log',
      user: req.session.user,
      logs,
      actions,
      filters: {
        username: username || '',
        action: action || '',
        status: status || '',
        from: from || '',
        to: to || '',
      },
      currentPage,
      totalPages,
      total,
      flash,
    });
  });

  return router;
}
