const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/feesController');
const { ensureAuth, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ensurePermission('fees.view'), ctrl.list);
router.post('/:id/pay', ensurePermission('fees.recordPayment'), ctrl.markPaid);

module.exports = router;
