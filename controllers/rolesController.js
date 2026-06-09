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

function buildPermissionRows(permissions) {
  return PERMISSION_CATALOG.map((g) => ({
    ...g,
    actions: g.actions.map((a) => ({
      ...a,
      on: !!(permissions && permissions[g.group] && permissions[g.group][a.key]),
    })),
  }));
}

async function seedDefaultRoles(tenantId) {
  for (const r of DEFAULT_ROLES) {
    let existing;
    if (tenantId) {
      existing = await rolesCol()
        .where('tenantId', '==', tenantId)
        .where('key', '==', r.key)
        .limit(1)
        .get();
    } else {
      existing = await rolesCol()
        .where('key', '==', r.key)
        .limit(1)
        .get();
    }
    if (existing.empty) {
      await rolesCol().add({
        key: r.key,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        ...(tenantId ? { tenantId } : {}),
        isSystem: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[roles] seeded default role: ${r.name}${tenantId ? ` for tenant ${tenantId}` : ' (global)'}`);
      continue;
    }
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
  const tid = req.tenantId;
  const [rolesSnap, usersSnap] = await Promise.all([
    rolesCol().where('tenantId', '==', tid).get(),
    usersCol().where('tenantId', '==', tid).get(),
  ]);
  const roles = rolesSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

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
    role: { permissions: allPermissions() },
    permissionRows: buildPermissionRows(allPermissions()),
    isNew: true,
  });
};

exports.editForm = async (req, res) => {
  const doc = await rolesCol().doc(req.params.id).get();
  if (!doc.exists || doc.data().tenantId !== req.tenantId) {
    req.flash('error', 'Role not found');
    return res.redirect(`/${req.tenantSlug}/settings/roles`);
  }
  const role = { id: doc.id, ...doc.data() };
  res.render('roles/edit', {
    title: `Edit ${role.name}`,
    role,
    permissionRows: buildPermissionRows(role.permissions),
    isNew: false,
  });
};

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
      return res.redirect(`/${req.tenantSlug}/settings/roles/add`);
    }
    const dup = await rolesCol()
      .where('tenantId', '==', req.tenantId)
      .where('key', '==', data.key)
      .limit(1)
      .get();
    if (!dup.empty) {
      req.flash('error', `A role with key "${data.key}" already exists`);
      return res.redirect(`/${req.tenantSlug}/settings/roles/add`);
    }
    await rolesCol().add({
      ...data,
      tenantId: req.tenantId,
      isSystem: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await log(req, 'role.create', {
      entity: 'role',
      summary: `Created role "${data.name}"`,
    });
    req.flash('success', `Role "${data.name}" created`);
    res.redirect(`/${req.tenantSlug}/settings/roles`);
  } catch (err) {
    console.error('[roles] create failed:', err);
    req.flash('error', 'Failed to create role');
    res.redirect(`/${req.tenantSlug}/settings/roles/add`);
  }
};

exports.update = async (req, res) => {
  try {
    const ref = rolesCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Role not found');
      return res.redirect(`/${req.tenantSlug}/settings/roles`);
    }
    const existing = { id: doc.id, ...doc.data() };
    const data = readRoleBody(req.body, existing);

    if (!data.name) {
      req.flash('error', 'Role name is required');
      return res.redirect(`/${req.tenantSlug}/settings/roles/${req.params.id}/edit`);
    }

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
    res.redirect(`/${req.tenantSlug}/settings/roles`);
  } catch (err) {
    console.error('[roles] update failed:', err);
    req.flash('error', 'Failed to update role');
    res.redirect(`/${req.tenantSlug}/settings/roles/${req.params.id}/edit`);
  }
};

exports.remove = async (req, res) => {
  try {
    const ref = rolesCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Role not found');
      return res.redirect(`/${req.tenantSlug}/settings/roles`);
    }
    const role = doc.data();

    if (role.isSystem) {
      req.flash('error', 'Built-in roles cannot be deleted');
      return res.redirect(`/${req.tenantSlug}/settings/roles`);
    }

    const staffSnap = await rolesCol()
      .where('tenantId', '==', req.tenantId)
      .where('key', '==', 'staff')
      .limit(1)
      .get();
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
    res.redirect(`/${req.tenantSlug}/settings/roles`);
  } catch (err) {
    console.error('[roles] remove failed:', err);
    req.flash('error', 'Failed to delete role');
    res.redirect(`/${req.tenantSlug}/settings/roles`);
  }
};

module.exports.seedDefaultRoles = seedDefaultRoles;
module.exports.PERMISSIONS_INDEX = PERMISSIONS_INDEX;

async function enforceStaffInvariants(tenantId) {
  let snap;
  if (tenantId) {
    snap = await rolesCol()
      .where('tenantId', '==', tenantId)
      .where('key', '==', 'staff')
      .limit(1)
      .get();
  } else {
    snap = await rolesCol()
      .where('key', '==', 'staff')
      .limit(1)
      .get();
  }
  if (snap.empty) return;
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
