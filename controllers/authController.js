const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');
const { isActive } = require('./userController');
const { resolveUserPermissions } = require('../utils/permissions');
const { record: log } = require('../utils/logger');

const usersCol = () => db.collection('users');

exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Login' });
};

exports.postLogin = async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      req.flash('error', 'Email and password are required');
      return res.redirect('/auth/login');
    }

    // Case-insensitive lookup — emails are stored as entered, so scan and match.
    const snap = await usersCol().get();
    const doc = snap.docs.find(
      (d) => (d.data().email || '').toLowerCase() === email
    );
    if (!doc) {
      console.warn(`[auth] no user found for ${email}`);
      // Record the attempt with the email as the actor. We don't know the
      // user id, so the activity feed will show the email they tried.
      await log(req, 'auth.login_failed', { summary: `Failed sign-in for ${email}` });
      req.flash('error', 'Invalid email or password');
      return res.redirect('/auth/login');
    }
    const user = doc.data();
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) {
      console.warn(`[auth] password mismatch for ${email}`);
      await log(req, 'auth.login_failed', { summary: `Wrong password for ${email}` });
      req.flash('error', 'Invalid email or password');
      return res.redirect('/auth/login');
    }
    // Inactive accounts (deactivated by an admin) can't sign in. Use the same
    // generic message as a wrong password so we don't leak account existence.
    if (!isActive(user)) {
      console.warn(`[auth] inactive account ${email} tried to log in`);
      await log(req, 'auth.login_failed', { summary: `Inactive account attempted sign-in: ${email}` });
      req.flash('error', 'Invalid email or password');
      return res.redirect('/auth/login');
    }
    // Hydrate the permission Set once at login. The server-wide middleware
    // refreshes it on every request, so role edits take effect without
    // forcing a re-login.
    const permissions = await resolveUserPermissions(db, user);
    req.session.user = {
      id: doc.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleId: user.roleId || null,
      permissions,
    };
    // Now that the session is populated, the logger can identify the actor.
    await log(req, 'auth.login', { summary: `${user.name} signed in` });
    req.flash('success', `Welcome back, ${user.name}`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error('[auth] login error:', err);
    req.flash('error', 'Something went wrong — check server logs');
    res.redirect('/auth/login');
  }
};

exports.logout = async (req, res) => {
  // The session is about to be destroyed, but the logger reads from it
  // synchronously, so we can still pull the actor. Use a callback wrapper
  // that fires the log *before* the destroy callback runs.
  const user = req.session && req.session.user;
  if (user) {
    await log(req, 'auth.logout', { summary: `${user.name} signed out` });
  }
  req.session.destroy(() => res.redirect('/auth/login'));
};
