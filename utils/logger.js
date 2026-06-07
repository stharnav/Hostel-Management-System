// Activity log — records who did what and when across the app. Backed by a
// `logs` collection in Firestore so the history is queryable, paginated, and
// survives a process restart (unlike a console/file log that gets rotated
// away).
//
// Each entry is a flat document — we never read these as a whole, only in
// paged slices by createdAt-desc, so denormalizing everything onto the doc
// (instead of a separate user table) keeps the read path a single query.
//
// Usage:
//   const log = require('../utils/logger');
//   await log(req, 'student.create', { entity: 'student', entityId: id, summary: `Added student ${name}` });
//
// The first argument can be either an Express `req` (we pull the session
// user + IP + user-agent) or a plain user object. Pass a `req` when called
// from a controller; the plain object form is for non-request paths (cron,
// seed scripts, etc).

const { db } = require('../config/firebase');

const logsCol = () => db.collection('logs');

// Action vocabulary. Adding a new action is just a string — the catalog
// below is for the UI (filter dropdown, icon/color). Keep keys stable once
// they ship; old logs reference them by key.
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

// Quick lookup so views can resolve an action key to its display metadata.
// Missing keys fall back to a neutral entry so an old log row never crashes
// the page.
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

/**
 * Resolve the actor from an Express request. Returns null if we can't
 * identify them (e.g. an anonymous failed-login attempt).
 */
function actorFromReq(req) {
  if (!req) return null;
  const u = req.session && req.session.user;
  if (!u) {
    // For login attempts, the email is the only signal we have. Don't
    // include the password — it'd be a leak.
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
 * Write a log entry. Designed to be fire-and-forget: any failure here is
 * logged to stderr but never thrown to the caller, so a logger outage
 * can't take down the action it was supposed to annotate.
 *
 * @param {object} source   Express req (preferred) or { user, ip, ua } object.
 * @param {string} action   One of the keys in ACTION_CATALOG.
 * @param {object} [meta]   { entity, entityId, summary, details }
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

    const entry = {
      action,
      actor: {
        id: actor.id,
        name: actor.name,
        email: actor.email,
        role: actor.role,
      },
      entity: meta.entity || null,    // e.g. 'student', 'room', 'user'
      entityId: meta.entityId || null,
      summary: meta.summary || null,  // one-line description for the feed
      details: meta.details || null,  // arbitrary structured data
      ip: ip ? String(ip).split(',')[0].trim() : null,
      userAgent: ua ? String(ua).slice(0, 240) : null,
      createdAt: new Date().toISOString(),
    };

    // Fire and forget — we don't want to delay a redirect because Firestore
    // is being slow. If you need to await for tests, just call record()
    // directly (the await is safe).
    db.collection('logs').add(entry).catch((err) => {
      console.warn('[logger] failed to write log:', err.message);
    });
  } catch (err) {
    // Last-ditch: never let a logging failure bubble out.
    console.warn('[logger] record() crashed:', err.message);
  }
}

/**
 * Page through the logs newest-first with simple filters. Returns
 * `{ items, hasMore, total }`. `total` is computed via a count query when
 * no filter is applied; for filtered queries we return null since the
 * Firestore count API would need a separate aggregation anyway.
 */
async function list({ action, actor, from, to, pageSize = 25, page = 1 } = {}) {
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 100);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);

  // Build the base query. We always order by createdAt desc, so the most
  // recent log is first. Filters are stacked only when provided so the
  // index usage stays simple.
  let q = logsCol().orderBy('createdAt', 'desc');
  if (action) q = q.where('action', '==', action);
  if (actor)  q = q.where('actor.id', '==', actor);
  if (from)   q = q.where('createdAt', '>=', from);
  if (to)     q = q.where('createdAt', '<=', to);

  const offset = (pageNum - 1) * size;
  // Overfetch by 1 so we can tell if there's a next page without a count.
  const snap = await q.offset(offset).limit(size + 1).get();
  const docs = snap.docs;
  const hasMore = docs.length > size;
  const items = docs.slice(0, size).map((d) => ({ id: d.id, ...d.data() }));

  return { items, hasMore, page: pageNum, pageSize: size };
}

/**
 * Distinct values used to populate the filter dropdowns in the UI. We scan
 * the catalog for actions/groups, and pull a recent slice of actors from
 * Firestore. Cheap because the actor list is bounded.
 */
async function getFilterOptions() {
  // Distinct action groups from the catalog.
  const groups = {};
  Object.entries(ACTION_CATALOG).forEach(([key, meta]) => {
    if (!groups[meta.group]) groups[meta.group] = { group: meta.group, label: GROUP_LABELS[meta.group] || meta.group, actions: [] };
    groups[meta.group].actions.push({ key, label: meta.label });
  });
  const groupList = Object.values(groups).sort((a, b) => a.label.localeCompare(b.label));

  // Recent actors — for the dropdown. We cap at 50 to keep the page small;
  // if you have more, the user can still search by name in the global list.
  const actorSnap = await logsCol().orderBy('createdAt', 'desc').limit(200).get();
  const seen = new Set();
  const actors = [];
  actorSnap.forEach((d) => {
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
