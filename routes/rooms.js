const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/roomController');
const { ensureAuth, ensureRole } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ctrl.list);
router.get('/add', ctrl.addForm);
router.post('/', ctrl.create);
router.get('/:id', ctrl.view);
router.get('/:id/edit', ctrl.editForm);
router.put('/:id', ctrl.update);
router.delete('/:id', ensureRole('admin'), ctrl.remove);

router.post('/:id/assign', ctrl.assignStudent);
router.post('/:id/unassign', ctrl.unassignStudent);

module.exports = router;
