// Firebase Admin SDK initialization.
// Requires a service account key JSON in the location pointed to by
// FIREBASE_SERVICE_ACCOUNT_PATH (default ./config/serviceAccountKey.json).

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const possiblePaths = [
  './config/serviceAccountKey.json',
  './serviceAccountKey.json',
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH
].filter(Boolean);

let serviceAccount = null;

// Try file locations first
for (const p of possiblePaths) {
  const fullPath = path.resolve(p);

  if (fs.existsSync(fullPath)) {
    console.log(`[firebase] Using service account file: ${fullPath}`);
    serviceAccount = require(fullPath);
    break;
  }
}

// Fallback to environment variable
if (!serviceAccount && process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('[firebase] Using service account from environment variable');

  try {
    serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    );
  } catch (err) {
    console.error(
      '[firebase] FIREBASE_SERVICE_ACCOUNT contains invalid JSON'
    );
    process.exit(1);
  }
}

// No credentials found
if (!serviceAccount) {
  console.error(
    '\n[firebase] No Firebase credentials found.\n' +
    'Either:\n' +
    '  1. Add config/serviceAccountKey.json\n' +
    '  2. Set FIREBASE_SERVICE_ACCOUNT_PATH\n' +
    '  3. Set FIREBASE_SERVICE_ACCOUNT environment variable\n'
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const db = admin.firestore();
const bucket = process.env.FIREBASE_STORAGE_BUCKET
  ? admin.storage().bucket()
  : null;

module.exports = { admin, db, bucket };
