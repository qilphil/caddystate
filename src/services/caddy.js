'use strict';

const net = require('net');
const config = require('../config');

const BASE = config.CADDY_ADMIN_URL;

async function caddyRequest(method, path, body) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${path}`, opts);
    const text = await res.text();
    if (!res.ok) {
      return { error: `Caddy responded ${res.status}: ${text}`, data: null };
    }
    const data = text ? JSON.parse(text) : null;
    return { error: null, data };
  } catch (err) {
    return { error: err.message, data: null };
  }
}

async function getFullConfig() {
  return caddyRequest('GET', '/config/');
}

async function getServers() {
  return caddyRequest('GET', '/config/apps/http/servers');
}

async function getUpstreams() {
  return caddyRequest('GET', '/reverse_proxy/upstreams');
}

async function reloadConfig(fullConfig) {
  return caddyRequest('POST', '/load', fullConfig);
}

async function tcpCheck(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

// Recursively collect upstream dial addresses from a handlers array,
// descending into subroute handlers which nest additional routes/handlers.
function extractUpstreams(handlers) {
  const dials = [];
  for (const h of (handlers || [])) {
    if (h.upstreams) {
      for (const u of h.upstreams) {
        if (u.dial) dials.push(u.dial);
      }
    }
    if (h.routes) {
      for (const r of h.routes) {
        dials.push(...extractUpstreams(r.handle));
      }
    }
  }
  return dials;
}

// Flatten routes from all servers into [{serverName, route, index, upstreams}]
function extractRoutes(serversConfig) {
  if (!serversConfig) return [];
  const routes = [];
  for (const [serverName, server] of Object.entries(serversConfig)) {
    for (const [idx, route] of (server.routes || []).entries()) {
      routes.push({ serverName, route, index: idx, upstreams: extractUpstreams(route.handle) });
    }
  }
  return routes;
}

async function addRoute(matchHost, matchPath, upstreamDial) {
  const { data: servers, error } = await getServers();
  if (error) return { error };

  const serverNames = Object.keys(servers || {});
  if (serverNames.length === 0) {
    return { error: 'No HTTP servers configured in Caddy' };
  }

  const serverName = serverNames[0];
  const newRoute = {
    handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: upstreamDial }] }],
  };

  const matchObj = {};
  if (matchHost) matchObj.host = [matchHost];
  if (matchPath) matchObj.path = [matchPath];
  if (Object.keys(matchObj).length > 0) newRoute.match = [matchObj];

  return caddyRequest('POST', `/config/apps/http/servers/${serverName}/routes/...`, newRoute);
}

async function deleteRouteByIndex(serverName, routeIndex) {
  const { data: routes, error } = await caddyRequest('GET', `/config/apps/http/servers/${serverName}/routes`);
  if (error) return { error };

  const idx = parseInt(routeIndex, 10);
  if (isNaN(idx) || idx < 0 || idx >= routes.length) {
    return { error: `Invalid route index: ${routeIndex}` };
  }

  routes.splice(idx, 1);
  return caddyRequest('PUT', `/config/apps/http/servers/${serverName}/routes`, routes);
}

module.exports = {
  getFullConfig,
  getServers,
  getUpstreams,
  reloadConfig,
  tcpCheck,
  extractRoutes,
  addRoute,
  deleteRouteByIndex,
};
