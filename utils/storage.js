const crypto = require('crypto');
const { bucket } = require('../config/firebase');

async function uploadImage(compressed, folder = 'uploads') {
  const filename = `${folder}/${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}.${compressed.ext}`;

  if (!bucket) {
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

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / Math.pow(1024, i);
  return `${i >= 2 ? v.toFixed(2) : Math.round(v)} ${units[i]}`;
}

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
 * Estimate Firestore data usage. When tenantId is provided, only counts
 * documents belonging to that tenant.
 */
async function getFirestoreUsage(db, collectionNames, tenantId) {
  const collections = [];
  let totalBytes = 0;
  let totalDocs = 0;

  for (const name of collectionNames) {
    try {
      let query = db.collection(name);
      if (tenantId && name !== 'settings') {
        query = query.where('tenantId', '==', tenantId);
      }
      const snap = await query.get();
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
