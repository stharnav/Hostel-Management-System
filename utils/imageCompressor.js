// Image compression utility using sharp.
// Resizes to a max width/height and re-encodes as JPEG with a target quality
// to keep stored images small. Returns a Buffer ready for upload.

const sharp = require('sharp');

/**
 * Compress an image buffer.
 * @param {Buffer} buffer Raw image bytes from multer.
 * @param {Object} [opts]
 * @param {number} [opts.maxWidth=800]
 * @param {number} [opts.maxHeight=800]
 * @param {number} [opts.quality=70]  JPEG quality (1-100).
 * @returns {Promise<{buffer: Buffer, mimeType: string, ext: string}>}
 */
async function compressImage(buffer, opts = {}) {
  const { maxWidth = 800, maxHeight = 800, quality = 70 } = opts;

  const compressed = await sharp(buffer)
    .rotate() // honor EXIF orientation
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  return { buffer: compressed, mimeType: 'image/jpeg', ext: 'jpg' };
}

module.exports = { compressImage };
