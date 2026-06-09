const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');
const { isActive } = require('./userController');

const usersCol = () => db.collection('users');

const DIET_LABELS = { veg: 'Veg', nonveg: 'Non-veg', eggOnly: 'Egg only' };
const DIET_OPTIONS = Object.keys(DIET_LABELS);

async function loadCurrentUser(req) {
  const ref = usersCol().doc(req.session.user.id);
  const doc = await ref.get();
  if (!doc.exists) return null;
  return { ref, data: { id: doc.id, ...doc.data() } };
}

exports.show = async (req, res) => {
  const me = await loadCurrentUser(req);
  if (!me) {
    req.flash('error', 'Account not found');
    return res.redirect('/auth/logout');
  }
  res.render('profile/index', {
    title: 'My Profile',
    user: me.data,
    dietLabels: DIET_LABELS,
  });
};

exports.update = async (req, res) => {
  try {
    const me = await loadCurrentUser(req);
    if (!me) {
      req.flash('error', 'Account not found');
      return res.redirect('/auth/logout');
    }

    const update = { updatedAt: new Date().toISOString() };
    let changed = false;

    if (req.body.dietary !== undefined) {
      if (DIET_OPTIONS.includes(req.body.dietary)) {
        update.dietary = req.body.dietary;
        changed = true;
      }
    }

    const currentPassword = req.body.currentPassword || '';
    const newPassword     = req.body.newPassword || '';
    const confirmPassword = req.body.confirmPassword || '';

    if (currentPassword || newPassword || confirmPassword) {
      if (!currentPassword || !newPassword || !confirmPassword) {
        req.flash('error', 'To change your password, fill in current, new, and confirm fields');
        return res.redirect(`/${req.tenantSlug}/profile`);
      }
      const matches = await bcrypt.compare(currentPassword, me.data.passwordHash || '');
      if (!matches) {
        req.flash('error', 'Current password is incorrect');
        return res.redirect(`/${req.tenantSlug}/profile`);
      }
      if (newPassword.length < 6) {
        req.flash('error', 'New password must be at least 6 characters');
        return res.redirect(`/${req.tenantSlug}/profile`);
      }
      if (newPassword !== confirmPassword) {
        req.flash('error', 'New password and confirmation do not match');
        return res.redirect(`/${req.tenantSlug}/profile`);
      }
      update.passwordHash = await bcrypt.hash(newPassword, 10);
      changed = true;
    }

    if (!changed) {
      req.flash('error', 'Nothing to update');
      return res.redirect(`/${req.tenantSlug}/profile`);
    }

    await me.ref.update(update);
    req.flash('success', 'Profile updated');
    res.redirect(`/${req.tenantSlug}/profile`);
  } catch (err) {
    console.error('[profile] update failed:', err);
    req.flash('error', 'Failed to update profile');
    res.redirect(`/${req.tenantSlug}/profile`);
  }
};
