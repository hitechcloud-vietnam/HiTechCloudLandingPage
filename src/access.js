'use strict';

const ROLE_RANK = { editor: 1, admin: 2, owner: 3 };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Tenant isolation: every resource lookup goes through these helpers, which
// resolve the owning workspace and verify the caller's membership and role.
function createAccess(db) {
  function membership(workspaceId, userId) {
    return db
      .prepare('SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?')
      .get(workspaceId, userId);
  }

  function check(user, workspaceId, minRole) {
    const m = membership(workspaceId, user.id);
    if (!m) throw new HttpError(404, 'Không tìm thấy');
    if (ROLE_RANK[m.role] < ROLE_RANK[minRole]) {
      throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này');
    }
    return m.role;
  }

  return {
    workspace(user, workspaceId, minRole = 'editor') {
      const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
      if (!ws) throw new HttpError(404, 'Không tìm thấy workspace');
      const role = check(user, ws.id, minRole);
      return { ws, role };
    },

    site(user, siteId, minRole = 'editor') {
      const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
      if (!site) throw new HttpError(404, 'Không tìm thấy website');
      const role = check(user, site.workspace_id, minRole);
      return { site, role };
    },

    page(user, pageId, minRole = 'editor') {
      const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
      if (!page) throw new HttpError(404, 'Không tìm thấy trang');
      const { site, role } = this.site(user, page.site_id, minRole);
      return { page, site, role };
    },
  };
}

module.exports = { createAccess, HttpError, ROLE_RANK };
