// Storage helper.
// If a Firebase Storage bucket is configured, uploads compressed images there
// and returns a public URL. Otherwise falls back to embedding the image as a
// base64 data URL stored in Firestore (handy for quick demos / hobby projects
// where you don't want to enable Storage).

const crypto = require('crypto');
const { bucket } = require('../config/firebase');

async function uploadImage(compressed, folder = 'uploads') {
  const filename = `${folder}/${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}.${compressed.ext}`;

  if (!bucket) {
    // Fallback: embed as data URL in Firestore.
    const dataUrl = `data:${compressed.mimeType};base64,${compressed.buffer.toString(
      'base64'
    )}`;
    return { url: dataUrl, path: null, inline: true };
  }

  const file = bucket.file(filename);
  const token = crypto.randomBytes(16).toString('hex');

  await file.save(compressed.buffer, {
    metadata: {
      contentType: compressed.mimeType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
    resumable: false,
  });

  const url =
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
    `/o/${encodeURIComponent(filename)}?alt=media&token=${token}`;

  return { url, path: filename, inline: false };
}

async function deleteImage(path) {
  if (!bucket || !path) return;
  try {
    await bucket.file(path).delete({ ignoreNotFound: true });
  } catch (err) {
    console.warn('[storage] delete failed:', err.message);
  }
}

/**
 * Human-readable byte size, e.g. 1234567 -> "1.18 MB".
 */
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / Math.pow(1024, i);
  // 2 decimals for MB+, 0 for B/KB
  return `${i >= 2 ? v.toFixed(2) : Math.round(v)} ${units[i]}`;
}

/**
 * Sum the total size of every object in the configured Storage bucket.
 * Returns { bytes, fileCount, formatted }. If no bucket is configured (or
 * the call fails), returns zeros / 'N/A' rather than throwing so the
 * dashboard can still render.
 *
 * Note: bucket.getFiles() auto-paginates, so a single await loads them all.
 * Each file's metadata.size is a string per the GCS JSON API.
 */
async function getStorageUsage() {
  if (!bucket) {
    return { bytes: 0, fileCount: 0, formatted: 'N/A' };
  }
  try {
    const [files] = await bucket.getFiles();
    const bytes = files.reduce(
      (sum, f) => sum + Number(f.metadata?.size || 0),
      0
    );
    return { bytes, fileCount: files.length, formatted: formatBytes(bytes) };
  } catch (err) {
    console.warn('[storage] usage lookup failed:', err.message);
    return { bytes: 0, fileCount: 0, formatted: 'N/A' };
  }
}

/**
 * Estimate Firestore data usage. The Admin SDK does NOT expose the real
 * stored-byte count (it's only in the GCP Console under Usage), so we
 * approximate by serializing every document to JSON and summing UTF-8 byte
 * lengths. It's a close-enough proxy for small-to-medium datasets and lets
 * us show a meaningful "Firestore data used" number alongside Storage.
 *
 * Returns { bytes, docCount, formatted, collections: [{ name, docs, bytes }] }.
 */
async function getFirestoreUsage(db, collectionNames) {
  const collections = [];
  let totalBytes = 0;
  let totalDocs = 0;

  for (const name of collectionNames) {
    try {
      const snap = await db.collection(name).get();
      let bytes = 0;
      snap.forEach((doc) => {
        const json = JSON.stringify({ id: doc.id, ...doc.data() });
        bytes += Buffer.byteLength(json, 'utf8');
      });
      collections.push({ name, docs: snap.size, bytes, formatted: formatBytes(bytes) });
      totalBytes += bytes;
      totalDocs += snap.size;
    } catch (err) {
      console.warn(`[firestore] usage scan failed for ${name}:`, err.message);
      collections.push({ name, docs: 0, bytes: 0, formatted: 'error' });
    }
  }

  return {
    bytes: totalBytes,
    docCount: totalDocs,
    formatted: formatBytes(totalBytes),
    collections,
  };
}

module.exports = {
  uploadImage,
  deleteImage,
  formatBytes,
  getStorageUsage,
  getFirestoreUsage,
};
