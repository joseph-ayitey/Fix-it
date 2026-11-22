// Photo uploads for issues: a tenant's "here's the leak" picture, a landlord's "fixed it"
// picture. Uploads go through multer (multipart/form-data) into memory, are checked, and
// only then written to disk, so a rejected request never leaves files behind.
//
// Safety rules:
//   - The file type is decided by the file's own first bytes (its "magic number"), NOT
//     by the filename or the Content-Type the browser sent; both are trivially faked.
//     Only JPEG, PNG, WebP and GIF are accepted: formats every browser can display.
//   - Files are stored under random names with OUR extension, so a user-supplied name
//     can never become a path ("../../server.js") or an executable type.
//   - Photos are served only through an authenticated route that checks the viewer can
//     see the issue (routes/issues.js), never as public static files.

import multer from "multer";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { badRequest } from "./errors.js";

export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB: a full-size phone photo fits

const DEFAULT_UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "uploads");

export function uploadDir() {
  return process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
}

/** multer middleware: up to MAX_PHOTOS files in the "photos" field, kept in memory. */
export const acceptPhotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS, fields: 20 },
}).array("photos", MAX_PHOTOS);

/** Turn multer's limit errors into messages a person can act on. */
export function describeMulterError(err) {
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return `each photo must be at most ${MAX_PHOTO_BYTES / 1024 / 1024} MB`;
    case "LIMIT_FILE_COUNT":
    case "LIMIT_UNEXPECTED_FILE":
      return `you can attach at most ${MAX_PHOTOS} photos, in the "photos" field`;
    default:
      return `upload failed: ${err.message}`;
  }
}

const SIGNATURES = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/gif", ext: "gif", test: (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("latin1")) },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

/** @returns {{ mime: string, ext: string } | null} */
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const match = SIGNATURES.find((s) => s.test(buffer));
  return match ? { mime: match.mime, ext: match.ext } : null;
}

/** Keep a display name safe and short: no path parts, no control characters. */
function cleanOriginalName(name) {
  const base = path.basename(String(name ?? "photo")).replace(/[\u0000-\u001f\u007f]/g, "");
  return base.slice(0, 200) || "photo";
}

/**
 * Check every uploaded file, then write them all to disk.
 * Throws 400 (and writes nothing) if any file isn't a supported image.
 *
 * @param {Array<{ buffer: Buffer, originalname: string, size: number }>} files from multer
 * @returns {Promise<Array<{ storedName, originalName, mimeType, sizeBytes }>>}
 */
export async function storePhotos(files = []) {
  if (!files.length) return [];

  const checked = files.map((f, i) => {
    const type = detectImageType(f.buffer);
    if (!type) {
      throw badRequest(`"${cleanOriginalName(f.originalname)}" isn't a JPEG, PNG, WebP or GIF image`, [
        { field: `photos[${i}]`, message: "must be a JPEG, PNG, WebP or GIF image" },
      ]);
    }
    return { file: f, type };
  });

  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });

  const stored = [];
  try {
    for (const { file, type } of checked) {
      const storedName = `${randomBytes(16).toString("hex")}.${type.ext}`;
      await writeFile(path.join(dir, storedName), file.buffer, { flag: "wx" });
      stored.push({ storedName, originalName: cleanOriginalName(file.originalname), mimeType: type.mime, sizeBytes: file.size });
    }
  } catch (err) {
    await removePhotos(stored);
    throw err;
  }
  return stored;
}

/** Best-effort cleanup, used when the database write after storePhotos() fails. */
export async function removePhotos(stored) {
  await Promise.all(stored.map((p) => unlink(path.join(uploadDir(), p.storedName)).catch(() => {})));
}

export function photoFilePath(storedName) {
  return path.join(uploadDir(), path.basename(storedName));
}
