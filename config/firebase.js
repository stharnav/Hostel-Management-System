// Firebase Admin SDK initialization.
// Requires a service account key JSON in the location pointed to by
// FIREBASE_SERVICE_ACCOUNT_PATH (default ./config/serviceAccountKey.json).

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const keyPath = path.resolve(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './config/serviceAccountKey.json'
);

if (!fs.existsSync(keyPath)) {
  console.error(
    `\n[firebase] Service account key not found at: ${keyPath}\n` +
      `Download it from Firebase Console > Project Settings > Service Accounts ` +
      `and save it there, or set FIREBASE_SERVICE_ACCOUNT_PATH in .env.\n`
  );
  process.exit(1);
}

const serviceAccount = require(keyPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const db = admin.firestore();
const bucket = process.env.FIREBASE_STORAGE_BUCKET
  ? admin.storage().bucket()
  : null;

module.exports = { admin, db, bucket };
