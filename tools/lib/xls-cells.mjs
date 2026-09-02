// A read-only reader for the numeric cells of a legacy .xls workbook.
//
// It exists to remove LibreOffice from the rates pipeline, and it removes two bugs with it.
// Converting through a spreadsheet application means reading back what that application
// chose to *display*: numbers rounded to the decimals the sheet happens to show, and dates
// formatted in whatever locale the machine is set to — which is how the same workbook came
// out day-first here and month-first on a GitHub runner. Reading the file directly returns
// what is actually stored: full-precision doubles, and dates as their serial numbers.
//
// The scope is deliberately small. A .xls is a Compound File Binary container holding a
// stream of BIFF records; this walks the container, finds the workbook stream, and pulls
// the numeric cells out of one sheet — stored numbers and the cached results of formulas,
// which several publications in this sheet turn out to be. It reads no strings, no
// formatting and no formula logic, because nothing here needs them.
//
// A shared-string reader was written for this and then deleted: it turned out to change no
// value in the output, and it was the most breakable code in the file. What replaced it is
// the check in the caller that a row with a date must have all of its figures, which
// catches a cell going unreadable for any reason rather than for one anticipated reason.
//
// Reference: [MS-CFB] for the container, [MS-XLS] for the records.

const CFB_SIGNATURE = 0xd0cf11e0;
const FREESECT = 0xffffffff, ENDOFCHAIN = 0xfffffffe;

// ── the container ────────────────────────────────────────────────────────────
function readContainer(buf) {
  if (buf.length < 512 || buf.readUInt32BE(0) !== CFB_SIGNATURE) {
    throw new Error('Not a compound-file .xls (bad signature).');
  }
  const sectorSize = 1 << buf.readUInt16LE(0x1e);
  const miniSectorSize = 1 << buf.readUInt16LE(0x20);
  const numFatSectors = buf.readUInt32LE(0x2c);
  const firstDirSector = buf.readUInt32LE(0x30);
  const miniCutoff = buf.readUInt32LE(0x38);
  const firstMiniFat = buf.readUInt32LE(0x3c);
  const firstDifat = buf.readUInt32LE(0x44);
  const numDifatSectors = buf.readUInt32LE(0x48);

  // Sector n starts one sector past the 512-byte header.
  const at = n => 512 + n * sectorSize;

  // The DIFAT lists the sectors that make up the FAT: 109 entries live in the header, and
  // any beyond that are chained through further sectors.
  const difat = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4);
    if (s !== FREESECT) difat.push(s);
  }
  let next = firstDifat;
  for (let n = 0; n < numDifatSectors && next !== ENDOFCHAIN && next !== FREESECT; n++) {
    const base = at(next);
    const perSector = sectorSize / 4 - 1;
    for (let i = 0; i < perSector; i++) {
      const s = buf.readUInt32LE(base + i * 4);
      if (s !== FREESECT) difat.push(s);
    }
    next = buf.readUInt32LE(base + perSector * 4);
  }

  const fat = [];
  for (const sector of difat.slice(0, Math.max(numFatSectors, difat.length))) {
    const base = at(sector);
    if (base + sectorSize > buf.length) break;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(base + i * 4));
  }

  const chain = (start, limit = fat.length + 8) => {
    const out = [];
    for (let s = start, n = 0; s !== ENDOFCHAIN && s !== FREESECT && n < limit; n++) {
      out.push(s);
      s = fat[s];
      if (s === undefined) break;
    }
    return out;
  };

  const readChain = (start, size) => {
    const parts = chain(start).map(s => buf.subarray(at(s), at(s) + sectorSize));
    const all = Buffer.concat(parts);
    return size ? all.subarray(0, size) : all;
  };

  // ── directory ──
  const dir = readChain(firstDirSector);
  const entries = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dir.readUInt16LE(off + 0x40);
    if (nameLen < 2) continue;
    const name = dir.toString('utf16le', off, off + nameLen - 2);
    entries.push({
      name,
      type: dir.readUInt8(off + 0x42),
      start: dir.readUInt32LE(off + 0x74),
      size: Number(dir.readBigUInt64LE(off + 0x78) & 0xffffffffn),
    });
  }

  // Small streams live inside the root entry's mini stream, indexed by their own FAT.
  const root = entries.find(e => e.type === 5);
  const miniFat = [];
  if (root) {
    const mf = readChain(firstMiniFat);
    for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mf.readUInt32LE(i));
  }
  const readMini = (start, size) => {
    const mini = readChain(root.start, root.size);
    const parts = [];
    for (let s = start, n = 0; s !== ENDOFCHAIN && s !== FREESECT && n < miniFat.length + 8; n++) {
      parts.push(mini.subarray(s * miniSectorSize, (s + 1) * miniSectorSize));
      s = miniFat[s];
      if (s === undefined) break;
    }
    return Buffer.concat(parts).subarray(0, size);
  };

  const stream = e => (e.size < miniCutoff && root ? readMini(e.start, e.size) : readChain(e.start, e.size));
  return { entries, stream };
}

// ── BIFF records ─────────────────────────────────────────────────────────────
const REC = {
  BOF: 0x0809, EOF: 0x000a, BOUNDSHEET: 0x0085, DATEMODE: 0x0022,
  NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd,
  FORMULA: 0x0006,
};

function* records(wb, from = 0) {
  let p = from;
  while (p + 4 <= wb.length) {
    const type = wb.readUInt16LE(p), len = wb.readUInt16LE(p + 2);
    if (p + 4 + len > wb.length) return;
    yield { type, at: p, data: wb.subarray(p + 4, p + 4 + len) };
    p += 4 + len;
  }
}

// An RK is a 30-bit number with two flag bits: the low bit means "divide by 100", the next
// means "this is an integer" rather than the top half of a double.
function decodeRK(rk) {
  const isInt = (rk & 0x2) !== 0;
  const div100 = (rk & 0x1) !== 0;
  let v;
  if (isInt) {
    v = rk >> 2;
    if (v & 0x20000000) v -= 0x40000000;          // sign-extend the 30-bit value
  } else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(0, 0);
    b.writeUInt32LE(rk & 0xfffffffc, 4);
    v = b.readDoubleLE(0);
  }
  return div100 ? v / 100 : v;
}

// A short BIFF8 string: one byte of length, one of flags, then either compressed
// Latin-1 bytes or UTF-16LE units. Enough for sheet names, which is all this reads.
function shortString(buf, off) {
  const len = buf.readUInt8(off);
  const wide = (buf.readUInt8(off + 1) & 0x01) !== 0;
  return wide
    ? buf.toString('utf16le', off + 2, off + 2 + len * 2)
    : buf.toString('latin1', off + 2, off + 2 + len);
}

/**
 * Cells of one sheet, as an array of rows; each row is a sparse array indexed by column.
 * Holds numbers only — a cell containing text is simply absent.
 *
 * @param {Buffer} file    the whole .xls
 * @param {RegExp} sheetRe matched against sheet names
 */
export function readSheetCells(file, sheetRe) {
  const { entries, stream } = readContainer(file);
  const entry = entries.find(e => e.type === 2 && /^(Workbook|Book)$/.test(e.name));
  if (!entry) throw new Error(`No workbook stream; found: ${entries.map(e => e.name).join(', ')}`);
  const wb = stream(entry);

  const sheets = [];
  let dateMode1904 = false;
  for (const r of records(wb)) {
    if (r.type === REC.BOUNDSHEET) sheets.push({ pos: r.data.readUInt32LE(0), name: shortString(r.data, 6) });
    else if (r.type === REC.DATEMODE) dateMode1904 = r.data.readUInt16LE(0) === 1;
    else if (r.type === REC.EOF && sheets.length) break;   // end of the globals substream
  }
  const sheet = sheets.find(s => sheetRe.test(s.name));
  if (!sheet) throw new Error(`No sheet matching ${sheetRe}; found: ${sheets.map(s => s.name).join(' | ')}`);

  const rows = [];
  const put = (r, c, v) => { (rows[r] ||= [])[c] = v; };
  let started = false;
  for (const rec of records(wb, sheet.pos)) {
    if (rec.type === REC.BOF) { if (started) break; started = true; continue; }
    if (rec.type === REC.EOF) break;
    if (rec.type === REC.NUMBER) put(rec.data.readUInt16LE(0), rec.data.readUInt16LE(2), rec.data.readDoubleLE(6));
    else if (rec.type === REC.RK) put(rec.data.readUInt16LE(0), rec.data.readUInt16LE(2), decodeRK(rec.data.readUInt32LE(6)));
    else if (rec.type === REC.MULRK) {
      const row = rec.data.readUInt16LE(0), first = rec.data.readUInt16LE(2);
      const count = (rec.data.length - 6) / 6;
      for (let i = 0; i < count; i++) put(row, first + i, decodeRK(rec.data.readUInt32LE(4 + i * 6 + 2)));
    } else if (rec.type === REC.FORMULA) {
      // A computed cell carries its last result with it. The eight bytes after the format
      // index are that result: an IEEE double, unless the top two are 0xFFFF, which marks
      // a string, boolean, error or blank instead. Several rows of this sheet are formulas,
      // and skipping them drops whole publications.
      if (rec.data.length >= 14 && rec.data.readUInt16LE(12) !== 0xffff) {
        put(rec.data.readUInt16LE(0), rec.data.readUInt16LE(2), rec.data.readDoubleLE(6));
      }
    }
  }
  return { rows, sheetName: sheet.name, dateMode1904 };
}

/**
 * An Excel date serial as an ISO date. Serials count days from 1899-12-30 under the
 * default epoch, which absorbs the spreadsheet convention that 1900 was a leap year.
 */
export function serialToISO(serial, dateMode1904 = false) {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const epoch = dateMode1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.round(serial) * 86400000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
