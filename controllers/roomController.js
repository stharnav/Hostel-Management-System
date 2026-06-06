const { db, admin } = require('../config/firebase');

const roomsCol = () => db.collection('rooms');
const studentsCol = () => db.collection('students');

exports.list = async (req, res) => {
  const snap = await roomsCol().orderBy('roomNumber', 'asc').get();
  const rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  res.render('rooms/index', { title: 'Rooms', rooms });
};

exports.view = async (req, res) => {
  const doc = await roomsCol().doc(req.params.id).get();
  if (!doc.exists) {
    req.flash('error', 'Room not found');
    return res.redirect('/rooms');
  }
  const room = { id: doc.id, ...doc.data() };

  // Pull occupants and any unassigned students for the assign UI.
  const occupants = [];
  for (const id of room.occupants || []) {
    const s = await studentsCol().doc(id).get();
    if (s.exists) occupants.push({ id: s.id, ...s.data() });
  }

  const allStudents = await studentsCol().get();
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
      return res.redirect('/rooms/add');
    }
    const dup = await roomsCol()
      .where('roomNumber', '==', roomNumber)
      .limit(1)
      .get();
    if (!dup.empty) {
      req.flash('error', 'A room with that number already exists');
      return res.redirect('/rooms/add');
    }
    await roomsCol().add({
      roomNumber,
      type: type || 'Standard',
      capacity: Number(capacity),
      floor: floor || '',
      rent: rent ? Number(rent) : 0,
      status: status || 'available',
      occupants: [],
      createdAt: new Date().toISOString(),
    });
    req.flash('success', 'Room added');
    res.redirect('/rooms');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add room');
    res.redirect('/rooms/add');
  }
};

exports.editForm = async (req, res) => {
  const doc = await roomsCol().doc(req.params.id).get();
  if (!doc.exists) {
    req.flash('error', 'Room not found');
    return res.redirect('/rooms');
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
    req.flash('success', 'Room updated');
    res.redirect('/rooms');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update room');
    res.redirect(`/rooms/${req.params.id}/edit`);
  }
};

exports.remove = async (req, res) => {
  try {
    const ref = roomsCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      req.flash('error', 'Room not found');
      return res.redirect('/rooms');
    }
    const room = doc.data();
    // Clear roomId from any occupants so we don't leave dangling refs.
    for (const sid of room.occupants || []) {
      await studentsCol().doc(sid).update({ roomId: null });
    }
    await ref.delete();
    req.flash('success', 'Room deleted');
    res.redirect('/rooms');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete room');
    res.redirect('/rooms');
  }
};

exports.assignStudent = async (req, res) => {
  try {
    const { studentId } = req.body;
    const roomRef = roomsCol().doc(req.params.id);
    const roomDoc = await roomRef.get();
    if (!roomDoc.exists) {
      req.flash('error', 'Room not found');
      return res.redirect('/rooms');
    }
    const room = roomDoc.data();
    const occupants = room.occupants || [];

    if (occupants.includes(studentId)) {
      req.flash('error', 'Student is already in this room');
      return res.redirect(`/rooms/${req.params.id}`);
    }
    if (occupants.length >= room.capacity) {
      req.flash('error', 'Room is at full capacity');
      return res.redirect(`/rooms/${req.params.id}`);
    }

    const studentRef = studentsCol().doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) {
      req.flash('error', 'Student not found');
      return res.redirect(`/rooms/${req.params.id}`);
    }
    const student = studentDoc.data();
    if (student.roomId) {
      req.flash('error', 'Student is already assigned to another room');
      return res.redirect(`/rooms/${req.params.id}`);
    }

    await roomRef.update({
      occupants: admin.firestore.FieldValue.arrayUnion(studentId),
    });
    await studentRef.update({ roomId: req.params.id });

    // Mark room occupied when it fills up.
    if (occupants.length + 1 >= room.capacity) {
      await roomRef.update({ status: 'occupied' });
    }

    req.flash('success', 'Student assigned to room');
    res.redirect(`/rooms/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to assign student');
    res.redirect(`/rooms/${req.params.id}`);
  }
};

exports.unassignStudent = async (req, res) => {
  try {
    const { studentId } = req.body;
    const roomRef = roomsCol().doc(req.params.id);
    const roomDoc = await roomRef.get();
    if (!roomDoc.exists) {
      req.flash('error', 'Room not found');
      return res.redirect('/rooms');
    }

    await roomRef.update({
      occupants: admin.firestore.FieldValue.arrayRemove(studentId),
      status: 'available',
    });
    await studentsCol().doc(studentId).update({ roomId: null });

    req.flash('success', 'Student removed from room');
    res.redirect(`/rooms/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to unassign student');
    res.redirect(`/rooms/${req.params.id}`);
  }
};
