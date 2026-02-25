(function () {
  'use strict';

  var cells = document.querySelectorAll('[data-upstream-addr]');
  if (!cells.length) return;

  function badgeClass(status) {
    if (status >= 200 && status < 300) return 'bg-success';
    if (status >= 300 && status < 400) return 'bg-info text-dark';
    if (status >= 400 && status < 500) return 'bg-warning text-dark';
    return 'bg-danger';
  }

  function updateCell(cell, data) {
    var badge = cell.querySelector('.live-badge');
    if (!badge) return;
    if (data.status !== undefined) {
      badge.className = 'badge live-badge ' + badgeClass(data.status);
      badge.textContent = data.status;
    } else {
      badge.className = 'badge live-badge bg-secondary';
      badge.textContent = data.error || 'ERR';
    }
  }

  cells.forEach(function (cell) {
    var addr  = cell.dataset.upstreamAddr;
    var proto = cell.dataset.upstreamProto || 'http';
    fetch('/caddy/upstream-check?addr=' + encodeURIComponent(addr) + '&proto=' + proto)
      .then(function (r) { return r.json(); })
      .then(function (data) { updateCell(cell, data); })
      .catch(function () { updateCell(cell, { error: 'ERR' }); });
  });
}());
