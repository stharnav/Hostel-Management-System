// Session-based auth guards.

const { db } = require('../config/firebase');
const { resolveUserPermissions } = require('../utils/permissions');

function ensureAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  // Redirect to the correct login page based on context
  if (req.tenantSlug) {
    req.flash('error', 'Please log in first');
    return res.redirect(`/${req.tenantSlug}/auth/login`);
  }
  if (req.isAdminRoute) {
    req.flash('error', 'Please log in first');
    return res.redirect('/admin/auth/login');
  }
  req.flash('error', 'Please log in first');
  return res.redirect('/');
}

/**
 * Allow only specific legacy roles (admin / staff). Kept for routes that
 * don't have a permission yet — prefer `ensurePermission` for anything new.
 */
function ensureRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash('error', 'Please log in first');
      if (req.tenantSlug) return res.redirect(`/${req.tenantSlug}/auth/login`);
      if (req.isAdminRoute) return res.redirect('/admin/auth/login');
      return res.redirect('/');
    }
    if (!roles.includes(req.session.user.role)) {
      req.flash('error', 'You do not have access to that page');
      if (req.tenantSlug) return res.redirect(`/${req.tenantSlug}/dashboard`);
      return res.redirect('/admin/dashboard');
    }
    next();
  };
}

/**
 * Guard a route by a single permission key like 'students.create'. Admins
 * bypass the check (they always have every permission). Other users are
 * allowed when their `req.session.user.permissions` Set contains the key.
 */
function ensurePermission(key) {
  return async (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash('error', 'Please log in first');
      if (req.tenantSlug) return res.redirect(`/${req.tenantSlug}/auth/login`);
      if (req.isAdminRoute) return res.redirect('/admin/auth/login');
      return res.redirect('/');
    }
    const user = req.session.user;
    if (user.role === 'admin') return next();
    if (user.permissions && user.permissions.has(key)) return next();

    // Cache miss — re-resolve from Firestore and patch the session in place
    try {
      if (user.id) {
        const userDoc = await db.collection('users').doc(user.id).get();
        if (userDoc.exists) {
          const perms = await resolveUserPermissions(db, userDoc.data());
          user.permissions = perms;
          if (perms.has(key)) return next();
        }
      }
    } catch (err) {
      console.warn('[auth] permission re-resolve failed:', err.message);
    }

    req.flash('error', `You do not have permission to ${key.replace('.', ' ')}`);
    const referer = req.get('referer') || req.get('referrer');
    if (referer) return res.redirect(referer);
    if (req.tenantSlug) return res.redirect(`/${req.tenantSlug}/dashboard`);
    return res.redirect('/admin/dashboard');
  };
}

module.exports = { ensureAuth, ensureRole, ensurePermission };
