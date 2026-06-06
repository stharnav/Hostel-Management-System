const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/userController');
const { ensureRole } = require('../middleware/auth');

// Admin-only — only admins manage other accounts.
router.use(ensureRole('admin'));

router.get('/', ctrl.list);
router.get('/add', ctrl.addForm);
router.post('/', ctrl.create);
router.delete('/:id', ctrl.remove);

module.exports = router;
