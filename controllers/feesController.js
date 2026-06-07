// Fees / billing controller.
// Lists students by fee status and records payments. Status itself is
// derived on the fly from enrolledAt / lastPaidAt — see utils/fees.

const { db, admin } = require('../config/firebase');
const { computeFeeStatus, CYCLE_DAYS, GRACE_DAYS } = require('../utils/fees');
const { record: log } = require('../utils/logger');

const studentsCol = () => db.collection('students');
const roomsCol = () => db.collection('rooms');

/**
 * Build the unified fee list. Loads every student + their room (for rent
 * amount), computes status, and groups by status. Also returns totals.
 */
async function loadFeeData() {
  const [studentsSnap, roomsSnap] = await Promise.all([
    studentsCol().get(),
    roomsCol().get(),
  ]);
  const roomMap = new Map();
  roomsSnap.forEach((d) => roomMap.set(d.id, { id: d.id, ...d.data() }));

  const all = [];
  const now = Date.now();

  studentsSnap.forEach((doc) => {
    const s = { id: doc.id, ...doc.data() };
    // Students who have permanently left the hostel don't owe fees anymore.
    if (s.status === 'left') return;
    const fee = computeFeeStatus(s, now);
    const room = s.roomId ? roomMap.get(s.roomId) : null;
    all.push({
      ...s,
      fee,
      room,
      amount: room?.rent || 0,
    });
  });

  const groups = {
    overdue: all.filter((s) => s.fee.status === 'overdue'),
    due: all.filter((s) => s.fee.status === 'due'),
    pending: all.filter((s) => s.fee.status === 'pending'),
    unknown: all.filter((s) => s.fee.status === 'unknown'),
  };
  // Sort by urgency.
  groups.overdue.sort((a, b) => b.fee.daysOverdue - a.fee.daysOverdue);
  groups.due.sort((a, b) => a.fee.daysLeft - b.fee.daysLeft);
  groups.pending.sort((a, b) => a.fee.daysLeft - b.fee.daysLeft);

  const totals = {
    overdueAmount: groups.overdue.reduce((s, x) => s + x.amount, 0),
    dueAmount: groups.due.reduce((s, x) => s + x.amount, 0),
    pendingAmount: groups.pending.reduce((s, x) => s + x.amount, 0),
  };

  return { all, groups, totals };
}

exports.list = async (req, res) => {
  const filter = (req.query.status || 'todo').toLowerCase(); // todo | overdue | due | pending | all
  const data = await loadFeeData();

  let visible;
  switch (filter) {
    case 'overdue': visible = data.groups.overdue; break;
    case 'due':     visible = data.groups.due; break;
    case 'pending': visible = data.groups.pending; break;
    case 'all':     visible = data.all; break;
    case 'todo':
    default:
      // "To pay" = students who owe right now (due + overdue), most urgent first.
      visible = [...data.groups.overdue, ...data.groups.due];
      break;
  }

  res.render('fees/index', {
    title: 'Fees',
    filter,
    groups: data.groups,
    totals: data.totals,
    visible,
    constants: { CYCLE_DAYS, GRACE_DAYS },
  });
};

exports.markPaid = async (req, res) => {
  try {
    const { amount, method, note } = req.body;
    const ref = studentsCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      req.flash('error', 'Student not found');
      return res.redirect('/fees');
    }
    const paidAtIso = new Date().toISOString();
    const payment = {
      paidAt: paidAtIso,
      amount: Number(amount) || 0,
      method: method || 'cash',
      note: (note || '').slice(0, 200),
      collectedBy: req.session.user?.name || null,
    };

    await ref.update({
      lastPaidAt: paidAtIso,
      payments: admin.firestore.FieldValue.arrayUnion(payment),
      updatedAt: paidAtIso,
    });

    await log(req, 'fee.payment', {
      entity: 'student',
      entityId: req.params.id,
      summary: `Recorded payment of ${payment.amount} for ${doc.data().name || req.params.id}`,
      details: { amount: payment.amount, method: payment.method, note: payment.note },
    });
    req.flash('success', `Payment of ${payment.amount} recorded`);
    res.redirect('/fees');
  } catch (err) {
    console.error('[fees] markPaid failed:', err);
    req.flash('error', 'Failed to record payment');
    res.redirect('/fees');
  }
};
