const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/roomController');
const { ensureAuth, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ensurePermission('rooms.view'), ctrl.list);
router.get('/add', ensurePermission('rooms.create'), ctrl.addForm);
router.post('/', ensurePermission('rooms.create'), ctrl.create);
router.get('/:id', ensurePermission('rooms.view'), ctrl.view);
router.get('/:id/edit', ensurePermission('rooms.edit'), ctrl.editForm);
router.put('/:id', ensurePermission('rooms.edit'), ctrl.update);
router.delete('/:id', ensurePermission('rooms.delete'), ctrl.remove);

router.post('/:id/assign', ensurePermission('rooms.assign'), ctrl.assignStudent);
router.post('/:id/unassign', ensurePermission('rooms.assign'), ctrl.unassignStudent);

module.exports = router;
