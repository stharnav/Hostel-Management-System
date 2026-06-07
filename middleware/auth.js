// Session-based auth guards.

function ensureAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please log in first');
  return res.redirect('/auth/login');
}

/**
 * Allow only specific legacy roles (admin / staff). Kept for routes that
 * don't have a permission yet — prefer `ensurePermission` for anything new.
 */
function ensureRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash('error', 'Please log in first');
      return res.redirect('/auth/login');
    }
    if (!roles.includes(req.session.user.role)) {
      req.flash('error', 'You do not have access to that page');
      return res.redirect('/dashboard');
    }
    next();
  };
}

/**
 * Guard a route by a single permission key like 'students.create'. Admins
 * bypass the check (they always have every permission). Other users are
 * allowed when their `req.session.user.permissions` Set contains the key.
 *
 * The Set is hydrated on login and refreshed on every request via the
 * `res.locals` middleware in server.js, so role changes take effect without
 * forcing a re-login.
 */
function ensurePermission(key) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      req.flash('error', 'Please log in first');
      return res.redirect('/auth/login');
    }
    const user = req.session.user;
    if (user.role === 'admin') return next();
    if (user.permissions && user.permissions.has(key)) return next();

    req.flash('error', `You do not have permission to ${key.replace('.', ' ')}`);
    // `res.redirect('back')` throws when there's no Referer header (e.g. when
    // the user typed the URL, opened it in a new tab, or came from a form
    // POST). Fall back to the Referer when present, else /dashboard.
    const referer = req.get('referer') || req.get('referrer');
    if (referer) return res.redirect(referer);
    return res.redirect('/dashboard');
  };
}

module.exports = { ensureAuth, ensureRole, ensurePermission };
