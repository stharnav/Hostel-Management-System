// Admin-only user management (create staff/admin accounts).

const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');

const usersCol = () => db.collection('users');

// Same vocabulary the students collection uses, so the kitchen dashboard can
// roll both populations into one meal plan.
const DIET_OPTIONS = ['veg', 'nonveg', 'eggOnly'];
const DIET_LABELS = { veg: 'Veg', nonveg: 'Non-veg', eggOnly: 'Egg only' };
const ROLES = ['admin', 'staff'];

// Default: new accounts are active. Legacy records without the field are
// treated as active too (so a one-time migration isn't required).
const isActive = (u) => u.active === undefined ? true : !!u.active;

// Pull the writable user payload from req.body. Keeps create/update DRY.
function readUserBody(body) {
  const role = ROLES.includes(body.role) ? body.role : 'staff';
  const dietary = DIET_OPTIONS.includes(body.dietary) ? body.dietary : 'veg';
  return { name: (body.name || '').trim(), email: (body.email || '').trim(), role, dietary };
}

exports.list = async (req, res) => {
  const snap = await usersCol().orderBy('createdAt', 'desc').get();
  const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  res.render('users/index', { title: 'Users', users, dietLabels: DIET_LABELS });
};

exports.addForm = (req, res) => {
  res.render('users/add', { title: 'Add User', dietLabels: DIET_LABELS, values: {} });
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
    await usersCol().add({
      ...data,
      passwordHash,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
  const doc = await usersCol().doc(req.params.id).get();
  if (!doc.exists) {
    req.flash('error', 'User not found');
    return res.redirect('/users');
  }
  res.render('users/edit', {
    title: 'Edit User',
    user: { id: doc.id, ...doc.data() },
    dietLabels: DIET_LABELS,
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
    await usersCol().doc(req.params.id).delete();
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
