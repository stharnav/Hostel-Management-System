// One-off CLI: reset (or create) the admin user using BOOTSTRAP_ADMIN_* in .env.
//   node scripts/reset-admin.js
// Or override on the fly:
//   node scripts/reset-admin.js admin@example.com newpassword

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');

(async () => {
  const email = (process.argv[2] || process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com').trim();
  const password = process.argv[3] || process.env.BOOTSTRAP_ADMIN_PASSWORD || 'admin123';
  const name = process.env.BOOTSTRAP_ADMIN_NAME || 'Admin';

  const passwordHash = await bcrypt.hash(password, 10);

  const snap = await db.collection('users').where('email', '==', email).limit(1).get();
  if (snap.empty) {
    const ref = await db.collection('users').add({
      name,
      email,
      passwordHash,
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
    console.log(`✓ Created admin ${email} (id=${ref.id}) with password "${password}"`);
  } else {
    await snap.docs[0].ref.update({ passwordHash, role: 'admin' });
    console.log(`✓ Reset password for ${email} to "${password}"`);
  }
  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
