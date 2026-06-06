const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/settingsController');
const upload = require('../middleware/upload');
const { ensureAuth, ensureRole } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ctrl.index);

// Branding changes are admin-only.
router.post('/branding', ensureRole('admin'), upload.single('icon'), ctrl.updateBranding);
router.post('/branding/reset-icon', ensureRole('admin'), ctrl.resetIcon);

module.exports = router;
