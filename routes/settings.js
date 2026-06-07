const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/settingsController');
const upload = require('../middleware/upload');
const { ensureAuth, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ensurePermission('settings.view'), ctrl.index);

// Branding changes require the editBranding permission.
router.post('/branding', ensurePermission('settings.editBranding'), upload.single('icon'), ctrl.updateBranding);
router.post('/branding/reset-icon', ensurePermission('settings.editBranding'), ctrl.resetIcon);

module.exports = router;
