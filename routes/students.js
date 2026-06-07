const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/studentController');
const upload = require('../middleware/upload');
const { ensureAuth, ensurePermission } = require('../middleware/auth');

router.use(ensureAuth);

const studentUpload = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'idProof', maxCount: 1 },
]);

// IMPORTANT: declare the static '/add' and '/' routes BEFORE the `/:id` route.
// Express matches in declaration order, so '/:id' would otherwise greedily
// swallow '/add' and try to look up a student with id "add", which 404s with
// "Student not found" — the same flash you'd get from a real missing record.
router.get('/', ensurePermission('students.viewList'), ctrl.list);
router.get('/add', ensurePermission('students.create'), ctrl.addForm);
router.post('/', ensurePermission('students.create'), studentUpload, ctrl.create);

// Two different "view" permissions: the searchable list vs. the full profile.
// A user can have only the list (e.g. front-desk) or both (e.g. warden).
router.get('/:id', ensurePermission('students.viewProfile'), ctrl.view);
router.get('/:id/edit', ensurePermission('students.edit'), ctrl.editForm);
router.put('/:id', ensurePermission('students.edit'), studentUpload, ctrl.update);
router.post('/:id/status', ensurePermission('students.changeStatus'), ctrl.setStatus);
router.delete('/:id', ensurePermission('students.delete'), ctrl.remove);

module.exports = router;
