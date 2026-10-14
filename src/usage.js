'use strict';

// First instant of the current UTC month, in SQLite datetime() format.
function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 19).replace('T', ' ');
}

// Leads counted against the monthly quota (spam is excluded).
function leadsThisMonth(db, workspaceId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM leads l JOIN sites s ON s.id = l.site_id
       WHERE s.workspace_id = ? AND l.created_at >= ? AND l.status != 'spam'`
    )
    .get(workspaceId, monthStart()).n;
}

module.exports = { monthStart, leadsThisMonth };
