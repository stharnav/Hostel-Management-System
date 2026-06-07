const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/profileController');
const { ensureAuth } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ctrl.show);
router.put('/', ctrl.update);

module.exports = router;
