// App-wide branding settings stored in Firestore.
// Supports both global (admin) and per-tenant branding.
// The settings document ID is 'app' for global, or `${tenantId}_app` for tenant-specific.

const { db } = require('../config/firebase');

const DOC_ID = 'app';
const DEFAULTS = Object.freeze({
  appName: 'Hostel Manager',
  iconUrl: null,
  iconPath: null,
  currencySymbol: '₹',
  currencyCode: 'INR',
});

// Caches: one for global, one per tenant
let globalCache = { ...DEFAULTS };
let globalLoaded = false;
const tenantCaches = new Map();

function tenantDocId(tenantId) {
  return `${tenantId}_app`;
}

async function load() {
  try {
    const doc = await db.collection('settings').doc(DOC_ID).get();
    if (doc.exists) {
      globalCache = { ...DEFAULTS, ...doc.data() };
    }
    globalLoaded = true;
  } catch (err) {
    console.warn('[appSettings] load failed:', err.message);
  }
}

async function get() {
  if (!globalLoaded) await load();
  return { ...globalCache };
}

async function update(patch) {
  const next = { ...globalCache, ...patch, updatedAt: new Date().toISOString() };
  await db.collection('settings').doc(DOC_ID).set(next, { merge: true });
  globalCache = { ...globalCache, ...patch };
  return { ...globalCache };
}

// ─── Tenant-scoped settings ──────────────────────────────────────────

async function loadForTenant(tenantId) {
  try {
    const doc = await db.collection('settings').doc(tenantDocId(tenantId)).get();
    if (doc.exists) {
      tenantCaches.set(tenantId, { ...DEFAULTS, ...doc.data() });
    } else {
      tenantCaches.set(tenantId, { ...DEFAULTS });
    }
  } catch (err) {
    console.warn(`[appSettings] loadForTenant(${tenantId}) failed:`, err.message);
    tenantCaches.set(tenantId, { ...DEFAULTS });
  }
}

async function getForTenant(tenantId) {
  if (!tenantCaches.has(tenantId)) {
    await loadForTenant(tenantId);
  }
  return { ...tenantCaches.get(tenantId) };
}

async function updateForTenant(tenantId, patch) {
  const current = await getForTenant(tenantId);
  const next = { ...current, ...patch, tenantId, updatedAt: new Date().toISOString() };
  await db.collection('settings').doc(tenantDocId(tenantId)).set(next, { merge: true });
  tenantCaches.set(tenantId, { ...current, ...patch });
  return { ...tenantCaches.get(tenantId) };
}

module.exports = { get, update, load, getForTenant, updateForTenant, loadForTenant, DEFAULTS };
