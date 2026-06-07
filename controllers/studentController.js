const { db } = require('../config/firebase');
const { compressImage } = require('../utils/imageCompressor');
const { uploadImage, deleteImage } = require('../utils/storage');
const { computeFeeStatus } = require('../utils/fees');
const { record: log } = require('../utils/logger');

const studentsCol = () => db.collection('students');
const roomsCol = () => db.collection('rooms');

// Lifecycle statuses a student can be in.
const STATUSES = ['active', 'on_leave', 'returned', 'left'];
const STATUS_LABELS = {
  active: 'Active',
  on_leave: 'On leave',
  returned: 'Returned',
  left: 'Left hostel',
};

async function handleImageField(file, folder) {
  if (!file) return null;
  const compressed = await compressImage(file.buffer, {
    maxWidth: 800,
    maxHeight: 800,
    quality: 70,
  });
  return uploadImage(compressed, folder);
}

// Pull the full student payload from req.body. Keeps create/update DRY and
// gives us a single place to add fields later.
function readStudentBody(body) {
  return {
    // Identity
    name: (body.name || '').trim(),
    nameNepali: (body.nameNepali || '').trim(),
    dob: body.dob || '',
    email: (body.email || '').trim(),
    phone: (body.phone || '').trim(),
    address: body.address || '',
    citizenNo: (body.citizenNo || '').trim(),

    // Education
    institute: body.institute || '',
    classTime: body.classTime || '',
    levelOfStudy: body.levelOfStudy || '',

    // Health & dietary
    bloodGroup: body.bloodGroup || '',
    dietary: body.dietary || '', // 'veg' | 'nonveg' | 'eggOnly'
    diseases: body.diseases || '',

    // Guardian — parents
    father: {
      name: body.fatherName || '',
      phone: body.fatherPhone || '',
      occupation: body.fatherOccupation || '',
    },
    mother: {
      name: body.motherName || '',
      phone: body.motherPhone || '',
      occupation: body.motherOccupation || '',
    },
    // Local guardian
    localGuardian: {
      name: body.localGuardianName || '',
      phone: body.localGuardianPhone || '',
      occupation: body.localGuardianOccupation || '',
      relation: body.localGuardianRelation || '',
    },
  };
}

exports.list = async (req, res) => {
  const snap = await studentsCol().orderBy('createdAt', 'desc').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const q = (req.query.q || '').trim().toLowerCase();
  const filter = (req.query.status || 'all').toLowerCase();

  const counts = { all: all.length };
  STATUSES.forEach((s) => {
    counts[s] = all.filter((x) => (x.status || 'active') === s).length;
  });

  let students = all;
  if (filter !== 'all') {
    students = students.filter((s) => (s.status || 'active') === filter);
  }
  if (q) {
    students = students.filter((s) => {
      const hay = [
        s.name, s.nameNepali, s.email, s.phone, s.institute,
        s.citizenNo, s.bloodGroup, s.address,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  res.render('students/index', {
    title: 'Students',
    students,
    counts,
    filter,
    q,
    statuses: STATUSES,
    statusLabels: STATUS_LABELS,
  });
};

exports.view = async (req, res) => {
  const doc = await studentsCol().doc(req.params.id).get();
  if (!doc.exists) {
    req.flash('error', 'Student not found');
    return res.redirect('/students');
  }
  const student = { id: doc.id, ...doc.data() };
  let room = null;
  if (student.roomId) {
    const r = await roomsCol().doc(student.roomId).get();
    if (r.exists) room = { id: r.id, ...r.data() };
  }
  const fee = computeFeeStatus(student);
  res.render('students/view', {
    title: student.name,
    student,
    room,
    fee,
    statuses: STATUSES,
    statusLabels: STATUS_LABELS,
  });
};

exports.addForm = (req, res) => {
  res.render('students/add', { title: 'Add Student' });
};

exports.create = async (req, res) => {
  try {
    const data = readStudentBody(req.body);

    if (!data.name || !data.email || !data.phone) {
      req.flash('error', 'Name, email and phone are required');
      return res.redirect('/students/add');
    }

    const photoFile = req.files?.photo?.[0];
    const idFile = req.files?.idProof?.[0];

    const photo = await handleImageField(photoFile, 'students/photos');
    const idProof = await handleImageField(idFile, 'students/ids');

    // Enrollment date — backdate for students who joined earlier but whose
    // data is being entered now. Empty picker → today. We accept a `YYYY-MM-DD`
    // string from the date input and convert to ISO at midnight UTC so the
    // fee timer starts cleanly on the chosen day.
    const enrolledDateRaw = (req.body.enrolledAt || '').trim();
    const enrolledAt = enrolledDateRaw
      ? new Date(`${enrolledDateRaw}T00:00:00.000Z`).toISOString()
      : new Date().toISOString();

    await studentsCol().add({
      ...data,
      photo: photo ? { url: photo.url, path: photo.path } : null,
      idProof: idProof ? { url: idProof.url, path: idProof.path } : null,
      roomId: null,
      // Lifecycle status — see STATUSES above.
      status: 'active',
      // Enrollment timestamp drives the 30-day fee timer.
      enrolledAt,
      lastPaidAt: null,
      payments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Activity log: who created the record and which name they entered.
    await log(req, 'student.create', {
      entity: 'student',
      summary: `Added student ${data.name}`,
      details: { email: data.email, phone: data.phone },
    });

    req.flash('success', 'Student added');
    res.redirect('/students');
  } catch (err) {
    console.error(err);
    req.flash('error', err.message || 'Failed to add student');
    res.redirect('/students/add');
  }
};

exports.editForm = async (req, res) => {
  const doc = await studentsCol().doc(req.params.id).get();
  if (!doc.exists) {
    req.flash('error', 'Student not found');
    return res.redirect('/students');
  }
  res.render('students/edit', {
    title: 'Edit Student',
    student: { id: doc.id, ...doc.data() },
  });
};

exports.update = async (req, res) => {
  try {
    const ref = studentsCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      req.flash('error', 'Student not found');
      return res.redirect('/students');
    }
    const existing = doc.data();

    const update = {
      ...readStudentBody(req.body),
      updatedAt: new Date().toISOString(),
    };

    // Enrolled date is editable. Only overwrite if the field was submitted —
    // an empty string means the user cleared the picker, in which case we
    // keep the existing enrolledAt to avoid resetting fee history.
    if (req.body.enrolledAt !== undefined) {
      const raw = String(req.body.enrolledAt).trim();
      if (raw) {
        const parsed = new Date(`${raw}T00:00:00.000Z`);
        if (!Number.isNaN(parsed.getTime())) {
          update.enrolledAt = parsed.toISOString();
        }
      }
    }

    const photoFile = req.files?.photo?.[0];
    const idFile = req.files?.idProof?.[0];

    if (photoFile) {
      const photo = await handleImageField(photoFile, 'students/photos');
      update.photo = { url: photo.url, path: photo.path };
      if (existing.photo?.path) await deleteImage(existing.photo.path);
    }
    if (idFile) {
      const idProof = await handleImageField(idFile, 'students/ids');
      update.idProof = { url: idProof.url, path: idProof.path };
      if (existing.idProof?.path) await deleteImage(existing.idProof.path);
    }

    await ref.update(update);
    await log(req, 'student.update', {
      entity: 'student',
      entityId: req.params.id,
      summary: `Updated student ${update.name || existing.name || req.params.id}`,
    });
    req.flash('success', 'Student updated');
    res.redirect(`/students/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', err.message || 'Failed to update');
    res.redirect(`/students/${req.params.id}/edit`);
  }
};

exports.remove = async (req, res) => {
  try {
    const ref = studentsCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      req.flash('error', 'Student not found');
      return res.redirect('/students');
    }
    const student = doc.data();

    // Free the room slot if this student is occupying one.
    if (student.roomId) {
      const roomRef = roomsCol().doc(student.roomId);
      const roomDoc = await roomRef.get();
      if (roomDoc.exists) {
        const occupants = (roomDoc.data().occupants || []).filter(
          (id) => id !== req.params.id
        );
        await roomRef.update({ occupants });
      }
    }

    if (student.photo?.path) await deleteImage(student.photo.path);
    if (student.idProof?.path) await deleteImage(student.idProof.path);

    await ref.delete();
    await log(req, 'student.delete', {
      entity: 'student',
      entityId: req.params.id,
      summary: `Deleted student ${student.name || req.params.id}`,
    });
    req.flash('success', 'Student deleted');
    res.redirect('/students');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete student');
    res.redirect('/students');
  }
};

/**
 * Change a student's lifecycle status (active / on_leave / returned / left).
 * When the student is marked as having left the hostel, their room slot is
 * freed automatically so the bed becomes available again.
 *
 * "Returned from leave" is a one-way action: we map it to `active` so the
 * student is immediately back in the active pool, but we keep the original
 * `returned` value in the audit log so the trail still shows the operator
 * pressed "Mark as returned" rather than a plain "Re-activate". The fee
 * timer is restarted in both cases so a returning student gets a fresh
 * billing cycle.
 */
// Pick a safe redirect target after a status change. We default to the
// students list (guarded by students.viewList, which is more permissive
// than students.viewProfile), so a user with `changeStatus` but without
// `viewProfile` (e.g. a Staff role that's been granted the action but not
// the profile read) can still see the result of their action.
//
// Callers can override via a `return` field on the form — but only when it
// points at this student's own profile page. Anything else is treated as
// untrusted and falls back to the list.
function statusChangeRedirect(req, studentId) {
  const ret = (req.body.return || req.query.return || '').toString();
  if (/^\/students\/[A-Za-z0-9_-]+$/.test(ret) && ret === `/students/${studentId}`) {
    return ret;
  }
  return '/students';
}

exports.setStatus = async (req, res) => {
  try {
    const requested = String(req.body.status || '').toLowerCase();
    if (!STATUSES.includes(requested)) {
      req.flash('error', 'Invalid status');
      return res.redirect(statusChangeRedirect(req, req.params.id));
    }
    // "Returned" is the only transition that lands on a different stored
    // status. We accept it from the form so the lifecycle button reads
    // naturally ("Mark as returned") but persist `active` so the student
    // shows up in the active list and counts toward occupancy.
    const stored = requested === 'returned' ? 'active' : requested;
    const ref = studentsCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      req.flash('error', 'Student not found');
      return res.redirect('/students');
    }
    const student = doc.data();
    const update = {
      status: stored,
      statusChangedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (stored === 'left') {
      update.leftAt = new Date().toISOString();
      // Free the room when they leave for good.
      if (student.roomId) {
        const roomRef = roomsCol().doc(student.roomId);
        const roomDoc = await roomRef.get();
        if (roomDoc.exists) {
          const occupants = (roomDoc.data().occupants || []).filter(
            (id) => id !== req.params.id
          );
          await roomRef.update({ occupants, status: 'available' });
        }
        update.roomId = null;
      }
    }
    // Coming back from leave (returned → active) or simply being re-activated
    // from left: bump the enrollment date so the fee timer starts fresh.
    if (requested === 'returned' && student.status !== 'active') {
      update.enrolledAt = new Date().toISOString();
    }
    await ref.update(update);
    await log(req, 'student.status_change', {
      entity: 'student',
      entityId: req.params.id,
      // Log the *requested* transition so audits show the operator pressed
      // "Mark as returned", not the underlying "→ active" mapping.
      summary: `${student.name || req.params.id}: ${student.status || 'active'} → ${requested}${stored !== requested ? ` (stored as ${stored})` : ''}`,
      details: {
        from: student.status || 'active',
        requested,
        storedAs: stored,
      },
    });
    req.flash('success', `Status updated to ${STATUS_LABELS[stored]}`);
    res.redirect(statusChangeRedirect(req, req.params.id));
  } catch (err) {
    console.error('[students] setStatus failed:', err);
    req.flash('error', 'Failed to update status');
    res.redirect(statusChangeRedirect(req, req.params.id));
  }
};
