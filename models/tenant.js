// Tenant model — manages the `tenants` collection in Firestore.
// Each tenant represents an isolated hostel with its own users, students,
// rooms, fees, expenses, settings, and activity logs.

const { db } = require('../config/firebase');
const bcrypt = require('bcryptjs');

const tenantsCol = () => db.collection('tenants');
const usersCol = () => db.collection('users');

/**
 * Reserved slugs that can't be used as tenant identifiers because they
 * conflict with existing top-level routes.
 */
const RESERVED_SLUGS = [
  'admin', 'auth', 'dashboard', 'users', 'students', 'rooms',
  'fees', 'settings', 'kitchen', 'profile', 'logs', 'expenses',
  'public', 'api', 'css', 'js', 'img',
];

/**
 * Generate a URL-safe slug from a display name.
 */
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'hostel';
}

/**
 * Validate that a slug is usable (not reserved, correct format).
 */
function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) return false;
  if (RESERVED_SLUGS.includes(slug)) return false;
  return true;
}

/**
 * Create a new tenant. Returns the new tenant document ID.
 * Seeds default roles and creates an admin user for the tenant.
 */
async function createTenant({ name, slug, adminEmail, adminPassword, adminName }) {
  slug = slug || slugify(name);
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid or reserved slug: "${slug}"`);
  }

  // Check slug uniqueness
  const existing = await tenantsCol().where('slug', '==', slug).limit(1).get();
  if (!existing.empty) {
    throw new Error(`A tenant with slug "${slug}" already exists`);
  }

  // Create tenant document
  const tenantRef = await tenantsCol().add({
    name: (name || '').trim(),
    slug,
    active: true,
    storageQuotaMB: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const tenantId = tenantRef.id;

  // Seed default roles for this tenant
  await seedTenantRoles(tenantId);

  // Create admin user for this tenant
  if (adminEmail && adminPassword) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const adminRoleSnap = await db.collection('roles')
      .where('tenantId', '==', tenantId)
      .where('key', '==', 'admin')
      .limit(1)
      .get();
    const adminRoleId = adminRoleSnap.empty ? null : adminRoleSnap.docs[0].id;

    await usersCol().add({
      name: adminName || 'Admin',
      email: adminEmail,
      passwordHash,
      role: 'admin',
      roleId: adminRoleId,
      tenantId,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return { id: tenantId, slug, name };
}

/**
 * Seed the default Admin and Staff roles for a specific tenant.
 */
async function seedTenantRoles(tenantId) {
  const defaultRoles = [
    {
      key: 'admin',
      name: 'Administrator',
      description: 'Full access to every part of the hostel management system.',
      isSystem: true,
    },
    {
      key: 'staff',
      name: 'Staff',
      description: 'Day-to-day operations: manage students, rooms, and collect fees.',
      isSystem: true,
    },
  ];

  // Permission catalog import
  const { PERMISSION_CATALOG } = require('../utils/permissions');

  function allPermissions() {
    const out = {};
    PERMISSION_CATALOG.forEach((g) => {
      out[g.group] = {};
      g.actions.forEach((a) => { out[g.group][a.key] = true; });
    });
    return out;
  }

  function staffPermissions() {
    return {
      students: { viewList: true, viewProfile: true, viewHistory: true, create: false, edit: true, delete: false, changeStatus: true },
      rooms:    { view: true, create: false, edit: false, delete: false, assign: true },
      fees:     { view: true, recordPayment: true },
      kitchen:  { view: true },
      expenses: { view: true, create: true, edit: true, delete: false },
      users:    { view: false, create: false, edit: false, delete: false, activate: false },
      settings: { view: true, editBranding: false, manageRoles: false },
      logs:     { view: false },
      storage:  { view: true },
    };
  }

  const rolesWithPerms = [
    { ...defaultRoles[0], permissions: allPermissions() },
    { ...defaultRoles[1], permissions: staffPermissions() },
  ];

  for (const r of rolesWithPerms) {
    const existing = await db.collection('roles')
      .where('tenantId', '==', tenantId)
      .where('key', '==', r.key)
      .limit(1)
      .get();
    if (existing.empty) {
      await db.collection('roles').add({
        ...r,
        tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

/**
 * Get a tenant by its slug.
 */
async function getTenantBySlug(slug) {
  const snap = await tenantsCol().where('slug', '==', slug).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * Get a tenant by its document ID.
 */
async function getTenantById(id) {
  const doc = await tenantsCol().doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

/**
 * List all tenants.
 */
async function listTenants() {
  const snap = await tenantsCol().orderBy('name', 'asc').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Update a tenant.
 */
async function updateTenant(id, patch) {
  const ref = tenantsCol().doc(id);
  await ref.update({ ...patch, updatedAt: new Date().toISOString() });
  return getTenantById(id);
}

/**
 * Delete a tenant and all its associated data.
 */
async function deleteTenant(id) {
  // Delete the tenant document
  await tenantsCol().doc(id).delete();

  // Delete associated users
  const usersSnap = await usersCol().where('tenantId', '==', id).get();
  const batch = db.batch();
  usersSnap.forEach((doc) => batch.delete(doc.ref));

  // Delete associated roles
  const rolesSnap = await db.collection('roles').where('tenantId', '==', id).get();
  rolesSnap.forEach((doc) => batch.delete(doc.ref));

  // Delete associated students
  const studentsSnap = await db.collection('students').where('tenantId', '==', id).get();
  studentsSnap.forEach((doc) => batch.delete(doc.ref));

  // Delete associated rooms
  const roomsSnap = await db.collection('rooms').where('tenantId', '==', id).get();
  roomsSnap.forEach((doc) => batch.delete(doc.ref));

  // Delete associated logs
  const logsSnap = await db.collection('logs').where('tenantId', '==', id).get();
  logsSnap.forEach((doc) => batch.delete(doc.ref));

  // Delete associated expenses (collection is named 'exports' in the original code)
  const expensesSnap = await db.collection('exports').where('tenantId', '==', id).get();
  expensesSnap.forEach((doc) => batch.delete(doc.ref));

  // Delete tenant settings
  const settingsSnap = await db.collection('settings').where('tenantId', '==', id).get();
  settingsSnap.forEach((doc) => batch.delete(doc.ref));

  await batch.commit();
}

module.exports = {
  RESERVED_SLUGS,
  slugify,
  isValidSlug,
  createTenant,
  seedTenantRoles,
  getTenantBySlug,
  getTenantById,
  listTenants,
  updateTenant,
  deleteTenant,
};
