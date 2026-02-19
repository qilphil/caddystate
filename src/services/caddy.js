import net from 'net';
import config from '../config.js';

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

export async function getFullConfig() {
  return caddyRequest('GET', '/config/');
}

export async function getServers() {
  return caddyRequest('GET', '/config/apps/http/servers');
}

export async function getUpstreams() {
  return caddyRequest('GET', '/reverse_proxy/upstreams');
}

export async function getPrometheusMetrics() {
  try {
    const res = await fetch(`${BASE}/metrics`);
    if (!res.ok) return { error: `HTTP ${res.status}`, data: null };
    const text = await res.text();
    return { error: null, data: text };
  } catch (err) {
    return { error: err.message, data: null };
  }
}

// Parse Prometheus text-format into { metricName: { help, type, samples: [{labels, value}] } }
export function parsePrometheusText(text) {
  const metrics = {};
  if (!text) return metrics;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('# HELP ')) {
      const m = t.match(/^# HELP (\S+)\s+(.+)$/);
      if (m) {
        if (!metrics[m[1]]) metrics[m[1]] = { help: '', type: '', samples: [] };
        metrics[m[1]].help = m[2];
      }
    } else if (t.startsWith('# TYPE ')) {
      const m = t.match(/^# TYPE (\S+)\s+(\S+)$/);
      if (m) {
        if (!metrics[m[1]]) metrics[m[1]] = { help: '', type: '', samples: [] };
        metrics[m[1]].type = m[2];
      }
    } else if (!t.startsWith('#')) {
      const m = t.match(/^([^{}\s]+)(\{[^}]*\})?\s+(\S+)/);
      if (m) {
        const name = m[1];
        const labelsStr = m[2] || '';
        const value = m[3];
        const labels = {};
        if (labelsStr) {
          const re = /(\w+)="([^"]*)"/g;
          let lm;
          while ((lm = re.exec(labelsStr)) !== null) labels[lm[1]] = lm[2];
        }
        if (!metrics[name]) metrics[name] = { help: '', type: '', samples: [] };
        metrics[name].samples.push({ labels, value });
      }
    }
  }
  return metrics;
}

export async function reloadConfig(fullConfig) {
  return caddyRequest('POST', '/load', fullConfig);
}

export function tcpCheck(host, port, timeoutMs = 3000) {
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
export function extractRoutes(serversConfig) {
  if (!serversConfig) return [];
  const routes = [];
  for (const [serverName, server] of Object.entries(serversConfig)) {
    for (const [idx, route] of (server.routes || []).entries()) {
      routes.push({ serverName, route, index: idx, upstreams: extractUpstreams(route.handle) });
    }
  }
  return routes;
}

export async function addRoute(matchHost, matchPath, upstreamDial) {
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

export async function deleteRouteByIndex(serverName, routeIndex) {
  const { data: routes, error } = await caddyRequest('GET', `/config/apps/http/servers/${serverName}/routes`);
  if (error) return { error };

  const idx = parseInt(routeIndex, 10);
  if (isNaN(idx) || idx < 0 || idx >= routes.length) {
    return { error: `Invalid route index: ${routeIndex}` };
  }

  routes.splice(idx, 1);
  return caddyRequest('PUT', `/config/apps/http/servers/${serverName}/routes`, routes);
}
