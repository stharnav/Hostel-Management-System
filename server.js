require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('./middleware/flash');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const bcrypt = require('bcryptjs');

const { db } = require('./config/firebase');
const appSettings = require('./utils/appSettings');
const { resolveUserPermissions } = require('./utils/permissions');
const { seedDefaultRoles, enforceStaffInvariants } = require('./controllers/rolesController');
const { resolveTenant, blockInactiveTenant } = require('./middleware/tenant');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const studentRoutes = require('./routes/students');
const roomRoutes = require('./routes/rooms');
const feesRoutes = require('./routes/fees');
const settingsRoutes = require('./routes/settings');
const rolesRoutes = require('./routes/roles');
const kitchenRoutes = require('./routes/kitchen');
const profileRoutes = require('./routes/profile');
const logsRoutes = require('./routes/logs');
const expenseRoutes = require('./routes/expenses');
const adminRoutes = require('./routes/admin');
const { ensureAuth } = require('./middleware/auth');

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8h
  })
);
app.use(flash());

// Tenant resolution middleware — runs on every request to determine
// whether we're in admin mode or tenant mode from the URL.
app.use(resolveTenant);

// Expose common locals to every view. We also keep the session's
// `permissions` Set fresh on every request — that way a role edit in one tab
// takes effect in another tab within a single navigation, without forcing a
// re-login. The Set is also exposed as `currentUser.permissions` for views.
app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentPath = req.path;
  try {
    // Load tenant-specific or global branding
    if (req.tenantId) {
      res.locals.brand = await appSettings.getForTenant(req.tenantId);
    } else {
      res.locals.brand = await appSettings.get();
    }
  } catch {
    res.locals.brand = { appName: 'Hostel Manager', iconUrl: null };
  }
  if (req.session.user) {
    // Rehydrate the permission Set from the latest user/role docs. Admins
    // are short-circuited inside resolveUserPermissions.
    try {
      const userDoc = await db.collection('users').doc(req.session.user.id).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        // Enforce tenant-scoped access — prevent a user of one hostel
        // from manually changing the URL to access another hostel's data.
        if (!req.isAdminRoute && req.tenantId && !userData.isSuperAdmin) {
          if (userData.tenantId && userData.tenantId !== req.tenantId) {
            req.flash('error', 'Access denied');
            try {
              const theirTenant = await db.collection('tenants').doc(userData.tenantId).get();
              if (theirTenant.exists) {
                return res.redirect(`/${theirTenant.data().slug}/dashboard`);
              }
            } catch {}
            return req.session.destroy(() => res.redirect('/'));
          }
        }
        const perms = await resolveUserPermissions(db, userData);
        // Refresh the session too, so ensurePermission() can use it without
        // touching the DB on every request.
        req.session.user.permissions = perms;
        // Keep display fields in sync in case the user was renamed.
        req.session.user.name = userData.name;
        req.session.user.email = userData.email;
        // Persist the mutated session.
        req.session.save((err) => {
          if (err) console.warn('[session] save after rehydrate failed:', err.message);
        });
      }
    } catch (err) {
      console.warn('[session] failed to refresh permissions:', err.message);
    }
  }
  // Storage warning — check if tenant is near their Firestore quota
  if (req.tenantId) {
    try {
      const tenantDoc = await db.collection('tenants').doc(req.tenantId).get();
      if (tenantDoc.exists) {
        const tenantData = tenantDoc.data();
        const quotaMB = tenantData.storageQuotaMB || 100;
        const quotaBytes = quotaMB * 1024 * 1024;
        const { getFirestoreUsage } = require('./utils/storage');
        const TRACKED_COLLECTIONS = ['students', 'rooms', 'users', 'settings'];
        const usage = await getFirestoreUsage(db, TRACKED_COLLECTIONS, req.tenantId);
        const pct = Math.min(100, (usage.bytes / quotaBytes) * 100);
        if (pct >= 90) {
          req.tenantStorageWarning = true;
          res.locals.tenantStorageWarning = true;
          res.locals.tenantStoragePct = pct;
          res.locals.tenantStorageFormatted = usage.formatted;
          res.locals.tenantStorageQuotaMB = quotaMB;
        }
      }
    } catch (err) {
      console.warn('[storage] quota check failed:', err.message);
    }
  }

  // can('students.create') — true if the signed-in user has that permission.
  // Admins always pass. Templates use this to gate UI controls and sidebar
  // entries without writing the role check by hand.
  res.locals.can = (key) => {
    const u = req.session.user;
    if (!u) return false;
    if (u.role === 'admin') return true;
    return !!(u.permissions && u.permissions.has(key));
  };
  next();
});

// ─── Root route ──────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  // If user is logged in as super admin, go to admin panel
  if (req.session.user && req.session.user.isSuperAdmin) {
    return res.redirect('/admin/dashboard');
  }
  // If user is logged in and has a tenant in session, go to that tenant
  if (req.session.user && req.session.tenantSlug) {
    return res.redirect(`/${req.session.tenantSlug}/dashboard`);
  }
  // Show tenant selection page
  const { listTenants } = require('./models/tenant');
  const tenants = await listTenants();
  const activeTenants = tenants.filter((t) => t.active !== false);
  if (activeTenants.length === 1) {
    // Only one active tenant — go straight there
    return res.redirect(`/${activeTenants[0].slug}/auth/login`);
  }
  res.render('tenant-select', { title: 'Select Hostel', tenants });
});

// ─── Admin routes (super admin panel) ───────────────────────────────
app.use('/admin', adminRoutes);

// ─── Tenant-scoped routes ───────────────────────────────────────────
// All routes below are prefixed with /:tenantSlug by the tenant router.
// The resolveTenant middleware already ran and set req.tenantId.

// Auth — no tenant prefix needed since it's already in the path
app.use('/:tenantSlug/auth', authRoutes);

// Block mutations on inactive hostels (after auth so login still works)
app.use(blockInactiveTenant);

// Dashboard — inline route, tenant-scoped
app.get('/:tenantSlug/dashboard', ensureAuth, async (req, res) => {
  if (!req.tenantId) {
    return res.redirect('/');
  }
  const tid = req.tenantId;
  const [students, rooms, expensesSnap] = await Promise.all([
    db.collection('students').where('tenantId', '==', tid).get(),
    db.collection('rooms').where('tenantId', '==', tid).get(),
    db.collection('exports').where('tenantId', '==', tid).get(),
  ]);
  const roomData = rooms.docs.map((d) => d.data());
  const capacity = roomData.reduce((sum, r) => sum + (r.capacity || 0), 0);
  const occupied = roomData.reduce(
    (sum, r) => sum + (r.occupants?.length || 0),
    0
  );

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let monthExpenses = 0;
  let totalExpenses = 0;
  let recentExpenses = [];
  expensesSnap.forEach((doc) => {
    const e = doc.data();
    totalExpenses += e.amount || 0;
    if (new Date(e.date) >= monthStart) {
      monthExpenses += e.amount || 0;
    }
    if (recentExpenses.length < 5) {
      recentExpenses.push({ id: doc.id, ...e });
    }
  });
  recentExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.render('dashboard', {
    title: 'Dashboard',
    stats: {
      students: students.size,
      rooms: rooms.size,
      capacity,
      occupied,
      vacancies: Math.max(capacity - occupied, 0),
      totalExpenses,
      monthExpenses,
      recentExpenses,
    },
  });
});

// Tenant-scoped CRUD routes
app.use('/:tenantSlug/users', userRoutes);
app.use('/:tenantSlug/students', studentRoutes);
app.use('/:tenantSlug/rooms', roomRoutes);
app.use('/:tenantSlug/fees', feesRoutes);
app.use('/:tenantSlug/settings', settingsRoutes);
app.use('/:tenantSlug/settings/roles', rolesRoutes);
app.use('/:tenantSlug/kitchen', kitchenRoutes);
app.use('/:tenantSlug/profile', profileRoutes);
app.use('/:tenantSlug/logs', logsRoutes);
app.use('/:tenantSlug/expenses', expenseRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not Found',
    message: 'Page not found',
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (req.flash) req.flash('error', err.message || 'Server error');
  res.status(500).render('error', {
    title: 'Error',
    message: err.message || 'Server error',
  });
});

// Bootstrap the admin user from BOOTSTRAP_ADMIN_* in .env.
async function bootstrapAdmin() {
  try {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com';
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123';
    const name = process.env.BOOTSTRAP_ADMIN_NAME || 'Admin';
    const reset = process.env.BOOTSTRAP_ADMIN_RESET !== 'false';

    const passwordHash = await bcrypt.hash(password, 10);

    // Make sure the default roles exist before linking the admin to one.
    await seedDefaultRoles();
    await enforceStaffInvariants();
    const adminRoleSnap = await db.collection('roles').where('key', '==', 'admin').limit(5).get();
    // Find the global admin role (no tenantId) or fall back to any admin role
    const adminRoleDoc = adminRoleSnap.docs.find(d => !d.data().tenantId) || adminRoleSnap.docs[0];
    const adminRoleId = adminRoleDoc ? adminRoleDoc.id : null;

    const existing = await db
      .collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (existing.empty) {
      await db.collection('users').add({
        name,
        email,
        passwordHash,
        role: 'admin',
        roleId: adminRoleId,
        isSuperAdmin: true,
        createdAt: new Date().toISOString(),
      });
      console.log(
        `[bootstrap] Super admin created: ${email} / ${password} ` +
          `(change in .env for production!)`
      );
      return;
    }

    if (reset) {
      const update = { passwordHash, role: 'admin', isSuperAdmin: true };
      if (adminRoleId) update.roleId = adminRoleId;
      await existing.docs[0].ref.update(update);
      console.log(
        `[bootstrap] Super admin password reset for ${email} from BOOTSTRAP_ADMIN_PASSWORD ` +
          `(disable with BOOTSTRAP_ADMIN_RESET=false in .env)`
      );
    } else {
      console.log(`[bootstrap] Super admin already exists: ${email} (reset disabled)`);
    }
  } catch (err) {
    console.error('[bootstrap] failed:', err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await bootstrapAdmin();
  await appSettings.load();
  console.log(`Hostel management system running at http://localhost:${PORT}`);
});
