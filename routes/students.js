const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/studentController');
const upload = require('../middleware/upload');
const { ensureAuth, ensureRole } = require('../middleware/auth');

router.use(ensureAuth);

const studentUpload = upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'idProof', maxCount: 1 },
]);

router.get('/', ctrl.list);
router.get('/add', ctrl.addForm);
router.post('/', studentUpload, ctrl.create);
router.get('/:id', ctrl.view);
router.get('/:id/edit', ctrl.editForm);
router.put('/:id', studentUpload, ctrl.update);
router.post('/:id/status', ctrl.setStatus);
router.delete('/:id', ensureRole('admin'), ctrl.remove);

module.exports = router;
