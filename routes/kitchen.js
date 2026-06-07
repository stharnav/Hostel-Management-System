const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/kitchenController');
const { ensureAuth, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ensurePermission('kitchen.view'), ctrl.index);

module.exports = router;
