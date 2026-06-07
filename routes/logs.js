const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/logsController');
const { ensureAuth, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

// The activity log is admin-only. Staff don't need (and shouldn't be
// able to) audit other people's actions. The `logs.view` permission is
// defined in utils/permissions.js and granted to admins by default.
router.get('/', ensurePermission('logs.view'), ctrl.index);

module.exports = router;
