// Activity log — records who did what and when across the app.
// Now tenant-aware: logs are scoped to a tenant via the tenantId field.

const { db } = require('../config/firebase');

const logsCol = () => db.collection('logs');

// Action vocabulary.
const ACTION_CATALOG = {
  // Auth
  'auth.login':           { group: 'auth',     label: 'Signed in',                  icon: 'bi-box-arrow-in-right', color: 'emerald' },
  'auth.login_failed':    { group: 'auth',     label: 'Failed login',               icon: 'bi-shield-x',            color: 'red' },
  'auth.logout':          { group: 'auth',     label: 'Signed out',                 icon: 'bi-box-arrow-right',     color: 'ink' },

  // Students
  'student.create':       { group: 'students', label: 'Added student',              icon: 'bi-person-plus-fill',    color: 'brand' },
  'student.update':       { group: 'students', label: 'Updated student',            icon: 'bi-pencil-fill',         color: 'amber' },
  'student.delete':       { group: 'students', label: 'Deleted student',            icon: 'bi-trash-fill',          color: 'red' },
  'student.status_change':{ group: 'students', label: 'Changed student status',     icon: 'bi-arrow-repeat',        color: 'amber' },

  // Rooms
  'room.create':          { group: 'rooms',    label: 'Added room',                 icon: 'bi-door-open-fill',      color: 'brand' },
  'room.update':          { group: 'rooms',    label: 'Updated room',               icon: 'bi-pencil-fill',         color: 'amber' },
  'room.delete':          { group: 'rooms',    label: 'Deleted room',               icon: 'bi-trash-fill',          color: 'red' },
  'room.assign':          { group: 'rooms',    label: 'Assigned student to room',   icon: 'bi-person-check-fill',   color: 'emerald' },
  'room.unassign':        { group: 'rooms',    label: 'Removed student from room',  icon: 'bi-person-dash-fill',    color: 'amber' },

  // Fees
  'fee.payment':          { group: 'fees',     label: 'Recorded payment',           icon: 'bi-cash-coin',           color: 'emerald' },

  // Users & roles
  'user.create':          { group: 'users',    label: 'Created user',               icon: 'bi-person-plus-fill',    color: 'brand' },
  'user.update':          { group: 'users',    label: 'Updated user',               icon: 'bi-pencil-fill',         color: 'amber' },
  'user.delete':          { group: 'users',    label: 'Deleted user',               icon: 'bi-trash-fill',          color: 'red' },
  'user.activate':        { group: 'users',    label: 'Activated user',            icon: 'bi-check-circle-fill',   color: 'emerald' },
  'user.deactivate':      { group: 'users',    label: 'Deactivated user',          icon: 'bi-x-circle-fill',       color: 'red' },
  'role.create':          { group: 'users',    label: 'Created role',               icon: 'bi-shield-plus',         color: 'brand' },
  'role.update':          { group: 'users',    label: 'Updated role',               icon: 'bi-shield-fill',         color: 'amber' },
  'role.delete':          { group: 'users',    label: 'Deleted role',               icon: 'bi-shield-slash',        color: 'red' },

  // Settings
  'settings.update_branding': { group: 'users', label: 'Updated branding',      icon: 'bi-palette-fill',        color: 'indigo' },
};

const ACTION_INDEX = (() => {
  const idx = { ...ACTION_CATALOG };
  return idx;
})();

const GROUP_LABELS = {
  auth: 'Sign in / out',
  students: 'Students',
  rooms: 'Rooms',
  fees: 'Fees',
  users: 'Users & roles',
};

const COLOR_CLASSES = {
  brand:   { bg: 'bg-brand-50',   text: 'text-brand-700',   ring: 'ring-brand-200' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-200' },
  red:     { bg: 'bg-red-50',     text: 'text-red-700',     ring: 'ring-red-200' },
  ink:     { bg: 'bg-ink-100',    text: 'text-ink-700',     ring: 'ring-ink-200' },
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-200' },
};

function actorFromReq(req) {
  if (!req) return null;
  const u = req.session && req.session.user;
  if (!u) {
    return {
      id: null,
      name: req.body && req.body.email ? String(req.body.email) : 'Anonymous',
      email: req.body && req.body.email ? String(req.body.email) : null,
      role: null,
    };
  }
  return {
    id: u.id || null,
    name: u.name || 'Unknown',
    email: u.email || null,
    role: u.role || null,
  };
}

/**
 * Write a log entry. Now includes tenantId from req.tenantId.
 */
async function record(source, action, meta = {}) {
  try {
    const actor = source && source.session
      ? actorFromReq(source)
      : (source && source.user)
        ? {
            id: source.user.id || null,
            name: source.user.name || 'System',
            email: source.user.email || null,
            role: source.user.role || null,
          }
        : { id: null, name: 'System', email: null, role: null };

    const ip = (source && (source.ip || (source.headers && source.headers['x-forwarded-for']))) || null;
    const ua = (source && source.headers && source.headers['user-agent']) || (source && source.ua) || null;
    const tenantId = (source && source.tenantId) || null;

    const entry = {
      action,
      actor: {
        id: actor.id,
        name: actor.name,
        email: actor.email,
        role: actor.role,
      },
      entity: meta.entity || null,
      entityId: meta.entityId || null,
      summary: meta.summary || null,
      details: meta.details || null,
      ip: ip ? String(ip).split(',')[0].trim() : null,
      userAgent: ua ? String(ua).slice(0, 240) : null,
      tenantId,
      createdAt: new Date().toISOString(),
    };

    db.collection('logs').add(entry).catch((err) => {
      console.warn('[logger] failed to write log:', err.message);
    });
  } catch (err) {
    console.warn('[logger] record() crashed:', err.message);
  }
}

/**
 * Page through the logs newest-first, scoped to a tenant.
 */
async function list({ action, actor, from, to, tenantId, pageSize = 25, page = 1 } = {}) {
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);

  let q = logsCol();
  if (tenantId) q = q.where('tenantId', '==', tenantId);
  if (action) q = q.where('action', '==', action);
  if (actor)  q = q.where('actor.id', '==', actor);
  if (from)   q = q.where('createdAt', '>=', from);
  if (to)     q = q.where('createdAt', '<=', to);

  // Order in JS to avoid needing composite Firestore indexes
  const allSnap = await q.limit(1000).get();
  const sorted = allSnap.docs.sort((a, b) => {
    const ca = a.data().createdAt || '';
    const cb = b.data().createdAt || '';
    return cb.localeCompare(ca);
  });

  const offset = (pageNum - 1) * size;
  const docs = sorted.slice(offset, offset + size + 1);
  const hasMore = docs.length > size;
  const items = docs.slice(0, size).map((d) => ({ id: d.id, ...d.data() }));

  return { items, hasMore, page: pageNum, pageSize: size };
}

/**
 * Distinct values for filter dropdowns, scoped to a tenant.
 */
async function getFilterOptions(tenantId) {
  const groups = {};
  Object.entries(ACTION_CATALOG).forEach(([key, meta]) => {
    if (!groups[meta.group]) groups[meta.group] = { group: meta.group, label: GROUP_LABELS[meta.group] || meta.group, actions: [] };
    groups[meta.group].actions.push({ key, label: meta.label });
  });
  const groupList = Object.values(groups).sort((a, b) => a.label.localeCompare(b.label));

  let actorQuery = logsCol();
  if (tenantId) actorQuery = actorQuery.where('tenantId', '==', tenantId);
  const actorSnap = await actorQuery.limit(200).get();
  const sortedActors = actorSnap.docs.sort((a, b) => {
    const ca = a.data().createdAt || '';
    const cb = b.data().createdAt || '';
    return cb.localeCompare(ca);
  });
  const seen = new Set();
  const actors = [];
  sortedActors.forEach((d) => {
    const a = d.data().actor || {};
    if (!a.id || seen.has(a.id)) return;
    seen.add(a.id);
    actors.push({ id: a.id, name: a.name, role: a.role });
  });

  return { groups: groupList, actors };
}

module.exports = {
  record,
  list,
  getFilterOptions,
  ACTION_CATALOG,
  ACTION_INDEX,
  GROUP_LABELS,
  COLOR_CLASSES,
};
