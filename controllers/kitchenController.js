// Kitchen dashboard controller.
// Shows who's eating today: available students split by veg / non-veg, and
// staff members. "Available" means active (not on leave, not left), so the
// kitchen knows how many meals to plan.

const { db } = require('../config/firebase');

const studentsCol = () => db.collection('students');
const usersCol = () => db.collection('users');

// Students are "available for meals" when they're actively living in the
// hostel. 'on_leave' and 'left' students are excluded.
const AVAILABLE_STATUSES = ['active', 'returned'];

const DIET_LABELS = {
  veg: 'Veg',
  nonveg: 'Non-veg',
  eggOnly: 'Egg only',
};

exports.index = async (req, res) => {
  const [studentsSnap, usersSnap] = await Promise.all([
    studentsCol().get(),
    usersCol().get(),
  ]);

  // Students — split by dietary preference.
  const allStudents = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const availableStudents = allStudents.filter((s) =>
    AVAILABLE_STATUSES.includes(s.status || 'active')
  );
  const onLeave = allStudents.filter((s) => s.status === 'on_leave').length;

  const dietCounts = { veg: 0, nonveg: 0, eggOnly: 0, unspecified: 0 };
  const byDiet = { veg: [], nonveg: [], eggOnly: [], unspecified: [] };
  availableStudents.forEach((s) => {
    const key = DIET_LABELS[s.dietary] ? s.dietary : 'unspecified';
    dietCounts[key] += 1;
    byDiet[key].push(s);
  });

  // Staff + admin users (everyone in `users` collection). Each one carries a
  // dietary preference that rolls into the same meal plan as the students.
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const staffCounts = { admin: 0, staff: 0 };
  const staffByDiet = { veg: [], nonveg: [], eggOnly: [] };
  const staffDietCounts = { veg: 0, nonveg: 0, eggOnly: 0 };
  users.forEach((u) => {
    const role = (u.role || 'staff').toLowerCase();
    if (staffCounts[role] !== undefined) staffCounts[role] += 1;
    // Default to veg if a user predates the dietary field.
    const diet = DIET_LABELS[u.dietary] ? u.dietary : 'veg';
    staffDietCounts[diet] += 1;
    staffByDiet[diet].push(u);
  });

  // Tally meal plan: every student + every staff member, each counted under
  // their own dietary choice. Unspecified students still default to veg so the
  // count stays meaningful when staff haven't been migrated yet.
  const meals = {
    veg: dietCounts.veg + (dietCounts.unspecified || 0) + staffDietCounts.veg,
    nonveg: dietCounts.nonveg + staffDietCounts.nonveg,
    egg: dietCounts.eggOnly + staffDietCounts.eggOnly,
    total: availableStudents.length + users.length,
  };

  // Merge staff into each per-diet list so the view can render a single,
  // unified "who's eating today" roll call. Staff rows carry a marker so the
  // template can render a different pill/avatar treatment. Unspecified
  // students default to veg, so we bucket them with the veg column so the
  // kitchen sees a complete roll call.
  const tagged = (items, kind) => items.map((x) => ({ ...x, _kind: kind }));
  const mergedByDiet = {
    veg: [
      ...tagged(byDiet.veg, 'student'),
      ...tagged(byDiet.unspecified, 'student'),
      ...tagged(staffByDiet.veg, 'staff'),
    ],
    nonveg: [
      ...tagged(byDiet.nonveg, 'student'),
      ...tagged(staffByDiet.nonveg, 'staff'),
    ],
    eggOnly: [
      ...tagged(byDiet.eggOnly, 'student'),
      ...tagged(staffByDiet.eggOnly, 'staff'),
    ],
  };

  res.render('kitchen/index', {
    title: 'Kitchen',
    dietCounts,
    mergedByDiet,
    dietLabels: DIET_LABELS,
    availableStudents,
    availableCount: availableStudents.length,
    onLeave,
    staff: { all: users, counts: staffCounts, dietCounts: staffDietCounts },
    meals,
  });
};
