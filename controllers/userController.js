const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');
const { record: log } = require('../utils/logger');

const usersCol = () => db.collection('users');
const rolesCol = () => db.collection('roles');

const DIET_OPTIONS = ['veg', 'nonveg', 'eggOnly'];
const DIET_LABELS = { veg: 'Veg', nonveg: 'Non-veg', eggOnly: 'Egg only' };
const ROLES = ['admin', 'staff'];

const isActive = (u) => u.active === undefined ? true : !!u.active;

async function resolveRoleId(body, tenantId) {
  if (body.roleId) return body.roleId;
  const key = ROLES.includes(body.role) ? body.role : 'staff';
  const snap = await rolesCol().where('tenantId', '==', tenantId).where('key', '==', key).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

async function lookupRoleKey(roleId) {
  if (!roleId) return null;
  try {
    const doc = await rolesCol().doc(roleId).get();
    if (!doc.exists) return null;
    return doc.data().key || null;
  } catch (err) {
    console.warn('[users] lookupRoleKey failed:', err.message);
    return null;
  }
}

async function loadRoleChoices(tenantId) {
  const snap = await rolesCol().where('tenantId', '==', tenantId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function readUserBody(body) {
  const role = ROLES.includes(body.role) ? body.role : null;
  const dietary = DIET_OPTIONS.includes(body.dietary) ? body.dietary : 'veg';
  return { name: (body.name || '').trim(), email: (body.email || '').trim(), role, dietary };
}

exports.list = async (req, res) => {
  const tid = req.tenantId;
  const [snap, roles] = await Promise.all([
    usersCol().where('tenantId', '==', tid).get(),
    loadRoleChoices(tid),
  ]);
  const rolesById = new Map(roles.map((r) => [r.id, r]));

  const fixes = [];
  const users = snap.docs.map((d) => {
    const data = d.data();
    const roleDoc = data.roleId ? rolesById.get(data.roleId) : null;
    const expectedKey = roleDoc ? roleDoc.key : null;
    if (expectedKey && data.role !== expectedKey) {
      fixes.push(d.ref.update({
        role: expectedKey,
        updatedAt: new Date().toISOString(),
      }));
    }
    return { id: d.id, ...data, roleName: roleDoc ? roleDoc.name : null };
  }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (fixes.length) {
    Promise.all(fixes).catch((err) =>
      console.warn('[users] role backfill failed:', err.message)
    );
  }

  res.render('users/index', { title: 'Users', users, dietLabels: DIET_LABELS });
};

exports.addForm = async (req, res) => {
  const roles = await loadRoleChoices(req.tenantId);
  res.render('users/add', { title: 'Add User', dietLabels: DIET_LABELS, values: {}, roles });
};

exports.create = async (req, res) => {
  try {
    const data = readUserBody(req.body);
    const password = req.body.password || '';
    if (!data.name || !data.email || !password) {
      req.flash('error', 'Name, email, and password are required');
      return res.redirect(`/${req.tenantSlug}/users/add`);
    }
    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters');
      return res.redirect(`/${req.tenantSlug}/users/add`);
    }
    const dup = await usersCol().where('email', '==', data.email).limit(1).get();
    if (!dup.empty) {
      req.flash('error', 'A user with that email already exists');
      return res.redirect(`/${req.tenantSlug}/users/add`);
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const roleId = await resolveRoleId(req.body, req.tenantId);
    const roleKey = await lookupRoleKey(roleId);
    await usersCol().add({
      ...data,
      role: roleKey || data.role || 'staff',
      roleId: roleId || null,
      passwordHash,
      tenantId: req.tenantId,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await log(req, 'user.create', {
      entity: 'user',
      summary: `Created user ${data.name} (${data.email})`,
      details: { role: roleKey || data.role || 'staff' },
    });
    req.flash('success', 'User created');
    res.redirect(`/${req.tenantSlug}/users`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create user');
    res.redirect(`/${req.tenantSlug}/users/add`);
  }
};

exports.editForm = async (req, res) => {
  const [doc, roles] = await Promise.all([
    usersCol().doc(req.params.id).get(),
    loadRoleChoices(req.tenantId),
  ]);
  if (!doc.exists || doc.data().tenantId !== req.tenantId) {
    req.flash('error', 'User not found');
    return res.redirect(`/${req.tenantSlug}/users`);
  }
  res.render('users/edit', {
    title: 'Edit User',
    user: { id: doc.id, ...doc.data() },
    dietLabels: DIET_LABELS,
    roles,
  });
};

exports.update = async (req, res) => {
  try {
    const ref = usersCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().tenantId !== req.tenantId) {
      req.flash('error', 'User not found');
      return res.redirect(`/${req.tenantSlug}/users`);
    }
    const data = readUserBody(req.body);
    if (!data.name || !data.email) {
      req.flash('error', 'Name and email are required');
      return res.redirect(`/${req.tenantSlug}/users/${req.params.id}/edit`);
    }
    if (data.email !== doc.data().email) {
      const dup = await usersCol().where('email', '==', data.email).limit(1).get();
      if (!dup.empty) {
        req.flash('error', 'Another user already has that email');
        return res.redirect(`/${req.tenantSlug}/users/${req.params.id}/edit`);
      }
    }
    const update = { ...data, updatedAt: new Date().toISOString() };
    update.roleId = await resolveRoleId(req.body, req.tenantId);
    const roleKey = await lookupRoleKey(update.roleId);
    if (roleKey) update.role = roleKey;

    const password = req.body.password || '';
    if (password) {
      if (password.length < 6) {
        req.flash('error', 'Password must be at least 6 characters');
        return res.redirect(`/${req.tenantSlug}/users/${req.params.id}/edit`);
      }
      update.passwordHash = await bcrypt.hash(password, 10);
    }

    await ref.update(update);
    await log(req, 'user.update', {
      entity: 'user',
      entityId: req.params.id,
      summary: `Updated user ${data.name} (${data.email})`,
      details: { passwordReset: !!password },
    });
    req.flash('success', 'User updated');
    res.redirect(`/${req.tenantSlug}/users`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update user');
    res.redirect(`/${req.tenantSlug}/users/${req.params.id}/edit`);
  }
};

exports.toggleActive = async (req, res) => {
  try {
    if (req.params.id === req.session.user.id) {
      req.flash('error', 'You cannot deactivate your own account');
      return res.redirect(`/${req.tenantSlug}/users`);
    }
    const ref = usersCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().tenantId !== req.tenantId) {
      req.flash('error', 'User not found');
      return res.redirect(`/${req.tenantSlug}/users`);
    }
    const current = isActive(doc.data());
    await ref.update({ active: !current, updatedAt: new Date().toISOString() });
    await log(req, current ? 'user.deactivate' : 'user.activate', {
      entity: 'user',
      entityId: req.params.id,
      summary: `${current ? 'Deactivated' : 'Reactivated'} user ${doc.data().name || doc.data().email || req.params.id}`,
    });
    req.flash('success', current ? 'User deactivated' : 'User reactivated');
    res.redirect(`/${req.tenantSlug}/users`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update user status');
    res.redirect(`/${req.tenantSlug}/users`);
  }
};

exports.remove = async (req, res) => {
  try {
    if (req.params.id === req.session.user.id) {
      req.flash('error', 'You cannot delete your own account');
      return res.redirect(`/${req.tenantSlug}/users`);
    }
    const ref = usersCol().doc(req.params.id);
    const snap = await ref.get();
    const deletedLabel = snap.exists
      ? (snap.data().name || snap.data().email || req.params.id)
      : req.params.id;
    await ref.delete();
    await log(req, 'user.delete', {
      entity: 'user',
      entityId: req.params.id,
      summary: `Deleted user ${deletedLabel}`,
    });
    req.flash('success', 'User deleted');
    res.redirect(`/${req.tenantSlug}/users`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete user');
    res.redirect(`/${req.tenantSlug}/users`);
  }
};

exports.isActive = isActive;
