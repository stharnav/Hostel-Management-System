// Admin-only user management (create staff/admin accounts).

const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');

const usersCol = () => db.collection('users');

exports.list = async (req, res) => {
  const snap = await usersCol().orderBy('createdAt', 'desc').get();
  const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  res.render('users/index', { title: 'Users', users });
};

exports.addForm = (req, res) => {
  res.render('users/add', { title: 'Add User' });
};

exports.create = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      req.flash('error', 'All fields are required');
      return res.redirect('/users/add');
    }
    const dup = await usersCol().where('email', '==', email).limit(1).get();
    if (!dup.empty) {
      req.flash('error', 'A user with that email already exists');
      return res.redirect('/users/add');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await usersCol().add({
      name,
      email,
      passwordHash,
      role: ['admin', 'staff'].includes(role) ? role : 'staff',
      createdAt: new Date().toISOString(),
    });
    req.flash('success', 'User created');
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create user');
    res.redirect('/users/add');
  }
};

exports.remove = async (req, res) => {
  try {
    if (req.params.id === req.session.user.id) {
      req.flash('error', 'You cannot delete your own account');
      return res.redirect('/users');
    }
    await usersCol().doc(req.params.id).delete();
    req.flash('success', 'User deleted');
    res.redirect('/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete user');
    res.redirect('/users');
  }
};
