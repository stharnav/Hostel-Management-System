// Fee status logic for hostel students.
//
// Rule: fees are due every 30 days, counted from enrollment — NOT from the
// last payment. So if a student enrolled on Jan 1st, due dates are Jan 31,
// Mar 2, Apr 1, ... regardless of when they actually paid. Paying late
// doesn't slide the schedule.
//
// Within each cycle:
//  - the 30th day = due
//  - days 30..37 = pay-by window (7-day grace)
//  - day 38+     = overdue
//
// Early payment IS allowed: if the student pays at any point during cycle N
// (before cycle N's due date arrives), that payment is credited to cycle N
// and the next due date shown becomes cycle N+1's. Likewise paying late
// still credits the cycle whose due date most recently passed. Either way,
// the schedule itself never slides — every payment just bumps the next
// expected cycle by one.
//
// Status is never persisted — it's recomputed from enrolledAt, lastPaidAt,
// and `now` so it stays consistent without any cron job.

const DAY = 24 * 60 * 60 * 1000;
const CYCLE_DAYS = 30;    // fee falls due every 30 days from enrollment
const GRACE_DAYS = 7;     // days after due date before it becomes overdue

/**
 * Compute the current fee window for a student.
 *
 * Returns { status, baseDate, cycleNumber, cyclesPaid, dueDate, deadline,
 *           daysLeft, daysOverdue, canPayAhead }.
 *
 * status:
 *  - 'pending'  — current cycle is paid OR the first due date hasn't arrived
 *  - 'due'      — past a due date, within the 7-day pay window, unpaid
 *  - 'overdue'  — past the 7-day pay window, unpaid
 *  - 'unknown'  — enrolledAt missing (legacy record)
 *
 * cycleNumber is the cycle the student is currently expected to pay for
 * next (or just paid for, if early). cyclesPaid is how many cycles have
 * been paid in total based on lastPaidAt.
 */
function computeFeeStatus(student, now = Date.now()) {
  const baseIso = student.enrolledAt || student.createdAt;
  if (!baseIso) return { status: 'unknown' };

  const base = new Date(baseIso).getTime();
  const lastPaid = student.lastPaidAt ? new Date(student.lastPaidAt).getTime() : 0;

  // How many full 30-day cycles have elapsed since enrollment, i.e. how
  // many due dates have already arrived.
  const elapsedDays = Math.floor((now - base) / DAY);
  const cyclesElapsed = Math.max(0, Math.floor(elapsedDays / CYCLE_DAYS));

  // Each payment counts for one cycle, in order. cyclesPaid tells us how
  // many cycles have been paid in total. We derive it from lastPaidAt by
  // figuring out which cycle window that payment fell in:
  //   - paid before first due date (day < 30)  -> covers cycle 1 (paid in advance)
  //   - paid on/after due date of cycle N      -> covers cycle N
  // We use the explicit `payments` array length when available since it's
  // the source of truth for "how many cycles have been paid"; if missing,
  // fall back to deriving from lastPaidAt.
  let cyclesPaid = 0;
  if (Array.isArray(student.payments) && student.payments.length > 0) {
    cyclesPaid = student.payments.length;
  } else if (lastPaid > 0) {
    const daysAtPayment = Math.floor((lastPaid - base) / DAY);
    // Day 0..29  -> cycle 1 paid in advance => 1
    // Day 30..59 -> cycle 1 paid (could be on time / in grace / late) => 1
    // Day 60..89 -> cycle 2 paid => 2
    // i.e. cycles paid = floor(daysAtPayment / 30) + 1
    cyclesPaid = Math.max(1, Math.floor(daysAtPayment / CYCLE_DAYS) + 1);
  }

  // The next cycle the student owes money for. If they've paid N cycles
  // total, the next one they owe is N+1.
  const nextCycle = cyclesPaid + 1;
  const dueDate = base + nextCycle * CYCLE_DAYS * DAY;
  const deadline = dueDate + GRACE_DAYS * DAY;

  // Whether the student can pay ahead right now (their next-owed cycle's
  // due date is still in the future).
  const canPayAhead = now < dueDate;

  let status, daysLeft = 0, daysOverdue = 0;
  if (now < dueDate) {
    // Either the first cycle hasn't arrived OR they've paid for the
    // current cycle and we're waiting for the next due date.
    status = 'pending';
    daysLeft = Math.ceil((dueDate - now) / DAY);
  } else if (now < deadline) {
    status = 'due';
    daysLeft = Math.ceil((deadline - now) / DAY);
  } else {
    status = 'overdue';
    daysOverdue = Math.floor((now - deadline) / DAY);
  }

  return {
    status,
    baseDate: new Date(base).toISOString(),
    cycleNumber: nextCycle,
    cyclesPaid,
    cyclesElapsed,
    dueDate: new Date(dueDate).toISOString(),
    deadline: new Date(deadline).toISOString(),
    daysLeft,
    daysOverdue,
    canPayAhead,
  };
}

/**
 * Format a date as a short readable string (e.g. "06 Jun 2026").
 */
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

module.exports = {
  computeFeeStatus,
  formatDate,
  CYCLE_DAYS,
  GRACE_DAYS,
  // Backwards-compat alias.
  FREE_DAYS: CYCLE_DAYS,
};
