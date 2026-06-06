// Tiny session-backed flash middleware.
// Drop-in replacement for connect-flash (which is unmaintained and triggers
// the util.isArray DEP0044 warning on modern Node).
//
// Usage: app.use(flash())  -> then req.flash('error', 'msg') / req.flash('error')
// Just like connect-flash: setting a value pushes onto the bucket, calling
// without a value returns the bucket and clears it.

module.exports = function flash() {
  return function (req, res, next) {
    if (!req.session) {
      return next(new Error('flash() requires sessions — mount express-session first'));
    }
    req.flash = function (type, msg) {
      const store = (req.session.flash = req.session.flash || {});
      if (type && msg !== undefined) {
        store[type] = store[type] || [];
        store[type].push(msg);
        return store[type];
      }
      if (type) {
        const out = store[type] || [];
        delete store[type];
        return out;
      }
      const all = { ...store };
      req.session.flash = {};
      return all;
    };
    next();
  };
};
