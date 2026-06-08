const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expenseController');
const { ensureAuth, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

router.get('/', ensurePermission('expenses.view'), ctrl.list);
router.get('/add', ensurePermission('expenses.create'), ctrl.addForm);
router.post('/', ensurePermission('expenses.create'), ctrl.create);
router.get('/:id', ensurePermission('expenses.view'), ctrl.view);
router.get('/:id/edit', ensurePermission('expenses.edit'), ctrl.editForm);
router.put('/:id', ensurePermission('expenses.edit'), ctrl.update);
router.delete('/:id', ensurePermission('expenses.delete'), ctrl.remove);

module.exports = router;
