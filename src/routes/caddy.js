import express from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { logEvent } from '../middleware/logger.js';
import * as caddy from '../services/caddy.js';

export default function (db) {
  const router = express.Router();

  router.use(requireLogin);

  router.get('/routes', async (req, res) => {
    const { data: servers, error } = await caddy.getServers();
    const routes = servers ? caddy.extractRoutes(servers) : [];
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('caddy/routes', {
      title: 'Caddy Routes',
      user: req.session.user,
      routes,
      error,
      flash,
    });
  });

  router.get('/upstreams', async (req, res) => {
    const { data: upstreams, error } = await caddy.getUpstreams();
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('caddy/upstreams', {
      title: 'Caddy Upstreams',
      user: req.session.user,
      upstreams: Array.isArray(upstreams) ? upstreams : [],
      error,
      flash,
    });
  });

  router.get('/metrics', async (req, res) => {
    const flash = req.session.flash;
    delete req.session.flash;

    const [
      { data: config, error },
      { data: rawUpstreams },
      { data: promText, error: promError },
    ] = await Promise.all([
      caddy.getFullConfig(),
      caddy.getUpstreams(),
      caddy.getPrometheusMetrics(),
    ]);

    const upstreams = Array.isArray(rawUpstreams) ? rawUpstreams : [];
    const healthyUpstreams = upstreams.filter(u => u.healthy !== false).length;

    // HTTP servers
    const serversObj = config?.apps?.http?.servers || {};
    const serverList = Object.entries(serversObj).map(([name, s]) => ({
      name,
      listen: s.listen || [],
      routeCount: (s.routes || []).length,
      protocols: s.protocols || [],
      tlsPoliciesCount: (s.tls_connection_policies || []).length,
    }));
    const totalRoutes = serverList.reduce((sum, s) => sum + s.routeCount, 0);

    // TLS / PKI / logging / admin sections
    const tlsPolicies = config?.apps?.tls?.automation?.policies || null;
    const pkiCAs = config?.apps?.pki?.certificate_authorities || null;
    const loggingLogs = config?.logging?.logs || null;
    const adminConfig = config?.admin || null;

    // Prometheus metrics — group by family, skip histogram buckets and ghost entries
    let promGroups = null;
    if (promText) {
      const parsed = caddy.parsePrometheusText(promText);
      const GROUP_LABELS = {
        caddy_http: 'HTTP Server',
        caddy_reverse_proxy: 'Reverse Proxy',
        caddy_admin: 'Admin API',
        caddy_other: 'Caddy (other)',
        go: 'Go Runtime',
        process: 'Process',
        other: 'Other',
      };
      const groupMap = {};
      for (const [name, metric] of Object.entries(parsed)) {
        if (name.endsWith('_bucket') || metric.samples.length === 0) continue;
        let g = 'other';
        if (name.startsWith('caddy_http_')) g = 'caddy_http';
        else if (name.startsWith('caddy_reverse_proxy_')) g = 'caddy_reverse_proxy';
        else if (name.startsWith('caddy_admin_')) g = 'caddy_admin';
        else if (name.startsWith('caddy_')) g = 'caddy_other';
        else if (name.startsWith('go_')) g = 'go';
        else if (name.startsWith('process_')) g = 'process';
        // Mark whether this metric has a single unlabelled value (simple display)
        metric.simple = metric.samples.length === 1 &&
          Object.keys(metric.samples[0].labels).length === 0;
        if (!groupMap[g]) groupMap[g] = [];
        groupMap[g].push({ name, ...metric });
      }
      promGroups = Object.entries(groupMap).map(([id, metrics]) => ({
        id,
        label: GROUP_LABELS[id] || id,
        metrics,
      }));
    }

    res.render('caddy/metrics', {
      title: 'Caddy Metrics',
      user: req.session.user,
      config,
      serverList,
      totalRoutes,
      upstreams,
      healthyUpstreams,
      tlsPolicies,
      pkiCAs,
      loggingLogs,
      adminConfig,
      promGroups,
      promError,
      error,
      flash,
    });
  });

  router.get('/metrics/server/:name', async (req, res) => {
    const { data: config, error } = await caddy.getFullConfig();
    const serverName = req.params.name;
    const server = config?.apps?.http?.servers?.[serverName] || null;
    res.render('caddy/metrics-server', {
      title: `Server: ${serverName}`,
      user: req.session.user,
      serverName,
      server,
      routes: server ? caddy.extractRoutes({ [serverName]: server }) : [],
      error: error || (!server ? `Server "${serverName}" not found in config` : null),
    });
  });

  router.get('/metrics/raw', async (req, res) => {
    const { data: config, error } = await caddy.getFullConfig();
    res.render('caddy/metrics-raw', {
      title: 'Raw Config',
      user: req.session.user,
      config: config ? JSON.stringify(config, null, 2) : null,
      error,
    });
  });

  router.get('/editor', requireAdmin, async (req, res) => {
    logEvent(db, {
      userId: req.session.user.id,
      username: req.session.user.username,
      action: 'CONFIG_VIEW',
      status: 'SUCCESS',
      ip: req.ip,
    });
    const { data: servers, error } = await caddy.getServers();
    const routes = servers ? caddy.extractRoutes(servers) : [];
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('caddy/editor', {
      title: 'Config Editor',
      user: req.session.user,
      routes,
      error,
      flash,
    });
  });

  router.post('/routes/add', requireAdmin, async (req, res) => {
    const { matchHost, matchPath, upstream } = req.body;
    if (!upstream || !upstream.trim()) {
      req.session.flash = { type: 'danger', message: 'Upstream address is required.' };
      return res.redirect('/caddy/editor');
    }

    const { error } = await caddy.addRoute(
      matchHost ? matchHost.trim() : null,
      matchPath ? matchPath.trim() : null,
      upstream.trim()
    );

    logEvent(db, {
      userId: req.session.user.id,
      username: req.session.user.username,
      action: 'CONFIG_RELOAD',
      target: upstream.trim(),
      status: error ? 'FAILURE' : 'SUCCESS',
      detail: error || 'Route added',
      ip: req.ip,
    });

    req.session.flash = error
      ? { type: 'danger', message: `Failed to add route: ${error}` }
      : { type: 'success', message: 'Route added successfully.' };

    res.redirect('/caddy/editor');
  });

  router.post('/routes/:serverName/:index/delete', requireAdmin, async (req, res) => {
    const { serverName, index } = req.params;
    const { error } = await caddy.deleteRouteByIndex(serverName, index);

    logEvent(db, {
      userId: req.session.user.id,
      username: req.session.user.username,
      action: 'CONFIG_RELOAD',
      target: `${serverName}/routes/${index}`,
      status: error ? 'FAILURE' : 'SUCCESS',
      detail: error || 'Route deleted',
      ip: req.ip,
    });

    req.session.flash = error
      ? { type: 'danger', message: `Failed to delete route: ${error}` }
      : { type: 'success', message: 'Route deleted.' };

    res.redirect('/caddy/editor');
  });

  router.post('/reload', requireAdmin, async (req, res) => {
    const { data: currentConfig, error: fetchErr } = await caddy.getFullConfig();
    if (fetchErr) {
      req.session.flash = { type: 'danger', message: `Could not fetch config: ${fetchErr}` };
      return res.redirect('/caddy/editor');
    }

    const { error } = await caddy.reloadConfig(currentConfig);

    logEvent(db, {
      userId: req.session.user.id,
      username: req.session.user.username,
      action: 'CONFIG_RELOAD',
      status: error ? 'FAILURE' : 'SUCCESS',
      detail: error || 'Manual reload triggered',
      ip: req.ip,
    });

    req.session.flash = error
      ? { type: 'danger', message: `Reload failed: ${error}` }
      : { type: 'success', message: 'Caddy config reloaded successfully.' };

    res.redirect('/caddy/editor');
  });

  return router;
}
