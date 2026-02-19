'use strict';

const express = require('express');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { logEvent } = require('../middleware/logger');
const caddy = require('../services/caddy');

module.exports = function (db) {
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
    const { data: config, error } = await caddy.getFullConfig();
    const flash = req.session.flash;
    delete req.session.flash;
    res.render('caddy/metrics', {
      title: 'Caddy Metrics',
      user: req.session.user,
      config: config ? JSON.stringify(config, null, 2) : null,
      error,
      flash,
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
};
