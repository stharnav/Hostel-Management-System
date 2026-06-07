const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/kitchenController');
const { ensureAuth } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ctrl.index);

module.exports = router;
