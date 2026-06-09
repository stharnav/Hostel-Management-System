// Admin routes — super admin panel for managing tenants.
// Mounted at /admin/* — no tenant context.

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { ensureAuth, ensureRole } = require('../middleware/auth');
const {
  listTenants,
  getTenantById,
  createTenant,
  updateTenant,
  deleteTenant,
  slugify,
  isValidSlug,
} = require('../models/tenant');
const { db } = require('../config/firebase');

// ─── Admin auth routes (no auth required) ─────────────────────────
const authCtrl = require('../controllers/authController');

router.get('/auth/login', (req, res) => {
  res.render('auth/admin-login', { title: 'Super Admin Login' });
});
router.post('/auth/login', authCtrl.postLogin);
router.get('/auth/logout', authCtrl.logout);

// ─── Protected admin routes ────────────────────────────────────────
router.use(ensureAuth);
router.use((req, res, next) => {
  if (req.session.user && req.session.user.isSuperAdmin) return next();
  req.flash('error', 'Access denied — super admin only');
  return res.redirect('/');
});

// Admin dashboard — list all tenants with stats
router.get('/', async (req, res) => {
  res.redirect('/admin/dashboard');
});

router.get('/dashboard', async (req, res) => {
  const tenants = await listTenants();

  // Load stats for each tenant
  const tenantStats = await Promise.all(
    tenants.map(async (t) => {
      try {
        const [studentsSnap, roomsSnap, usersSnap] = await Promise.all([
          db.collection('students').where('tenantId', '==', t.id).get(),
          db.collection('rooms').where('tenantId', '==', t.id).get(),
          db.collection('users').where('tenantId', '==', t.id).get(),
        ]);
        const roomData = roomsSnap.docs.map((d) => d.data());
        const capacity = roomData.reduce((sum, r) => sum + (r.capacity || 0), 0);
        const occupied = roomData.reduce((sum, r) => sum + (r.occupants?.length || 0), 0);
        return {
          ...t,
          stats: {
            students: studentsSnap.size,
            rooms: roomsSnap.size,
            users: usersSnap.size,
            capacity,
            occupied,
            vacancies: Math.max(capacity - occupied, 0),
          },
        };
      } catch {
        return { ...t, stats: { students: 0, rooms: 0, users: 0, capacity: 0, occupied: 0, vacancies: 0 } };
      }
    })
  );

  res.render('admin/dashboard', {
    title: 'Admin — Manage Hostels',
    tenants: tenantStats,
  });
});

// Add tenant form
router.get('/tenants/add', (req, res) => {
  res.render('admin/add-tenant', {
    title: 'Add New Hostel',
  });
});

// Create tenant
router.post('/tenants', async (req, res) => {
  try {
    const { name, slug, adminEmail, adminPassword, adminName } = req.body;

    if (!name || !adminEmail || !adminPassword) {
      req.flash('error', 'Hostel name, admin email, and admin password are required');
      return res.redirect('/admin/tenants/add');
    }

    if (adminPassword.length < 6) {
      req.flash('error', 'Admin password must be at least 6 characters');
      return res.redirect('/admin/tenants/add');
    }

    const result = await createTenant({
      name,
      slug: slug || slugify(name),
      adminEmail,
      adminPassword,
      adminName: adminName || 'Admin',
    });

    req.flash('success', `Hostel "${result.name}" created at /${result.slug}`);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('[admin] create tenant failed:', err);
    req.flash('error', err.message || 'Failed to create hostel');
    res.redirect('/admin/tenants/add');
  }
});

// Edit tenant form
router.get('/tenants/:id/edit', async (req, res) => {
  const tenant = await getTenantById(req.params.id);
  if (!tenant) {
    req.flash('error', 'Hostel not found');
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/edit-tenant', {
    title: `Edit ${tenant.name}`,
    tenant,
  });
});

// Update tenant
router.post('/tenants/:id', async (req, res) => {
  try {
    const tenant = await getTenantById(req.params.id);
    if (!tenant) {
      req.flash('error', 'Hostel not found');
      return res.redirect('/admin/dashboard');
    }

    const { name, active } = req.body;
    const patch = {};
    if (name) patch.name = name.trim();
    // HTML checkboxes don't send a value when unchecked, so active === undefined means unchecked
    patch.active = active === 'on' || active === 'true';

    await updateTenant(req.params.id, patch);
    req.flash('success', 'Hostel updated');
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('[admin] update tenant failed:', err);
    req.flash('error', 'Failed to update hostel');
    res.redirect('/admin/dashboard');
  }
});

// Delete tenant
router.post('/tenants/:id/delete', async (req, res) => {
  try {
    const tenant = await getTenantById(req.params.id);
    if (!tenant) {
      req.flash('error', 'Hostel not found');
      return res.redirect('/admin/dashboard');
    }

    await deleteTenant(req.params.id);
    req.flash('success', `Hostel "${tenant.name}" and all its data deleted`);
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('[admin] delete tenant failed:', err);
    req.flash('error', 'Failed to delete hostel');
    res.redirect('/admin/dashboard');
  }
});

module.exports = router;
