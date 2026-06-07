const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/userController');
const { ensureRole } = require('../middleware/auth');

// Admin-only — only admins manage other accounts.
router.use(ensureRole('admin'));

router.get('/', ctrl.list);
router.get('/add', ctrl.addForm);
router.post('/', ctrl.create);
router.get('/:id/edit', ctrl.editForm);
router.put('/:id', ctrl.update);
router.post('/:id/toggle-active', ctrl.toggleActive);
router.delete('/:id', ctrl.remove);

module.exports = router;
