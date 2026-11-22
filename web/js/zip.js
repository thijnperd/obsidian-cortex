// Zero-dependency ZIP archive extractor for browser-side vaults.
// Supports Store (method 0) and Deflate (method 8) via standard DecompressionStream,
// reads Central Directory metadata (required for iOS Files / macOS Archive Utility
// archives that write zero sizes + data descriptors in Local File Headers),
// and enforces path-safety and decompressed byte caps while streaming.

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_BYTES = 48 * 1024 * 1024;
const DEFAULT_MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;

const MARKDOWN = /\.(md|markdown|mdown|txt)$/i;
const utf8 = new TextDecoder('utf-8');

export function isZipFile(file) {
  if (!file) return false;
  const name = String(file.name || '');
  const type = String(file.type || '').toLowerCase();
  return /\.zip$/i.test(name) || type === 'application/zip' || type === 'application/x-zip-compressed';
}

function readUint64(view, offset) {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return hi * 4294967296 + lo;
}

function dosDateTimeToEpoch(dosTime, dosDate) {
  if (!dosDate) return Date.now();
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  const month = Math.max(1, (dosDate >> 5) & 0x0f) - 1;
  const day = Math.max(1, dosDate & 0x1f);
  const hours = (dosTime >> 11) & 0x1f;
  const minutes = (dosTime >> 5) & 0x3f;
  const seconds = (dosTime & 0x1f) * 2;
  return Date.UTC(year, month, day, hours, minutes, seconds);
}

function findEocd(bytes, view) {
  if (bytes.length < 22) return -1;
  const minPos = Math.max(0, bytes.length - 22 - 65535);
  for (let pos = bytes.length - 22; pos >= minPos; pos -= 1) {
    if (view.getUint32(pos, true) === EOCD_SIG) {
      const commentLen = view.getUint16(pos + 20, true);
      if (pos + 22 + commentLen === bytes.length) return pos;
    }
  }
  return -1;
}

function parseZip64Extra(view, start, length, { needUncomp, needComp, needOffset }) {
  let ptr = start;
  const end = start + length;
  const out = {};
  while (ptr + 4 <= end) {
    const id = view.getUint16(ptr, true);
    const size = view.getUint16(ptr + 2, true);
    ptr += 4;
    if (ptr + size > end) break;
    if (id === 0x0001) {
      let cur = ptr;
      if (needUncomp && cur + 8 <= ptr + size) {
        out.uncompSize = readUint64(view, cur);
        cur += 8;
      }
      if (needComp && cur + 8 <= ptr + size) {
        out.compSize = readUint64(view, cur);
        cur += 8;
      }
      if (needOffset && cur + 8 <= ptr + size) {
        out.localOffset = readUint64(view, cur);
      }
      break;
    }
    ptr += size;
  }
  return out;
}

async function inflateRaw(compressed, remainingBudget) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error(
      'This browser cannot unzip compressed folders (Safari 16.4+ required). Use Choose .md files instead.',
    );
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  const writePromise = writer.write(compressed).then(() => writer.close());
  writePromise.catch(() => {});

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > remainingBudget) {
        await reader.cancel().catch(() => {});
        throw new Error('That selection is larger than 48 MB.');
      }
      chunks.push(value);
    }
    await writePromise;
  } catch (error) {
    if (error && /larger than 48 MB/i.test(error.message)) throw error;
    throw new Error('Could not decompress an entry inside that .zip archive.');
  } finally {
    try { writer.releaseLock(); } catch { /* ignore */ }
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function sanitiseArchivePath(rawName) {
  const normalized = String(rawName || '').replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return null;
  if (normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return null;
  }
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return null;
  if (segments.some((seg) => seg === '.' || seg === '..')) return null;
  if (segments.some((seg) => seg.startsWith('.') || seg === 'node_modules' || seg === '__MACOSX')) {
    return null;
  }
  const clean = segments.join('/');
  return MARKDOWN.test(clean) ? clean : null;
}

/**
 * Extracts non-empty Markdown records (`path`, `raw`, `size`, `lastModified`, `fromPicker`)
 * from a `.zip` File/Blob, enforcing file-count and total uncompressed byte caps.
 */
export async function extractMarkdownFromZip(
  file,
  {
    maxFiles = DEFAULT_MAX_FILES,
    maxBytes = DEFAULT_MAX_BYTES,
    maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES,
  } = {},
) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('Could not read that .zip archive.');
  }
  if (Number(file.size || 0) > maxArchiveBytes) {
    throw new Error('That .zip archive is larger than 128 MB.');
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocdPos = findEocd(bytes, view);
  if (eocdPos < 0) {
    throw new Error('That file is not a valid .zip archive.');
  }

  let entryCount = view.getUint16(eocdPos + 10, true);
  let cdSize = view.getUint32(eocdPos + 12, true);
  let cdOffset = view.getUint32(eocdPos + 16, true);

  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locPos = eocdPos - 20;
    if (locPos >= 0 && view.getUint32(locPos, true) === ZIP64_LOCATOR_SIG) {
      const z64Offset = readUint64(view, locPos + 8);
      if (z64Offset >= 0 && z64Offset + 56 <= bytes.length && view.getUint32(z64Offset, true) === ZIP64_EOCD_SIG) {
        entryCount = readUint64(view, z64Offset + 32);
        cdSize = readUint64(view, z64Offset + 40);
        cdOffset = readUint64(view, z64Offset + 48);
      }
    }
  }

  if (cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > bytes.length) {
    throw new Error('That .zip archive directory is invalid.');
  }

  const cdEnd = cdOffset + cdSize;
  const records = [];
  let declaredTotal = 0;
  let actualTotal = 0;
  let ptr = cdOffset;

  for (let i = 0; i < entryCount && ptr + 46 <= cdEnd; i += 1) {
    if (view.getUint32(ptr, true) !== CD_SIG) {
      throw new Error('That .zip archive directory is corrupted.');
    }
    const flags = view.getUint16(ptr + 8, true);
    const method = view.getUint16(ptr + 10, true);
    const dosTime = view.getUint16(ptr + 12, true);
    const dosDate = view.getUint16(ptr + 14, true);
    let compSize = view.getUint32(ptr + 20, true);
    let uncompSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    let localOffset = view.getUint32(ptr + 42, true);

    const recordEnd = ptr + 46 + nameLen + extraLen + commentLen;
    if (recordEnd > cdEnd || recordEnd > bytes.length) {
      throw new Error('That .zip archive appears truncated.');
    }

    const rawName = utf8.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    if (uncompSize === 0xffffffff || compSize === 0xffffffff || localOffset === 0xffffffff) {
      const z64 = parseZip64Extra(view, ptr + 46 + nameLen, extraLen, {
        needUncomp: uncompSize === 0xffffffff,
        needComp: compSize === 0xffffffff,
        needOffset: localOffset === 0xffffffff,
      });
      if (z64.uncompSize !== undefined) uncompSize = z64.uncompSize;
      if (z64.compSize !== undefined) compSize = z64.compSize;
      if (z64.localOffset !== undefined) localOffset = z64.localOffset;
    }
    ptr = recordEnd;

    const cleanPath = sanitiseArchivePath(rawName);
    if (!cleanPath) continue;
    if (uncompSize === 0 && compSize === 0) continue;

    if ((flags & 0x0001) !== 0) {
      throw new Error('Encrypted .zip vaults are not supported.');
    }
    if (method !== 0 && method !== 8) {
      throw new Error(
        'Unsupported .zip compression method; compress the folder with the Files app or standard ZIP.',
      );
    }
    if (records.length + 1 > maxFiles) {
      throw new Error(`That is more than ${maxFiles} notes; this build caps a local vault at ${maxFiles}.`);
    }
    if (declaredTotal + uncompSize > maxBytes) {
      throw new Error('That selection is larger than 48 MB.');
    }
    declaredTotal += uncompSize;

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LFH_SIG) {
      throw new Error('That .zip archive entry header is invalid.');
    }
    const lfhNameLen = view.getUint16(localOffset + 26, true);
    const lfhExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
    if (dataStart + compSize > bytes.length) {
      throw new Error('That .zip archive appears truncated.');
    }

    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    const remainingBudget = maxBytes - actualTotal;
    let plain;
    if (method === 0) {
      if (compressed.byteLength > remainingBudget) {
        throw new Error('That selection is larger than 48 MB.');
      }
      plain = compressed;
    } else {
      plain = await inflateRaw(compressed, remainingBudget);
    }

    if (!plain.byteLength) continue;
    actualTotal += plain.byteLength;
    records.push({
      path: cleanPath,
      raw: utf8.decode(plain),
      size: plain.byteLength,
      lastModified: dosDateTimeToEpoch(dosTime, dosDate),
      fromPicker: true,
    });
  }

  return records;
}
