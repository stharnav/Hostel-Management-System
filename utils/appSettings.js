// App-wide branding settings stored in Firestore at `settings/app`.
// Cached in memory and exposed to all views via res.locals.brand.

const { db } = require('../config/firebase');

const DOC_ID = 'app';
const DEFAULTS = Object.freeze({
  appName: 'Hostel Manager',
  iconUrl: null,   // URL to uploaded icon (Storage or data URL)
  iconPath: null,  // Storage path so we can delete on replace
  currencySymbol: '₹',
  currencyCode: 'INR',
});

let cache = { ...DEFAULTS };
let loaded = false;

async function load() {
  try {
    const doc = await db.collection('settings').doc(DOC_ID).get();
    if (doc.exists) {
      cache = { ...DEFAULTS, ...doc.data() };
    }
    loaded = true;
  } catch (err) {
    console.warn('[appSettings] load failed:', err.message);
  }
}

async function get() {
  if (!loaded) await load();
  return { ...cache };
}

async function update(patch) {
  const next = { ...cache, ...patch, updatedAt: new Date().toISOString() };
  await db.collection('settings').doc(DOC_ID).set(next, { merge: true });
  cache = { ...cache, ...patch };
  return { ...cache };
}

module.exports = { get, update, load, DEFAULTS };
