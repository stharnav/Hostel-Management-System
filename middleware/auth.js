// Session-based auth guards.

function ensureAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please log in first');
  return res.redirect('/auth/login');
}

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

module.exports = { ensureAuth, ensureRole };
