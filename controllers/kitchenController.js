const { db } = require('../config/firebase');

const studentsCol = () => db.collection('students');
const usersCol = () => db.collection('users');

const AVAILABLE_STATUSES = ['active', 'returned'];

const DIET_LABELS = {
  veg: 'Veg',
  nonveg: 'Non-veg',
  eggOnly: 'Egg only',
};

exports.index = async (req, res) => {
  const tid = req.tenantId;
  const [studentsSnap, usersSnap] = await Promise.all([
    studentsCol().where('tenantId', '==', tid).get(),
    usersCol().where('tenantId', '==', tid).get(),
  ]);

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

  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const staffCounts = { admin: 0, staff: 0 };
  const staffByDiet = { veg: [], nonveg: [], eggOnly: [] };
  const staffDietCounts = { veg: 0, nonveg: 0, eggOnly: 0 };
  users.forEach((u) => {
    const role = (u.role || 'staff').toLowerCase();
    if (staffCounts[role] !== undefined) staffCounts[role] += 1;
    const diet = DIET_LABELS[u.dietary] ? u.dietary : 'veg';
    staffDietCounts[diet] += 1;
    staffByDiet[diet].push(u);
  });

  const meals = {
    veg: dietCounts.veg + (dietCounts.unspecified || 0) + staffDietCounts.veg,
    nonveg: dietCounts.nonveg + staffDietCounts.nonveg,
    egg: dietCounts.eggOnly + staffDietCounts.eggOnly,
    total: availableStudents.length + users.length,
  };

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
