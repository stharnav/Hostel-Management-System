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

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const studentRoutes = require('./routes/students');
const roomRoutes = require('./routes/rooms');
const feesRoutes = require('./routes/fees');
const settingsRoutes = require('./routes/settings');
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

// Expose common locals to every view.
app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentPath = req.path;
  try {
    res.locals.brand = await appSettings.get();
  } catch {
    res.locals.brand = { appName: 'Hostel Manager', iconUrl: null };
  }
  next();
});

// Routes
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  return res.redirect('/auth/login');
});

app.get('/dashboard', ensureAuth, async (req, res) => {
  const [students, rooms] = await Promise.all([
    db.collection('students').get(),
    db.collection('rooms').get(),
  ]);
  const roomData = rooms.docs.map((d) => d.data());
  const capacity = roomData.reduce((sum, r) => sum + (r.capacity || 0), 0);
  const occupied = roomData.reduce(
    (sum, r) => sum + (r.occupants?.length || 0),
    0
  );
  res.render('dashboard', {
    title: 'Dashboard',
    stats: {
      students: students.size,
      rooms: rooms.size,
      capacity,
      occupied,
      vacancies: Math.max(capacity - occupied, 0),
    },
  });
});

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/students', studentRoutes);
app.use('/rooms', roomRoutes);
app.use('/fees', feesRoutes);
app.use('/settings', settingsRoutes);

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
// Self-healing: if a user with the configured email already exists, reset its
// password to match BOOTSTRAP_ADMIN_PASSWORD. This means you can always log in
// with the credentials in your .env, even if the hash got corrupted or you
// forgot what you set previously. Set BOOTSTRAP_ADMIN_RESET=false to disable.
async function bootstrapAdmin() {
  try {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com';
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123';
    const name = process.env.BOOTSTRAP_ADMIN_NAME || 'Admin';
    const reset = process.env.BOOTSTRAP_ADMIN_RESET !== 'false';

    const passwordHash = await bcrypt.hash(password, 10);
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
        createdAt: new Date().toISOString(),
      });
      console.log(
        `[bootstrap] Admin created: ${email} / ${password} ` +
          `(change in .env for production!)`
      );
      return;
    }

    if (reset) {
      await existing.docs[0].ref.update({ passwordHash, role: 'admin' });
      console.log(
        `[bootstrap] Admin password reset for ${email} from BOOTSTRAP_ADMIN_PASSWORD ` +
          `(disable with BOOTSTRAP_ADMIN_RESET=false in .env)`
      );
    } else {
      console.log(`[bootstrap] Admin already exists: ${email} (reset disabled)`);
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
