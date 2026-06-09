// Tenant resolution middleware.
// Resolves the current tenant from the URL path and attaches tenant info
// to the request for downstream controllers and views.
//
// URL structure:
//   /admin/*          → super admin panel (no tenant context)
//   /:tenantSlug/*    → tenant-scoped routes
//   /                 → tenant selection page

const { getTenantBySlug } = require('../models/tenant');

/**
 * Middleware that resolves the tenant from the URL and attaches it to req.
 * Must be mounted AFTER the admin routes so /admin/* is handled first.
 *
 * Sets:
 *   req.tenant     — { id, slug, name, ... } or null for admin routes
 *   req.tenantId   — Firestore doc ID or null
 *   req.tenantSlug — URL slug or null
 *   req.isAdminRoute — true if the URL starts with /admin
 */
async function resolveTenant(req, res, next) {
  const path = req.path || '';

  // Admin routes — no tenant context
  if (path.startsWith('/admin') || req.baseUrl?.startsWith('/admin')) {
    req.tenant = null;
    req.tenantId = null;
    req.tenantSlug = null;
    req.isAdminRoute = true;
    res.locals.tenant = null;
    res.locals.tenantId = null;
    res.locals.tenantSlug = null;
    res.locals.isAdminRoute = true;
    res.locals.basePath = '/admin';
    return next();
  }

  // Extract tenant slug from the first path segment
  const segments = path.split('/').filter(Boolean);
  const slug = segments[0] || null;

  if (!slug) {
    // Root path — show tenant selection
    req.tenant = null;
    req.tenantId = null;
    req.tenantSlug = null;
    req.isAdminRoute = false;
    res.locals.tenant = null;
    res.locals.tenantId = null;
    res.locals.tenantSlug = null;
    res.locals.isAdminRoute = false;
    res.locals.basePath = '';
    return next();
  }

  // Check if the first segment is a known reserved route (not a tenant)
  const reservedRoutes = [
    'auth', 'dashboard', 'users', 'students', 'rooms',
    'fees', 'settings', 'kitchen', 'profile', 'logs', 'expenses',
  ];
  if (reservedRoutes.includes(slug)) {
    // Legacy single-tenant URL — redirect to root for tenant selection
    // Or, if the user has a session with a tenant, use that
    if (req.session && req.session.tenantSlug) {
      return res.redirect(`/${req.session.tenantSlug}${path}`);
    }
    return res.redirect('/');
  }

  // Look up the tenant by slug
  try {
    const tenant = await getTenantBySlug(slug);
    if (!tenant) {
      req.tenant = null;
      req.tenantId = null;
      req.tenantSlug = slug;
      req.isAdminRoute = false;
      res.locals.tenant = null;
      res.locals.tenantId = null;
      res.locals.tenantSlug = slug;
      res.locals.isAdminRoute = false;
      res.locals.basePath = `/${slug}`;
      // Don't 404 here — let the route handler decide
      return next();
    }

    req.tenant = tenant;
    req.tenantId = tenant.id;
    req.tenantSlug = tenant.slug;
    req.tenantInactive = tenant.active === false;
    req.isAdminRoute = false;

    res.locals.tenant = tenant;
    res.locals.tenantId = tenant.id;
    res.locals.tenantSlug = tenant.slug;
    res.locals.tenantInactive = tenant.active === false;
    res.locals.isAdminRoute = false;
    res.locals.basePath = `/${tenant.slug}`;

    // Store in session for redirect logic
    if (req.session) {
      req.session.tenantSlug = tenant.slug;
      req.session.tenantId = tenant.id;
    }

    next();
  } catch (err) {
    console.error('[tenant] resolution failed:', err.message);
    req.tenant = null;
    req.tenantId = null;
    req.tenantSlug = slug;
    req.isAdminRoute = false;
    res.locals.tenant = null;
    res.locals.tenantId = null;
    res.locals.tenantSlug = slug;
    res.locals.isAdminRoute = false;
    res.locals.basePath = `/${slug}`;
    next();
  }
}

/**
 * Middleware that requires the request to be in a tenant context.
 * Returns 404 if no tenant is resolved.
 */
function requireTenant(req, res, next) {
  if (!req.tenantId) {
    return res.status(404).render('error', {
      title: 'Not Found',
      message: 'Hostel not found',
    });
  }
  next();
}

/**
 * Middleware that blocks mutating requests (POST/PUT/DELETE) on inactive tenants.
 * Read-only GET requests are allowed through.
 */
function blockInactiveTenant(req, res, next) {
  if (req.tenantInactive && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
    req.flash('error', 'This hostel is inactive. You cannot make changes until it is reactivated.');
    return res.redirect('back');
  }
  next();
}

/**
 * Middleware that requires the request to be in the admin context.
 * Returns 403 if not an admin route.
 */
function requireAdmin(req, res, next) {
  if (!req.isAdminRoute) {
    req.flash('error', 'Access denied');
    return res.redirect('/');
  }
  next();
}

module.exports = { resolveTenant, requireTenant, requireAdmin, blockInactiveTenant };
