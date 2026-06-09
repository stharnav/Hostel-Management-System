const os = require('os');
const { db } = require('../config/firebase');
const {
  getStorageUsage,
  getFirestoreUsage,
} = require('../utils/storage');
const { compressImage } = require('../utils/imageCompressor');
const { uploadImage, deleteImage } = require('../utils/storage');
const appSettings = require('../utils/appSettings');
const { record: log } = require('../utils/logger');

const TRACKED_COLLECTIONS = ['students', 'rooms', 'users', 'settings'];

async function loadStorageDashboard(tenantId) {
  const [storage, firestore] = await Promise.all([
    getStorageUsage(),
    getFirestoreUsage(db, TRACKED_COLLECTIONS, tenantId),
  ]);
  return {
    storage,
    firestore,
    system: {
      nodeVersion: process.version,
      platform: `${process.platform} (${os.arch()})`,
      uptime: Math.round(process.uptime()),
      bucket: process.env.FIREBASE_STORAGE_BUCKET || '(not configured)',
    },
  };
}

exports.index = async (req, res) => {
  let brand;
  if (req.tenantId) {
    brand = await appSettings.getForTenant(req.tenantId);
  } else {
    brand = await appSettings.get();
  }
  res.render('settings/index', { title: 'Settings', brand });
};

exports.storage = async (req, res) => {
  const data = await loadStorageDashboard(req.tenantId);
  // Read per-tenant Firestore quota, default 100 MB
  const storageQuotaMB = (req.tenant && req.tenant.storageQuotaMB) || 100;
  res.render('settings/storage', { title: 'Storage', ...data, storageQuotaMB });
};

exports.updateBranding = async (req, res) => {
  try {
    const patch = {};
    const name = (req.body.appName || '').trim();
    if (name) patch.appName = name.slice(0, 60);

    const symbol = (req.body.currencySymbol || '').trim();
    const code = (req.body.currencyCode || '').trim().toUpperCase();
    if (symbol) patch.currencySymbol = symbol.slice(0, 5);
    if (code) patch.currencyCode = code.slice(0, 5);

    const iconFile = req.file;
    if (iconFile) {
      const compressed = await compressImage(iconFile.buffer, {
        maxWidth: 256,
        maxHeight: 256,
        quality: 85,
      });
      const folder = req.tenantSlug ? `${req.tenantSlug}/branding` : 'branding';
      const uploaded = await uploadImage(compressed, folder);

      const current = req.tenantId
        ? await appSettings.getForTenant(req.tenantId)
        : await appSettings.get();
      if (current.iconPath) {
        await deleteImage(current.iconPath);
      }
      patch.iconUrl = uploaded.url;
      patch.iconPath = uploaded.path;
    }

    if (Object.keys(patch).length === 0) {
      req.flash('error', 'Nothing to update');
      return res.redirect(`/${req.tenantSlug}/settings`);
    }

    if (req.tenantId) {
      await appSettings.updateForTenant(req.tenantId, patch);
    } else {
      await appSettings.update(patch);
    }
    await log(req, 'settings.update_branding', {
      entity: 'settings',
      summary: `Updated branding${patch.appName ? ` (app name: ${patch.appName})` : ''}`,
      details: Object.keys(patch),
    });
    req.flash('success', 'Settings updated');
    res.redirect(`/${req.tenantSlug || ''}/settings`);
  } catch (err) {
    console.error('[settings] updateBranding failed:', err);
    req.flash('error', err.message || 'Failed to update settings');
    res.redirect(`/${req.tenantSlug || ''}/settings`);
  }
};

exports.resetIcon = async (req, res) => {
  try {
    const current = req.tenantId
      ? await appSettings.getForTenant(req.tenantId)
      : await appSettings.get();
    if (current.iconPath) await deleteImage(current.iconPath);
    if (req.tenantId) {
      await appSettings.updateForTenant(req.tenantId, { iconUrl: null, iconPath: null });
    } else {
      await appSettings.update({ iconUrl: null, iconPath: null });
    }
    req.flash('success', 'Icon reset to default');
    res.redirect(`/${req.tenantSlug || ''}/settings`);
  } catch (err) {
    console.error('[settings] resetIcon failed:', err);
    req.flash('error', 'Failed to reset icon');
    res.redirect(`/${req.tenantSlug || ''}/settings`);
  }
};
