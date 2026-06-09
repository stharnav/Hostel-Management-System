const { db } = require('../config/firebase');
const { record: log } = require('../utils/logger');

const EXPENSE_CATEGORIES = [
  'Rent / Building',
  'Utilities (Electricity, Water, Gas)',
  'Maintenance & Repairs',
  'Staff Salaries',
  'Kitchen / Food Supplies',
  'Cleaning & Housekeeping',
  'Internet & Cable',
  'Furniture & Fixtures',
  'Security',
  'Transportation',
  'Medical / First Aid',
  'Miscellaneous',
];

const expensesCol = () => db.collection('exports');

exports.categories = EXPENSE_CATEGORIES;

exports.list = async (req, res) => {
  const filter = (req.query.category || '').toLowerCase();
  const period = req.query.period || 'month';
  const tid = req.tenantId;

  let snap;
  try {
    snap = await expensesCol().where('tenantId', '==', tid).get();
  } catch {
    snap = await expensesCol().where('tenantId', '==', tid).get();
  }

  let expenses = [];
  snap.forEach((doc) => expenses.push({ id: doc.id, ...doc.data() }));
  expenses.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (filter && filter !== 'all') {
    expenses = expenses.filter(
      (e) => (e.category || '').toLowerCase() === filter
    );
  }

  const now = new Date();
  let periodStart;
  if (period === 'today') {
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'week') {
    periodStart = new Date(now);
    periodStart.setDate(now.getDate() - 7);
  } else if (period === 'month') {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === 'year') {
    periodStart = new Date(now.getFullYear(), 0, 1);
  }
  const periodExpenses = periodStart
    ? expenses.filter((e) => new Date(e.date) >= periodStart)
    : expenses;

  const totalAll = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalPeriod = periodExpenses.reduce((s, e) => s + (e.amount || 0), 0);

  const categoryTotals = {};
  periodExpenses.forEach((e) => {
    const cat = e.category || 'Miscellaneous';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + (e.amount || 0);
  });

  const categoryBreakdown = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, total]) => ({ name, total, pct: totalPeriod ? Math.round((total / totalPeriod) * 100) : 0 }));

  res.render('expenses/index', {
    title: 'Expenses',
    expenses,
    categoryTotals: categoryBreakdown,
    totalAll,
    totalPeriod,
    filter,
    period,
    categories: EXPENSE_CATEGORIES,
  });
};

exports.addForm = (req, res) => {
  res.render('expenses/add', {
    title: 'Add Expense',
    categories: EXPENSE_CATEGORIES,
    today: new Date().toISOString().split('T')[0],
  });
};

exports.create = async (req, res) => {
  try {
    const { amount, category, description, date, vendor } = req.body;
    const data = {
      tenantId: req.tenantId,
      amount: Number(amount) || 0,
      category: category || 'Miscellaneous',
      description: (description || '').trim().slice(0, 500),
      date: date || new Date().toISOString().split('T')[0],
      vendor: (vendor || '').trim().slice(0, 200),
      addedBy: req.session.user?.name || null,
      createdAt: new Date().toISOString(),
    };

    await expensesCol().add(data);

    await log(req, 'expense.create', {
      entity: 'expense',
      summary: `Added expense: ${data.category} — ${data.amount}`,
      details: { amount: data.amount, category: data.category, description: data.description },
    });

    req.flash('success', 'Expense recorded successfully');
    res.redirect(`/${req.tenantSlug}/expenses`);
  } catch (err) {
    console.error('[expenses] create failed:', err);
    req.flash('error', 'Failed to record expense');
    res.redirect(`/${req.tenantSlug}/expenses`);
  }
};

exports.view = async (req, res) => {
  try {
    const doc = await expensesCol().doc(req.params.id).get();
    if (!doc.exists || doc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Expense not found');
      return res.redirect(`/${req.tenantSlug}/expenses`);
    }
    res.render('expenses/view', {
      title: 'Expense Details',
      expense: { id: doc.id, ...doc.data() },
    });
  } catch (err) {
    console.error('[expenses] view failed:', err);
    req.flash('error', 'Failed to load expense');
    res.redirect(`/${req.tenantSlug}/expenses`);
  }
};

exports.editForm = async (req, res) => {
  try {
    const doc = await expensesCol().doc(req.params.id).get();
    if (!doc.exists || doc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Expense not found');
      return res.redirect(`/${req.tenantSlug}/expenses`);
    }
    res.render('expenses/edit', {
      title: 'Edit Expense',
      expense: { id: doc.id, ...doc.data() },
      categories: EXPENSE_CATEGORIES,
    });
  } catch (err) {
    console.error('[expenses] editForm failed:', err);
    req.flash('error', 'Failed to load expense');
    res.redirect(`/${req.tenantSlug}/expenses`);
  }
};

exports.update = async (req, res) => {
  try {
    const { amount, category, description, date, vendor } = req.body;
    const ref = expensesCol().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists || doc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Expense not found');
      return res.redirect(`/${req.tenantSlug}/expenses`);
    }

    await ref.update({
      amount: Number(amount) || 0,
      category: category || 'Miscellaneous',
      description: (description || '').trim().slice(0, 500),
      date: date || doc.data().date,
      vendor: (vendor || '').trim().slice(0, 200),
      updatedAt: new Date().toISOString(),
    });

    await log(req, 'expense.update', {
      entity: 'expense',
      entityId: req.params.id,
      summary: `Updated expense: ${category} — ${amount}`,
      details: { amount: Number(amount), category },
    });

    req.flash('success', 'Expense updated');
    res.redirect(`/${req.tenantSlug}/expenses`);
  } catch (err) {
    console.error('[expenses] update failed:', err);
    req.flash('error', 'Failed to update expense');
    res.redirect(`/${req.tenantSlug}/expenses`);
  }
};

exports.remove = async (req, res) => {
  try {
    const doc = await expensesCol().doc(req.params.id).get();
    if (!doc.exists || doc.data().tenantId !== req.tenantId) {
      req.flash('error', 'Expense not found');
      return res.redirect(`/${req.tenantSlug}/expenses`);
    }

    await expensesCol().doc(req.params.id).delete();

    await log(req, 'expense.delete', {
      entity: 'expense',
      entityId: req.params.id,
      summary: `Deleted expense: ${doc.data().category} — ${doc.data().amount}`,
    });

    req.flash('success', 'Expense deleted');
    res.redirect(`/${req.tenantSlug}/expenses`);
  } catch (err) {
    console.error('[expenses] remove failed:', err);
    req.flash('error', 'Failed to delete expense');
    res.redirect(`/${req.tenantSlug}/expenses`);
  }
};
