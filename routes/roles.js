const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/rolesController');
const { ensureAuth, ensureRole, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

// Role management is a settings-level capability — only admins get in. We
// could also gate on 'settings.manageRoles', but ensuring the legacy admin
// role is enough and matches how /users is gated.
router.use(ensureRole('admin'));

router.get('/', ctrl.list);
router.get('/add', ctrl.addForm);
router.post('/', ctrl.create);
router.get('/:id/edit', ctrl.editForm);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
