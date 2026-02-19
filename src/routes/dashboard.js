import express from 'express';
import { requireLogin } from '../middleware/auth.js';
import * as caddy from '../services/caddy.js';

export default function (db) {
  const router = express.Router();

  router.get('/', requireLogin, async (req, res) => {
    const user = req.session.user;

    const [{ data: fullConfig, error: configErr }, { data: servers }, { data: upstreams }] =
      await Promise.all([caddy.getFullConfig(), caddy.getServers(), caddy.getUpstreams()]);

    const caddyReachable = !configErr;

    const routes = servers ? caddy.extractRoutes(servers) : [];
    const routeCount = routes.length;

    const upstreamList = Array.isArray(upstreams) ? upstreams : [];
    const upstreamStats = {
      total: upstreamList.length,
      up: upstreamList.filter(u => u.healthy !== false).length,
      down: upstreamList.filter(u => u.healthy === false).length,
    };

    let recentLogs;
    if (user.role === 'admin') {
      recentLogs = db.prepare('SELECT * FROM event_log ORDER BY timestamp DESC LIMIT 10').all();
    } else {
      recentLogs = db.prepare(
        'SELECT * FROM event_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10'
      ).all(user.id);
    }

    const flash = req.session.flash;
    delete req.session.flash;

    res.render('dashboard', {
      title: 'Dashboard',
      user,
      caddyReachable,
      routeCount,
      upstreamStats,
      recentLogs,
      flash,
    });
  });

  return router;
}
