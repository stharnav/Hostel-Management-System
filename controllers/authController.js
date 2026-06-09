const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');
const { isActive } = require('./userController');
const { resolveUserPermissions } = require('../utils/permissions');
const { record: log } = require('../utils/logger');

const usersCol = () => db.collection('users');

exports.getLogin = (req, res) => {
  // Super admin login
  if (req.isAdminRoute && !req.tenantSlug) {
    return res.render('auth/admin-login', { title: 'Super Admin Login' });
  }
  // Tenant login
  if (req.tenantSlug) {
    return res.render('auth/login', { title: 'Login' });
  }
  // No context — redirect to root
  return res.redirect('/');
};

exports.postLogin = async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      req.flash('error', 'Email and password are required');
      if (req.tenantSlug) return res.redirect(`/${req.tenantSlug}/auth/login`);
      if (req.isAdminRoute) return res.redirect('/admin/auth/login');
      return res.redirect('/');
    }

    // Case-insensitive lookup
    const snap = await usersCol().get();
    let doc = snap.docs.find(
      (d) => (d.data().email || '').toLowerCase() === email
    );

    if (!doc) {
      console.warn(`[auth] no user found for ${email}`);
      await log(req, 'auth.login_failed', { summary: `Failed sign-in for ${email}` });
      req.flash('error', 'Invalid email or password');
      if (req.tenantSlug) return res.redirect(`/${req.tenantSlug}/auth/login`);
      if (req.isAdminRoute) return res.redirect('/admin/auth/login');
      return res.redirect('/');
    }

    const user = doc.data();
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) {
      console.warn(`[auth] password mismatch for ${email}`);
      await log(req, 'auth.login_failed', { summary: `Wrong password for ${email}` });
      req.flash('error', 'Invalid email or password');
      if (req.tenantSlug) return res.redirect(`/${req.tenantSlug}/auth/login`);
      if (req.isAdminRoute) return res.redirect('/admin/auth/login');
      return res.redirect('/');
    }

    if (!isActive(user)) {
      console.warn(`[auth] inactive account ${email} tried to log in`);
      await log(req, 'auth.login_failed', { summary: `Inactive account attempted sign-in: ${email}` });
      req.flash('error', 'Invalid email or password');
      if (req.tenantSlug) return res.redirect(`/${req.tenantSlug}/auth/login`);
      if (req.isAdminRoute) return res.redirect('/admin/auth/login');
      return res.redirect('/');
    }

    // Super admin login (no tenant context)
    if (req.isAdminRoute && !req.tenantSlug) {
      if (!user.isSuperAdmin) {
        req.flash('error', 'Invalid email or password');
        return res.redirect('/admin/auth/login');
      }
      const permissions = await resolveUserPermissions(db, user);
      req.session.user = {
        id: doc.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleId: user.roleId || null,
        permissions,
        isSuperAdmin: true,
      };
      await log(req, 'auth.login', { summary: `${user.name} signed in (super admin)` });
      req.flash('success', `Welcome back, ${user.name}`);
      return res.redirect('/admin/dashboard');
    }

    // Tenant login — verify user belongs to this tenant
    if (req.tenantSlug && req.tenantId) {
      if (user.tenantId !== req.tenantId) {
        // User exists but not in this tenant — check if they're a super admin
        if (!user.isSuperAdmin) {
          req.flash('error', 'Invalid email or password');
          return res.redirect(`/${req.tenantSlug}/auth/login`);
        }
      }
    }

    const permissions = await resolveUserPermissions(db, user);
    req.session.user = {
      id: doc.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleId: user.roleId || null,
      permissions,
      isSuperAdmin: !!user.isSuperAdmin,
    };

    // Store tenant info in session
    if (req.tenantSlug) {
      req.session.tenantSlug = req.tenantSlug;
      req.session.tenantId = req.tenantId;
    }

    await log(req, 'auth.login', { summary: `${user.name} signed in` });
    req.flash('success', `Welcome back, ${user.name}`);

    if (req.tenantSlug) {
      res.redirect(`/${req.tenantSlug}/dashboard`);
    } else {
      res.redirect('/admin/dashboard');
    }
  } catch (err) {
    console.error('[auth] login error:', err);
    req.flash('error', 'Something went wrong — check server logs');
    if (req.tenantSlug) return res.redirect(`/${req.tenantSlug}/auth/login`);
    if (req.isAdminRoute) return res.redirect('/admin/auth/login');
    res.redirect('/');
  }
};

exports.logout = async (req, res) => {
  const user = req.session && req.session.user;
  const tenantSlug = req.session && req.session.tenantSlug;
  if (user) {
    await log(req, 'auth.logout', { summary: `${user.name} signed out` });
  }
  const redirectTarget = tenantSlug ? `/${tenantSlug}/auth/login` : '/admin/auth/login';
  req.session.destroy(() => res.redirect(redirectTarget));
};
