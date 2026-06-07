const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/settingsController');
const upload = require('../middleware/upload');
const { ensureAuth, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ensurePermission('settings.view'), ctrl.index);

// Storage dashboard — Firebase Storage usage, Firestore collection
// breakdown, and runtime/system info. Lives at /settings/storage for URL
// consistency with the rest of the settings tree, but is gated on its own
// `storage.view` permission so admins can grant or revoke it independently
// of the broader settings access.
router.get('/storage', ensurePermission('storage.view'), ctrl.storage);

// Branding changes require the editBranding permission.
router.post('/branding', ensurePermission('settings.editBranding'), upload.single('icon'), ctrl.updateBranding);
router.post('/branding/reset-icon', ensurePermission('settings.editBranding'), ctrl.resetIcon);

module.exports = router;
