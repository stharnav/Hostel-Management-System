// CRUD for the `roles` collection — defines what a user type can do in the
// app. Lives under /settings/roles and is admin-only at the route level.

const { db } = require('../config/firebase');
const {
  PERMISSION_CATALOG,
  PERMISSIONS_INDEX,
  DEFAULT_ROLES,
  allPermissions,
  normalizePermissions,
  slugify,
} = require('../utils/permissions');

const rolesCol = () => db.collection('roles');
const usersCol = () => db.collection('users');
const { record: log } = require('../utils/logger');

// Build the form payload: permission rows with `on` flag set according to the
// role's stored values, ready to render as checkboxes.
function buildPermissionRows(permissions) {
  return PERMISSION_CATALOG.map((g) => ({
    ...g,
    actions: g.actions.map((a) => ({
      ...a,
      // Anything not stored yet defaults to false.
      on: !!(permissions && permissions[g.group] && permissions[g.group][a.key]),
    })),
  }));
}

// Insert the built-in roles (Admin, Staff) on first run. Idempotent — keyed
// by `key`, so reruns won't duplicate. Called from server.js.
//
// Also migrates pre-existing system roles when the catalog changes: if the
// stored permissions object is missing any action key that the current
// catalog defines, we re-seed it from the default. The admin role is also
// re-asserted as having every permission (it's locked anyway, but this
// makes the doc match the catalog after a permission rename or addition).
async function seedDefaultRoles() {
  for (const r of DEFAULT_ROLES) {
    const existing = await rolesCol().where('key', '==', r.key).limit(1).get();
    if (existing.empty) {
      await rolesCol().add({
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        isSystem: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[roles] seeded default role: ${r.name}`);
      continue;
    }
    // Existing system role — check whether its permissions object covers
    // every action in the current catalog. If not, top up missing keys.
    // For the admin role we go further and re-assert every permission, so
    // renaming or adding an action automatically grants it to admins.
    const docRef = existing.docs[0].ref;
    const current = existing.docs[0].data().permissions || {};
    const expected = r.key === 'admin' ? r.permissions : mergePermissions(current, r.permissions);
    if (JSON.stringify(expected) !== JSON.stringify(current)) {
      await docRef.update({
        permissions: expected,
        updatedAt: new Date().toISOString(),
      });
      console.log(`[roles] migrated default role: ${r.name} (catalog drift)`);
    }
  }
}

// Merge two permissions objects. `base` wins for any key it has set to
// false, but missing keys in `base` are filled in from `fallback` (the
// default role definition). This preserves admin/manager choices for
// existing actions while bringing the role up to date with new actions.
function mergePermissions(base, fallback) {
  const out = JSON.parse(JSON.stringify(fallback));
  PERMISSION_CATALOG.forEach((g) => {
    if (!out[g.group]) out[g.group] = {};
    g.actions.forEach((a) => {
      if (base[g.group] && typeof base[g.group][a.key] === 'boolean') {
        out[g.group][a.key] = base[g.group][a.key];
      }
    });
  });
  return out;
}

exports.list = async (req, res) => {
  const [rolesSnap, usersSnap] = await Promise.all([
    rolesCol().orderBy('name', 'asc').get(),
    usersCol().get(),
  ]);
  const roles = rolesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Tally how many users hold each role so the admin can see "no one is using
  // this role" before deleting it.
  const counts = {};
  usersSnap.forEach((d) => {
    const u = d.data();
    if (u.roleId) counts[u.roleId] = (counts[u.roleId] || 0) + 1;
  });

  res.render('roles/index', {
    title: 'Roles & Permissions',
    roles,
    counts,
  });
};

exports.addForm = (req, res) => {
  res.render('roles/edit', {
    title: 'New Role',
    role: { permissions: allPermissions() }, // start fully granted, opt down
    permissionRows: buildPermissionRows(allPermissions()),
    isNew: true,
  });
};

exports.editForm = async (req, res) => {
  const doc = await rolesCol().doc(req.params.id).get();
  if (!doc.exists) {
    req.flash('error', 'Role not found');
    return res.redirect('/settings/roles');
  }
  const role = { id: doc.id, ...doc.data() };
  res.render('roles/edit', {
    title: `Edit ${role.name}`,
    role,
    permissionRows: buildPermissionRows(role.permissions),
    isNew: false,
  });
};

// Pull a clean payload from the form submission. `key` is generated from the
// name unless we're editing a system role (whose key is frozen).
function readRoleBody(body, existing) {
  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  const permissions = normalizePermissions(body.permissions || {});

  const key = existing && existing.isSystem
    ? existing.key
    : (existing && existing.key) || slugify(name);

  return { name, description, permissions, key };
}

exports.create = async (req, res) => {
  try {
    const data = readRoleBody(req.body, null);
    if (!data.name) {
      req.flash('error', 'Role name is required');
      return res.redirect('/settings/roles/add');
    }
    const dup = await rolesCol().where('key', '==', data.key).limit(1).get();
    if (!dup.empty) {
      req.flash('error', `A role with key "${data.key}" already exists`);
      return res.redirect('/settings/roles/add');
    }
    await rolesCol().add({
      ...data,
      isSystem: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await log(req, 'role.create', {
      entity: 'role',
      summary: `Created role "${data.name}"`,
    });
    req.flash('success', `Role "${data.name}" created`);
    res.redirect('/settings/roles');
  } catch (err) {
    console.error('[roles] create failed:', err);
    req.flash('error', 'Failed to create role');
    res.redirect('/settings/roles/add');
  }
};

exports.update = async (req, res) => {
  try {
    const ref = rolesCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      req.flash('error', 'Role not found');
      return res.redirect('/settings/roles');
    }
    const existing = { id: doc.id, ...doc.data() };
    const data = readRoleBody(req.body, existing);

    if (!data.name) {
      req.flash('error', 'Role name is required');
      return res.redirect(`/settings/roles/${req.params.id}/edit`);
    }

    // Protect the built-in Admin from being downgraded to no permissions.
    if (existing.key === 'admin') {
      data.permissions = allPermissions();
    }

    await ref.update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
    await log(req, 'role.update', {
      entity: 'role',
      entityId: req.params.id,
      summary: `Updated role "${data.name}"`,
    });
    req.flash('success', `Role "${data.name}" updated`);
    res.redirect('/settings/roles');
  } catch (err) {
    console.error('[roles] update failed:', err);
    req.flash('error', 'Failed to update role');
    res.redirect(`/settings/roles/${req.params.id}/edit`);
  }
};

exports.remove = async (req, res) => {
  try {
    const ref = rolesCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      req.flash('error', 'Role not found');
      return res.redirect('/settings/roles');
    }
    const role = doc.data();

    if (role.isSystem) {
      req.flash('error', 'Built-in roles cannot be deleted');
      return res.redirect('/settings/roles');
    }

    // Don't leave orphan users — anyone assigned to this role is reset to
    // the default staff role, which is always present (seeded on boot).
    const staffSnap = await rolesCol().where('key', '==', 'staff').limit(1).get();
    const fallbackId = staffSnap.empty ? null : staffSnap.docs[0].id;

    const assigned = await usersCol().where('roleId', '==', req.params.id).get();
    const batch = db.batch();
    assigned.forEach((u) => {
      batch.update(u.ref, { roleId: fallbackId, updatedAt: new Date().toISOString() });
    });
    batch.delete(ref);
    await batch.commit();

    const moved = assigned.size;
    await log(req, 'role.delete', {
      entity: 'role',
      entityId: req.params.id,
      summary: `Deleted role "${role.name}"`,
      details: { usersMoved: moved },
    });
    req.flash('success',
      moved > 0
        ? `Role deleted. ${moved} user${moved === 1 ? '' : 's'} moved to Staff.`
        : 'Role deleted');
    res.redirect('/settings/roles');
  } catch (err) {
    console.error('[roles] remove failed:', err);
    req.flash('error', 'Failed to delete role');
    res.redirect('/settings/roles');
  }
};

// Exported for server.js bootstrap.
module.exports.seedDefaultRoles = seedDefaultRoles;
// Exposed so views can render the permission label/description if needed.
module.exports.PERMISSIONS_INDEX = PERMISSIONS_INDEX;

/**
 * Enforce invariants on the built-in Staff role that `mergePermissions()`
 * deliberately leaves alone. The general merger preserves an explicit
 * `false` for any action, which is the right behaviour for an admin-curated
 * role — but the Staff role has a few "must-have" permissions that the
 * day-to-day UI assumes, and silently stripping them is much worse than
 * refusing the edit.
 *
 * Today the only such invariant is `students.changeStatus`: the lifecycle
 * buttons on the student page and the list-view popup are wired up, and
 * blocking them for staff breaks the whole student flow. We force it on
 * here after `seedDefaultRoles` runs, so a stale Staff doc (one that
 * pre-dates the permission, was hand-edited, or lost the key in a
 * migration) gets healed on the next boot.
 */
async function enforceStaffInvariants() {
  const snap = await rolesCol().where('key', '==', 'staff').limit(1).get();
  if (snap.empty) return; // seedDefaultRoles will create it on the next boot
  const docRef = snap.docs[0].ref;
  const data = snap.docs[0].data();
  const perms = data.permissions || {};
  const students = { ...(perms.students || {}) };

  const must = { changeStatus: true };
  const needs = Object.entries(must).filter(
    ([k, v]) => students[k] !== v
  );
  if (needs.length === 0) return;

  needs.forEach(([k, v]) => { students[k] = v; });
  await docRef.update({
    permissions: { ...perms, students },
    updatedAt: new Date().toISOString(),
  });
  console.log(
    `[roles] enforced staff invariants: ${needs.map(([k]) => k).join(', ')} → true`
  );
}

module.exports.enforceStaffInvariants = enforceStaffInvariants;
