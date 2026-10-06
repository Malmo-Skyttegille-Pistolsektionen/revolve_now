/**
 * Stored ZIPs for the mock's `GET /backup` and `POST /restore` (#520).
 *
 * Mirrors `firmware/lib/rt_logic/zip_writer.cpp` and `zip_reader.cpp`: stored
 * entries only, sizes in the local header, read forward and stopped at the
 * central directory. Their real tests are in `firmware/host_test/`.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function writeStoredZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export interface ReadEntry extends ZipEntry {
  crcOk: boolean;
}

/** `rt::ZipReader::Error`, as the strings the mock branches on. */
export type ZipError = 'notZip' | 'unsupported' | 'corrupt' | 'truncated' | null;

export function readStoredZip(zip: Buffer): { entries: ReadEntry[]; error: ZipError } {
  const entries: ReadEntry[] = [];
  let at = 0;
  while (true) {
    if (at + 4 > zip.length) return { entries, error: 'truncated' };
    const sig = zip.readUInt32LE(at);
    if (sig === CENTRAL_SIG || sig === END_SIG) return { entries, error: null };
    if (sig !== LOCAL_SIG) return { entries, error: entries.length === 0 ? 'notZip' : 'corrupt' };
    if (at + 30 > zip.length) return { entries, error: 'truncated' };

    const flags = zip.readUInt16LE(at + 6);
    const method = zip.readUInt16LE(at + 8);
    const crc = zip.readUInt32LE(at + 14);
    const compressed = zip.readUInt32LE(at + 18);
    const size = zip.readUInt32LE(at + 22);
    const nameLength = zip.readUInt16LE(at + 26);
    const extraLength = zip.readUInt16LE(at + 28);
    if ((flags & 0x09) !== 0 || method !== 0 || compressed !== size || size === 0xffffffff || nameLength === 0) {
      return { entries, error: 'unsupported' };
    }

    const dataAt = at + 30 + nameLength + extraLength;
    if (dataAt + size > zip.length) return { entries, error: 'truncated' };
    const data = zip.subarray(dataAt, dataAt + size);
    entries.push({
      name: zip.subarray(at + 30, at + 30 + nameLength).toString('utf8'),
      data,
      crcOk: crc32(data) === crc,
    });
    at = dataAt + size;
  }
}
