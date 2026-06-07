const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/userController');
const { ensureAuth, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ensurePermission('users.view'), ctrl.list);
router.get('/add', ensurePermission('users.create'), ctrl.addForm);
router.post('/', ensurePermission('users.create'), ctrl.create);
router.get('/:id/edit', ensurePermission('users.edit'), ctrl.editForm);
router.put('/:id', ensurePermission('users.edit'), ctrl.update);
router.post('/:id/toggle-active', ensurePermission('users.activate'), ctrl.toggleActive);
router.delete('/:id', ensurePermission('users.delete'), ctrl.remove);

module.exports = router;
