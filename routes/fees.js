const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/feesController');
const { ensureAuth } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ctrl.list);
router.post('/:id/pay', ctrl.markPaid);

module.exports = router;
