export function logEvent(db, { userId = null, username = null, action, target = null, status, detail = null, ip = null }) {
  try {
    db.prepare(`
      INSERT INTO event_log (user_id, username, action, target, status, detail, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, username, action, target, status, detail, ip);
  } catch (err) {
    console.error('[logEvent] Failed to write event log:', err.message);
  }
}
