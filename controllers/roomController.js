const { db, admin } = require('../config/firebase');
const { record: log } = require('../utils/logger');

const roomsCol = () => db.collection('rooms');
const studentsCol = () => db.collection('students');

exports.list = async (req, res) => {
  const tid = req.tenantId;
  const snap = await roomsCol().where('tenantId', '==', tid).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const ra = a.roomNumber || '';
    const rb = b.roomNumber || '';
    return ra.localeCompare(rb, undefined, { numeric: true });
  });

  const q = (req.query.q || '').trim().toLowerCase();

  let rooms = all;
  if (q) {
    rooms = rooms.filter((r) => {
      const hay = [
        r.roomNumber, r.type, r.floor, r.rent,
      ].filter((v) => v !== undefined && v !== null).map(String).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  res.render('rooms/index', { title: 'Rooms', rooms, q });
};

exports.view = async (req, res) => {
  const doc = await roomsCol().doc(req.params.id).get();
  if (!doc.exists || doc.data().tenantId !== req.tenantId) {
    req.flash('error', 'Room not found');
    return res.redirect(`/${req.tenantSlug}/rooms`);
  }
  const room = { id: doc.id, ...doc.data() };

  const occupants = [];
  for (const id of room.occupants || []) {
    const s = await studentsCol().doc(id).get();
    if (s.exists) occupants.push({ id: s.id, ...s.data() });
  }

  const allStudents = await studentsCol().where('tenantId', '==', req.tenantId).get();
  const unassigned = allStudents.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => !s.roomId);

  res.render('rooms/view', {
    title: `Room ${room.roomNumber}`,
    room,
    occupants,
    unassigned,
  });
};

exports.addForm = (req, res) => {
  res.render('rooms/add', { title: 'Add Room' });
};

exports.create = async (req, res) => {
  try {
    const { roomNumber, type, capacity, floor, rent, status } = req.body;
    if (!roomNumber || !capacity) {
      req.flash('error', 'Room number and capacity are required');
      return res.redirect(`/${req.tenantSlug}/rooms/add`);
    }
    const dup = await roomsCol()
      .where('tenantId', '==', req.tenantId)
      .where('roomNumber', '==', roomNumber)
      .limit(1)
      .get();
    if (!dup.empty) {
      req.flash('error', 'A room with that number already exists');
      return res.redirect(`/${req.tenantSlug}/rooms/add`);
    }
    await roomsCol().add({
      tenantId: req.tenantId,
      roomNumber,
      type: type || 'Standard',
      capacity: Number(capacity),
      floor: floor || '',
      rent: rent ? Number(rent) : 0,
      status: status || 'available',
      occupants: [],
      createdAt: new Date().toISOString(),
    });
    await log(req, 'room.create', {
      entity: 'room',
      summary: `Added room ${roomNumber} (capacity ${capacity})`,
    });
    req.flash('success', 'Room added');
    res.redirect(`/${req.tenantSlug}/rooms`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add room');
    res.redirect(`/${req.tenantSlug}/rooms/add`);
  }
};

exports.editForm = async (req, res) => {
  const doc = await roomsCol().doc(req.params.id).get();
  if (!doc.exists || doc.data().tenantId !== req.tenantId) {
    req.flash('error', 'Room not found');
    return res.redirect(`/${req.tenantSlug}/rooms`);
  }
  res.render('rooms/edit', {
    title: 'Edit Room',
    room: { id: doc.id, ...doc.data() },
  });
};

exports.update = async (req, res) => {
  try {
    const { roomNumber, type, capacity, floor, rent, status } = req.body;
    await roomsCol().doc(req.params.id).update({
      roomNumber,
      type,
      capacity: Number(capacity),
      floor,
      rent: Number(rent),
      status,
    });
    await log(req, 'room.update', {
      entity: 'room',
      entityId: req.params.id,
      summary: `Updated room ${roomNumber}`,
    });
    req.flash('success', 'Room updated');
    res.redirect(`/${req.tenantSlug}/rooms`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update room');
    res.redirect(`/${req.tenantSlug}/rooms/${req.params.id}/edit`);
  }
};

exports.remove = async (req, res) => {
  try {
    const ref = roomsCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Room not found');
      return res.redirect(`/${req.tenantSlug}/rooms`);
    }
    const room = doc.data();
    for (const sid of room.occupants || []) {
      await studentsCol().doc(sid).update({ roomId: null });
    }
    await ref.delete();
    await log(req, 'room.delete', {
      entity: 'room',
      entityId: req.params.id,
      summary: `Deleted room ${room.roomNumber || req.params.id}`,
    });
    req.flash('success', 'Room deleted');
    res.redirect(`/${req.tenantSlug}/rooms`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete room');
    res.redirect(`/${req.tenantSlug}/rooms`);
  }
};

exports.assignStudent = async (req, res) => {
  try {
    const { studentId } = req.body;
    const roomRef = roomsCol().doc(req.params.id);
    const roomDoc = await roomRef.get();
    if (!roomDoc.exists || roomDoc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Room not found');
      return res.redirect(`/${req.tenantSlug}/rooms`);
    }
    const room = roomDoc.data();
    const occupants = room.occupants || [];

    if (occupants.includes(studentId)) {
      req.flash('error', 'Student is already in this room');
      return res.redirect(`/${req.tenantSlug}/rooms/${req.params.id}`);
    }
    if (occupants.length >= room.capacity) {
      req.flash('error', 'Room is at full capacity');
      return res.redirect(`/${req.tenantSlug}/rooms/${req.params.id}`);
    }

    const studentRef = studentsCol().doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists || studentDoc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Student not found');
      return res.redirect(`/${req.tenantSlug}/rooms/${req.params.id}`);
    }
    const student = studentDoc.data();
    if (student.roomId) {
      req.flash('error', 'Student is already assigned to another room');
      return res.redirect(`/${req.tenantSlug}/rooms/${req.params.id}`);
    }

    await roomRef.update({
      occupants: admin.firestore.FieldValue.arrayUnion(studentId),
    });
    await studentRef.update({ roomId: req.params.id });

    if (occupants.length + 1 >= room.capacity) {
      await roomRef.update({ status: 'occupied' });
    }

    await log(req, 'room.assign', {
      entity: 'room',
      entityId: req.params.id,
      summary: `Assigned ${student.name} to room ${room.roomNumber}`,
      details: { roomNumber: room.roomNumber, studentId },
    });
    req.flash('success', 'Student assigned to room');
    res.redirect(`/${req.tenantSlug}/rooms/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to assign student');
    res.redirect(`/${req.tenantSlug}/rooms/${req.params.id}`);
  }
};

exports.unassignStudent = async (req, res) => {
  try {
    const { studentId } = req.body;
    const roomRef = roomsCol().doc(req.params.id);
    const roomDoc = await roomRef.get();
    if (!roomDoc.exists || roomDoc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Room not found');
      return res.redirect(`/${req.tenantSlug}/rooms`);
    }

    await roomRef.update({
      occupants: admin.firestore.FieldValue.arrayRemove(studentId),
      status: 'available',
    });
    await studentsCol().doc(studentId).update({ roomId: null });

    let studentName = studentId;
    try {
      const sd = await studentsCol().doc(studentId).get();
      if (sd.exists) studentName = sd.data().name || studentId;
    } catch { /* ignore */ }
    await log(req, 'room.unassign', {
      entity: 'room',
      entityId: req.params.id,
      summary: `Removed ${studentName} from room ${roomDoc.data().roomNumber || req.params.id}`,
      details: { roomNumber: roomDoc.data().roomNumber, studentId },
    });
    req.flash('success', 'Student removed from room');
    res.redirect(`/${req.tenantSlug}/rooms/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to unassign student');
    res.redirect(`/${req.tenantSlug}/rooms/${req.params.id}`);
  }
};
