// Admin-only user management (create staff/admin accounts).

const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');
const { record: log } = require('../utils/logger');

const usersCol = () => db.collection('users');
const rolesCol = () => db.collection('roles');

// Same vocabulary the students collection uses, so the kitchen dashboard can
// roll both populations into one meal plan.
const DIET_OPTIONS = ['veg', 'nonveg', 'eggOnly'];
const DIET_LABELS = { veg: 'Veg', nonveg: 'Non-veg', eggOnly: 'Egg only' };
const ROLES = ['admin', 'staff'];

// Default: new accounts are active. Legacy records without the field are
// treated as active too (so a one-time migration isn't required).
const isActive = (u) => u.active === undefined ? true : !!u.active;

// Resolve the roleId for a new or edited user. The form submits the chosen
// role's document id, but we also accept the legacy `role` radio (admin /
// staff) and convert it to the matching role doc for backward compatibility.
async function resolveRoleId(body) {
  if (body.roleId) return body.roleId;
  const key = ROLES.includes(body.role) ? body.role : 'staff';
  const snap = await rolesCol().where('key', '==', key).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

// Look up a role doc's `key` (e.g. 'admin' / 'staff') from its id. Returns
// null if the roleId is missing or the doc doesn't exist. Used to keep the
// legacy `role` field in sync with the chosen roleId.
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

// Fetch the list of roles for the add/edit forms. We re-fetch on every render
// so newly-created roles show up without a server restart.
async function loadRoleChoices() {
  const snap = await rolesCol().orderBy('name', 'asc').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Pull the writable user payload from req.body. Keeps create/update DRY.
//
// Important: we deliberately do NOT default `role` to 'staff' when it's
// missing. The new add/edit form posts `roleId` (a Firestore doc id) instead
// of the legacy `admin`/`staff` radio, so leaving the legacy field undefined
// lets `resolveRoleId()` figure it out from the roleId — and `resolveUserPermissions`
// (in utils/permissions.js) trusts roleId as the source of truth.
function readUserBody(body) {
  const role = ROLES.includes(body.role) ? body.role : null;
  const dietary = DIET_OPTIONS.includes(body.dietary) ? body.dietary : 'veg';
  return { name: (body.name || '').trim(), email: (body.email || '').trim(), role, dietary };
}

exports.list = async (req, res) => {
  const [snap, roles] = await Promise.all([
    usersCol().orderBy('createdAt', 'desc').get(),
    loadRoleChoices(),
  ]);
  // Build a quick lookup so the view can show the role name next to each user.
  const rolesById = new Map(roles.map((r) => [r.id, r]));

  // Self-healing: any user whose legacy `role` field disagrees with the
  // roleId's `key` was created during the brief window when readUserBody
  // hard-coded `role: 'staff'`. Fix it on the fly so the user list pill and
  // the navbar badge reflect the actual role. Idempotent — runs only when
  // there's a real mismatch.
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
    return {
      id: d.id,
      ...data,
      roleName: roleDoc ? roleDoc.name : null,
    };
  });
  if (fixes.length) {
    Promise.all(fixes).catch((err) =>
      console.warn('[users] role backfill failed:', err.message)
    );
  }

  res.render('users/index', { title: 'Users', users, dietLabels: DIET_LABELS });
};

exports.addForm = async (req, res) => {
  const roles = await loadRoleChoices();
  res.render('users/add', { title: 'Add User', dietLabels: DIET_LABELS, values: {}, roles });
};

exports.create = async (req, res) => {
  try {
    const data = readUserBody(req.body);
    const password = req.body.password || '';
    if (!data.name || !data.email || !password) {
      req.flash('error', 'Name, email, and password are required');
      return res.redirect('/users/add');
    }
    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters');
      return res.redirect('/users/add');
    }
    const dup = await usersCol().where('email', '==', data.email).limit(1).get();
    if (!dup.empty) {
      req.flash('error', 'A user with that email already exists');
      return res.redirect('/users/add');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const roleId = await resolveRoleId(req.body);
    // Keep the legacy `role` field in sync with the chosen roleId so the
    // user list pill and the navbar badge stay accurate. The roleId doc
    // wins for permission checks (see resolveUserPermissions).
    const roleKey = await lookupRoleKey(roleId);
    await usersCol().add({
      ...data,
      // If the form sent roleId, it overrides whatever the form sent for the
      // legacy `role` field. If it didn't, fall back to whatever was posted.
      role: roleKey || data.role || 'staff',
      roleId: roleId || null,
      passwordHash,
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
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create user');
    res.redirect('/users/add');
  }
};

exports.editForm = async (req, res) => {
  const [doc, roles] = await Promise.all([
    usersCol().doc(req.params.id).get(),
    loadRoleChoices(),
  ]);
  if (!doc.exists) {
    req.flash('error', 'User not found');
    return res.redirect('/users');
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
    if (!doc.exists) {
      req.flash('error', 'User not found');
      return res.redirect('/users');
    }
    const data = readUserBody(req.body);
    if (!data.name || !data.email) {
      req.flash('error', 'Name and email are required');
      return res.redirect(`/users/${req.params.id}/edit`);
    }
    // Email change — make sure it doesn't collide with another user.
    if (data.email !== doc.data().email) {
      const dup = await usersCol().where('email', '==', data.email).limit(1).get();
      if (!dup.empty) {
        req.flash('error', 'Another user already has that email');
        return res.redirect(`/users/${req.params.id}/edit`);
      }
    }
    const update = { ...data, updatedAt: new Date().toISOString() };

    // Role assignment — pick up the roleId from the form, falling back to
    // the legacy `role` radio if it's still being posted by old clients.
    update.roleId = await resolveRoleId(req.body);

    // Keep the legacy `role` field in sync with the chosen roleId so the
    // user list pill and the navbar badge stay accurate. The roleId is the
    // source of truth for permission checks.
    const roleKey = await lookupRoleKey(update.roleId);
    if (roleKey) update.role = roleKey;

    // Optional password reset — only when a value is provided.
    const password = req.body.password || '';
    if (password) {
      if (password.length < 6) {
        req.flash('error', 'Password must be at least 6 characters');
        return res.redirect(`/users/${req.params.id}/edit`);
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
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update user');
    res.redirect(`/users/${req.params.id}/edit`);
  }
};

/**
 * Toggle the active flag on a user account. Inactive accounts can't sign in
 * (see controllers/authController.js). Refuses to deactivate yourself so a
 * logged-in admin can never accidentally lock themselves out.
 */
exports.toggleActive = async (req, res) => {
  try {
    if (req.params.id === req.session.user.id) {
      req.flash('error', 'You cannot deactivate your own account');
      return res.redirect('/users');
    }
    const ref = usersCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      req.flash('error', 'User not found');
      return res.redirect('/users');
    }
    const current = isActive(doc.data());
    await ref.update({ active: !current, updatedAt: new Date().toISOString() });
    await log(req, current ? 'user.deactivate' : 'user.activate', {
      entity: 'user',
      entityId: req.params.id,
      summary: `${current ? 'Deactivated' : 'Reactivated'} user ${doc.data().name || doc.data().email || req.params.id}`,
    });
    req.flash('success', current ? 'User deactivated' : 'User reactivated');
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update user status');
    res.redirect('/users');
  }
};

exports.remove = async (req, res) => {
  try {
    if (req.params.id === req.session.user.id) {
      req.flash('error', 'You cannot delete your own account');
      return res.redirect('/users');
    }
    // Pull the name/email first so we still have something meaningful in
    // the log after the doc is gone.
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
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete user');
    res.redirect('/users');
  }
};

// Exported so authController can use the same definition.
exports.isActive = isActive;
