// Single source of truth for what actions exist in the app and which role
// gets to perform them. The catalog is grouped by resource (e.g. `students`)
// so the role editor can render a tidy two-column layout.
//
// To add a new permission, append it under the right group. Then:
//   1. Guard the route with `ensurePermission('<group>.<action>')`
//   2. Optionally gate a UI control with `currentUser.permissions.includes(...)`
//      or `can('<group>.<action>')` in res.locals (see server.js)
//   3. Existing users will get the new permission on next login because the
//      session is rehydrated from the role doc on each request.

const PERMISSION_CATALOG = [
  {
    group: 'students',
    label: 'Students',
    icon: 'bi-people-fill',
    description: 'Resident records, profile data, and lifecycle status.',
    actions: [
      { key: 'viewList',    label: 'View student list',     description: 'See the searchable list of all students and their room/fee status.' },
      { key: 'viewProfile', label: 'View student profile',  description: 'Open an individual student to see their full details, guardians, and payment history.' },
      { key: 'viewHistory', label: 'View student history',  description: 'Open the combined payment and presence timeline for a student.' },
      { key: 'create',      label: 'Create student',        description: 'Add a new resident to the hostel.' },
      { key: 'edit',        label: 'Edit student',          description: 'Update name, contact, education, and other fields.' },
      { key: 'delete',      label: 'Delete student',        description: 'Permanently remove a student and free their room.' },
      { key: 'changeStatus', label: 'Change status',        description: 'Mark as active, on leave, returned, or left.' },
    ],
  },
  {
    group: 'rooms',
    label: 'Rooms',
    icon: 'bi-door-closed-fill',
    description: 'Room inventory, rent, and student assignments.',
    actions: [
      { key: 'view',   label: 'View rooms',   description: 'See the room list and individual rooms.' },
      { key: 'create', label: 'Create room',  description: 'Add a new room to the hostel.' },
      { key: 'edit',   label: 'Edit room',    description: 'Update room number, type, capacity, or rent.' },
      { key: 'delete', label: 'Delete room',  description: 'Permanently remove a room.' },
      { key: 'assign', label: 'Assign / remove students', description: 'Move students in and out of a room.' },
    ],
  },
  {
    group: 'fees',
    label: 'Fees',
    icon: 'bi-cash-coin',
    description: 'Billing dashboard and payment collection.',
    actions: [
      { key: 'view',         label: 'View fees',  description: 'See the fees dashboard and per-student status.' },
      { key: 'recordPayment', label: 'Record payment', description: 'Mark a student as paid for the current cycle.' },
    ],
  },
  {
    group: 'kitchen',
    label: 'Kitchen',
    icon: 'bi-cup-hot-fill',
    description: 'Daily meal planning roll call.',
    actions: [
      { key: 'view', label: 'View kitchen dashboard', description: 'See who is eating and their dietary preferences.' },
    ],
  },
  {
    group: 'users',
    label: 'Users & Accounts',
    icon: 'bi-person-badge-fill',
    description: 'Admin and staff accounts.',
    actions: [
      { key: 'view',     label: 'View users',  description: 'See the list of admin and staff accounts.' },
      { key: 'create',   label: 'Create user', description: 'Add a new admin or staff account.' },
      { key: 'edit',     label: 'Edit user',   description: 'Update name, email, role, or password.' },
      { key: 'delete',   label: 'Delete user', description: 'Permanently remove an account.' },
      { key: 'activate', label: 'Activate / deactivate', description: 'Toggle the active flag on an account.' },
    ],
  },
  {
    group: 'settings',
    label: 'Settings',
    icon: 'bi-gear-fill',
    description: 'Branding and access control.',
    actions: [
      { key: 'view',         label: 'View settings',         description: 'See the settings page.' },
      { key: 'editBranding', label: 'Edit branding',         description: 'Change app name, icon, and currency.' },
      { key: 'manageRoles',  label: 'Manage roles & permissions', description: 'Create, edit, and delete roles.' },
    ],
  },
  {
    group: 'logs',
    label: 'Activity Log',
    icon: 'bi-journal-text',
    description: 'Audit trail of who did what across the system.',
    actions: [
      { key: 'view', label: 'View activity log', description: 'See the feed of sign-ins, edits, deletions, and payments.' },
    ],
  },
  {
    group: 'storage',
    label: 'Storage',
    icon: 'bi-hdd-fill',
    description: 'Firebase Storage usage, Firestore data breakdown, and system info.',
    actions: [
      { key: 'view', label: 'View storage', description: 'See Firebase Storage usage, Firestore data breakdown, and system info.' },
    ],
  },
];

// Quick lookup: 'students.create' -> { group, action, label, description }
const PERMISSIONS_INDEX = (() => {
  const idx = {};
  PERMISSION_CATALOG.forEach((g) => {
    g.actions.forEach((a) => {
      idx[`${g.group}.${a.key}`] = { group: g.group, action: a.key, label: a.label, description: a.description, groupLabel: g.label };
    });
  });
  return idx;
})();

// ---------- Defaults ----------

// Every flag set to true → this role can do anything in the app.
function allPermissions() {
  const out = {};
  PERMISSION_CATALOG.forEach((g) => {
    out[g.group] = {};
    g.actions.forEach((a) => { out[g.group][a.key] = true; });
  });
  return out;
}

// Conservative baseline for the built-in Staff role.
function staffPermissions() {
  return {
    students: { viewList: true, viewProfile: true, viewHistory: true, create: false, edit: true, delete: false, changeStatus: true },
    rooms:    { view: true, create: false, edit: false, delete: false, assign: true },
    fees:     { view: true, recordPayment: true },
    kitchen:  { view: true },
    users:    { view: false, create: false, edit: false, delete: false, activate: false },
    settings: { view: true, editBranding: false, manageRoles: false },
    logs:     { view: false },
    storage:  { view: true },
  };
}

// Built-in roles that ship on first run. Seeded by `seedDefaultRoles()` in
// server.js. `key` is the stable identifier — never change it after release.
const DEFAULT_ROLES = [
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Full access to every part of the hostel management system.',
    permissions: allPermissions(),
    isSystem: true,
  },
  {
    key: 'staff',
    name: 'Staff',
    description: 'Day-to-day operations: manage students, rooms, and collect fees. No user or settings access.',
    permissions: staffPermissions(),
    isSystem: true,
  },
];

// ---------- Helpers ----------

/**
 * Flatten a nested permissions object into a Set of 'group.action' strings.
 * Admins are special-cased elsewhere (always allowed), so this is only for
 * roles with explicit grants.
 */
function permissionsToSet(perms) {
  const set = new Set();
  if (!perms || typeof perms !== 'object') return set;
  Object.keys(perms).forEach((group) => {
    const groupPerms = perms[group];
    if (!groupPerms || typeof groupPerms !== 'object') return;
    Object.keys(groupPerms).forEach((action) => {
      if (groupPerms[action]) set.add(`${group}.${action}`);
    });
  });
  return set;
}

/**
 * Inverse of `permissionsToSet` — turn the submitted checkbox map from the
 * form into a nested object that the catalog expects. Unknown groups or
 * actions are ignored so a stale form can't smuggle in a typo.
 */
function normalizePermissions(submitted) {
  const out = {};
  PERMISSION_CATALOG.forEach((g) => {
    out[g.group] = {};
    g.actions.forEach((a) => {
      out[g.group][a.key] = !!(submitted && submitted[g.group] && submitted[g.group][a.key]);
    });
  });
  return out;
}

/**
 * Resolve the effective permission set for a session user. The session may
 * have stale data right after a role edit, so we rehydrate from the user doc
 * and the role doc on every request.
 *
 * Order of precedence:
 *   1. If the user has a `roleId` pointing at a role doc, use that doc's
 *      permissions — even if the legacy `role` field disagrees. The roleId
 *      is the source of truth; the legacy field is kept only for display.
 *   2. If the user has legacy `role === 'admin'` but no roleId, grant
 *      everything (covers the bootstrap admin before it's been linked).
 *   3. Otherwise no permissions.
 */
async function resolveUserPermissions(db, userData) {
  // First choice: the roleId. Always honored when present.
  if (userData.roleId) {
    try {
      const doc = await db.collection('roles').doc(userData.roleId).get();
      if (doc.exists) return permissionsToSet(doc.data().permissions);
    } catch (err) {
      console.warn('[permissions] failed to load role:', err.message);
    }
  }

  // Fallback: legacy role field. Admin gets everything; staff gets nothing
  // (they should have been linked to a role doc, but we don't crash if not).
  if (userData.role === 'admin') return permissionsToSet(allPermissions());

  return new Set();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'role';
}

module.exports = {
  PERMISSION_CATALOG,
  PERMISSIONS_INDEX,
  DEFAULT_ROLES,
  allPermissions,
  staffPermissions,
  permissionsToSet,
  normalizePermissions,
  resolveUserPermissions,
  slugify,
};
