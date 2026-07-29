import fs from 'node:fs';
import path from 'node:path';

const MAX_HEADER_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 250000;
const MAX_DEPTH = 64;

function readExactly(fd, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = fs.readSync(fd, buffer, offset, length - offset, position + offset);
    if (read === 0) throw new Error('Unexpected end of ASAR file');
    offset += read;
  }
  return buffer;
}

function walkFiles(root) {
  const output = new Map();
  const stack = [{node: root, prefix: '', depth: 0}];
  let visited = 0;
  while (stack.length) {
    const {node, prefix, depth} = stack.pop();
    if (depth > MAX_DEPTH) throw new Error('ASAR directory depth exceeds safety limit');
    const files = node?.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) continue;
    for (const [name, entry] of Object.entries(files)) {
      visited += 1;
      if (visited > MAX_ENTRIES) throw new Error('ASAR entry count exceeds safety limit');
      if (!name || name === '.' || name === '..' || /[\\/\0]/u.test(name) ||
          !entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('Invalid ASAR entry');
      }
      const entryPath = prefix ? `${prefix}/${name}` : name;
      if (entry.files) stack.push({node: entry, prefix: entryPath, depth: depth + 1});
      else output.set(entryPath, entry);
    }
  }
  return output;
}

export class AsarReader {
  constructor(path) {
    this.path = path;
    this.fd = null;
    this.header = null;
    this.files = null;
    this.dataOffset = 0;
    this.fileSize = 0;
  }

  open() {
    if (this.fd != null) return this;
    // Publish `this.fd` only once every check has passed: a half-open reader
    // (fd set, files still null) would short-circuit every later open() and
    // then fail with an unrelated TypeError in list()/stat()/readFile().
    const fd = fs.openSync(this.path, 'r');
    try {
      const fileStat = fs.fstatSync(fd);
      const fileSize = fileStat.size;
      if (!fileStat.isFile() || fileSize < 18) throw new Error('ASAR is not a regular file');
      const prefix = readExactly(fd, 16, 0);
      const headerSize = prefix.readUInt32LE(4);
      const jsonSize = prefix.readUInt32LE(12);
      const dataOffset = 8 + headerSize;
      if (headerSize < 8 || jsonSize < 2 || headerSize > MAX_HEADER_BYTES ||
          jsonSize > MAX_HEADER_BYTES || jsonSize > headerSize ||
          16 + jsonSize > fileSize || dataOffset > fileSize) {
        throw new Error('Unsupported or invalid ASAR header');
      }
      const json = readExactly(fd, jsonSize, 16)
        .toString('utf8')
        .replace(/\0+$/u, '');
      const header = JSON.parse(json);
      const files = walkFiles(header);
      this.fileSize = fileSize;
      this.header = header;
      this.files = files;
      this.dataOffset = dataOffset;
      this.fd = fd;
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
    return this;
  }

  close() {
    if (this.fd != null) fs.closeSync(this.fd);
    this.fd = null;
  }

  list() {
    this.open();
    return [...this.files.keys()];
  }

  stat(entryPath) {
    this.open();
    return this.files.get(entryPath.replace(/^\//u, '')) ?? null;
  }

  readFile(entryPath, maxBytes = 8 * 1024 * 1024) {
    this.open();
    const normalized = entryPath.replace(/^\//u, '');
    const entry = this.files.get(normalized);
    if (!entry || entry.files) throw new Error(`ASAR entry not found: ${normalized}`);
    const size = Number(entry.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
      throw new Error(`ASAR entry too large or invalid: ${normalized}`);
    }
    if (entry.unpacked) {
      const rootPath = path.resolve(`${this.path}.unpacked`);
      const rootStat = fs.lstatSync(rootPath);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error('Unsafe unpacked ASAR root');
      }
      const root = fs.realpathSync(rootPath);
      const unpackedCandidate = path.resolve(root, normalized);
      if (!unpackedCandidate.startsWith(`${root}${path.sep}`)) throw new Error('Unsafe unpacked ASAR path');
      const unpacked = fs.realpathSync(unpackedCandidate);
      if (unpacked !== unpackedCandidate || !unpacked.startsWith(`${root}${path.sep}`)) {
        throw new Error('Unsafe unpacked ASAR symlink path');
      }
      // Validate the descriptor we actually read from: a plain lstat + read
      // leaves a window in which the entry can be swapped for a symlink.
      // O_NOFOLLOW makes the final path component non-followable.
      let unpackedFd;
      try {
        unpackedFd = fs.openSync(unpacked, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      } catch {
        throw new Error(`ASAR unpacked entry is unsafe: ${normalized}`);
      }
      try {
        const stat = fs.fstatSync(unpackedFd);
        if (!stat.isFile() || stat.size !== size || stat.size > maxBytes) {
          throw new Error(`ASAR unpacked entry is unsafe: ${normalized}`);
        }
        return readExactly(unpackedFd, size, 0);
      } finally {
        fs.closeSync(unpackedFd);
      }
    }
    const offset = Number(entry.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid ASAR offset');
    const absolute = this.dataOffset + offset;
    if (!Number.isSafeInteger(absolute) || absolute < this.dataOffset || absolute + size > this.fileSize) {
      throw new Error('ASAR entry points outside archive');
    }
    return readExactly(this.fd, size, absolute);
  }
}

export function withAsar(path, callback) {
  const reader = new AsarReader(path);
  try {
    reader.open();
    return callback(reader);
  } finally {
    reader.close();
  }
}
