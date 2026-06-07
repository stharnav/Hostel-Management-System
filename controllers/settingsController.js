const os = require('os');
const { db } = require('../config/firebase');
const {
  getStorageUsage,
  getFirestoreUsage,
  formatBytes,
} = require('../utils/storage');
const { compressImage } = require('../utils/imageCompressor');
const { uploadImage, deleteImage } = require('../utils/storage');
const appSettings = require('../utils/appSettings');
const { record: log } = require('../utils/logger');

// Collections we measure for Firestore "data used".
const TRACKED_COLLECTIONS = ['students', 'rooms', 'users', 'settings'];

exports.index = async (req, res) => {
  const [storage, firestore, brand] = await Promise.all([
    getStorageUsage(),
    getFirestoreUsage(db, TRACKED_COLLECTIONS),
    appSettings.get(),
  ]);

  res.render('settings/index', {
    title: 'Settings',
    storage,
    firestore,
    brand,
    system: {
      nodeVersion: process.version,
      platform: `${process.platform} (${os.arch()})`,
      uptime: Math.round(process.uptime()),
      bucket: process.env.FIREBASE_STORAGE_BUCKET || '(not configured)',
    },
  });
};

exports.updateBranding = async (req, res) => {
  try {
    const patch = {};
    const name = (req.body.appName || '').trim();
    if (name) patch.appName = name.slice(0, 60);

    // Currency — optional in the same form.
    const symbol = (req.body.currencySymbol || '').trim();
    const code = (req.body.currencyCode || '').trim().toUpperCase();
    if (symbol) patch.currencySymbol = symbol.slice(0, 5);
    if (code) patch.currencyCode = code.slice(0, 5);

    const iconFile = req.file;
    if (iconFile) {
      // Icons stay small — resize to 256×256 and re-encode.
      const compressed = await compressImage(iconFile.buffer, {
        maxWidth: 256,
        maxHeight: 256,
        quality: 85,
      });
      const uploaded = await uploadImage(compressed, 'branding');

      // Remove the old icon from Storage if there was one.
      const current = await appSettings.get();
      if (current.iconPath) {
        await deleteImage(current.iconPath);
      }
      patch.iconUrl = uploaded.url;
      patch.iconPath = uploaded.path; // null when using inline fallback
    }

    if (Object.keys(patch).length === 0) {
      req.flash('error', 'Nothing to update');
      return res.redirect('/settings');
    }

    await appSettings.update(patch);
    await log(req, 'settings.update_branding', {
      entity: 'settings',
      summary: `Updated branding${patch.appName ? ` (app name: ${patch.appName})` : ''}`,
      details: Object.keys(patch),
    });
    req.flash('success', 'Settings updated');
    res.redirect('/settings');
  } catch (err) {
    console.error('[settings] updateBranding failed:', err);
    req.flash('error', err.message || 'Failed to update settings');
    res.redirect('/settings');
  }
};

exports.resetIcon = async (req, res) => {
  try {
    const current = await appSettings.get();
    if (current.iconPath) await deleteImage(current.iconPath);
    await appSettings.update({ iconUrl: null, iconPath: null });
    req.flash('success', 'Icon reset to default');
    res.redirect('/settings');
  } catch (err) {
    console.error('[settings] resetIcon failed:', err);
    req.flash('error', 'Failed to reset icon');
    res.redirect('/settings');
  }
};
