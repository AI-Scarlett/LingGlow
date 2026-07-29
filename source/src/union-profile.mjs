import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  UNION_CLIENT_IDS,
  compileUnionProfileForClient,
  createUnionProfile,
  getClientCapabilityMap,
  getUnionField,
  normalizeUnionProfile,
} from './capability-schema.mjs';
import {ensureDataDir, normalizeBrand, normalizeProfile} from './profile.mjs';

export const UNION_PROFILE_STORE_DIR = 'union-profiles';
// Drafts are intentionally stored apart from executable profiles.  A blocked
// Agent can therefore use the complete union schema without ever becoming a
// candidate for resolveSkin(), compilation, scheduling, or injection.
export const UNION_PROFILE_DRAFT_STORE_DIR = 'union-profile-drafts';

const PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const MAX_PROFILE_COUNT = 24;
const MAX_PROFILE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PROFILE_TOTAL_BYTES = 96 * 1024 * 1024;
const KNOWN_UNION_DEFAULTS = createUnionProfile().values;

function lstatOptional(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function ownedByCurrentUser(stat) {
  return typeof process.getuid !== 'function' || stat.uid === process.getuid();
}

function assertPrivateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !ownedByCurrentUser(stat)) {
    throw new Error('并集方案目录不安全');
  }
  fs.chmodSync(directory, 0o700);
  return directory;
}

export function ensureUnionProfileStore(dataDir) {
  return ensureProfileStore(dataDir, UNION_PROFILE_STORE_DIR, '并集方案');
}

export function ensureUnionProfileDraftStore(dataDir) {
  return ensureProfileStore(dataDir, UNION_PROFILE_DRAFT_STORE_DIR, '并集草稿');
}

function ensureProfileStore(dataDir, directoryName, label) {
  const root = ensureDataDir(dataDir);
  const directory = path.join(root, directoryName);
  const existing = lstatOptional(directory);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || !ownedByCurrentUser(existing))) {
    throw new Error(`${label}目录不安全`);
  }
  if (!existing) fs.mkdirSync(directory, {mode: 0o700});
  return assertPrivateDirectory(directory);
}

function safeStoredFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      !ownedByCurrentUser(stat) || (stat.mode & 0o077) !== 0 ||
      stat.size <= 0 || stat.size > MAX_PROFILE_FILE_BYTES) {
    throw new Error('并集方案文件不安全');
  }
  return stat;
}

function storedFiles(directory) {
  assertPrivateDirectory(directory);
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json') && PROFILE_ID.test(name.slice(0, -5)))
    .map((name) => {
      const filePath = path.join(directory, name);
      return {name, filePath, stat: safeStoredFile(filePath)};
    });
}

function profileName(value) {
  if (typeof value !== 'string') throw new Error('并集方案 name 必须是字符串');
  const name = value.normalize('NFKC').trim();
  if (!name || [...name].length > 60 || /\p{Cc}/u.test(name)) throw new Error('并集方案 name 不合法');
  return name;
}

export function normalizeUnionProfileRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new Error('并集方案必须是普通对象');
  }
  const required = ['id', 'name', 'targetClientId', 'schemaVersion', 'values'];
  const missing = required.filter((key) => !Object.hasOwn(input, key));
  if (missing.length) throw new Error(`并集方案缺少元数据：${missing.join(', ')}`);
  if (typeof input.id !== 'string' || !PROFILE_ID.test(input.id)) throw new Error('并集方案 id 不合法');
  if (!UNION_CLIENT_IDS.includes(input.targetClientId)) throw new Error('并集方案 targetClientId 不合法');
  const normalized = normalizeUnionProfile(input);
  return {
    ...normalized,
    id: input.id,
    name: profileName(input.name),
    targetClientId: input.targetClientId,
    schemaVersion: normalized.schemaVersion,
    // A user profile is authored against the complete union schema, not only
    // the currently selected Agent projection.  Hidden/inapplicable values
    // remain explicit defaults, while unknown future values still win and
    // round-trip unchanged.  This makes later target switches deterministic.
    values: {...KNOWN_UNION_DEFAULTS, ...normalized.values},
  };
}

function normalizeStoredUnionProfileRecord(input) {
  try {
    return normalizeUnionProfileRecord(input);
  } catch (originalError) {
    const fieldId = 'workbuddy.composerAvatar.image';
    const storedImage = input?.values?.[fieldId];
    if (typeof storedImage !== 'string' || !storedImage) throw originalError;
    // Older editors accepted JPEG or visually transparent checkerboard assets
    // for the shared mascot. They are unsafe to inject, but one obsolete image
    // must not make every saved custom skin unreadable. Retry the exact record
    // with only that field cleared; any unrelated validation failure still
    // throws the original error and never gets hidden.
    try {
      return normalizeUnionProfileRecord({
        ...input,
        values: {...input.values, [fieldId]: null},
      });
    } catch {
      throw originalError;
    }
  }
}

// The union schema validates every brand field on its own, but injection funnels
// the whole group through the legacy brand contract (character set plus the
// shortMark/logoStyle/enabled cross-field rules).  Run that contract while the
// user can still fix the editor state instead of only at apply time.  Stored
// records keep their own values: the projection is validated, never written back.
function assertLegacyBrandContract(profile) {
  normalizeBrand({
    enabled: profile.values['brand.enabled'],
    displayName: profile.values['brand.displayName'],
    shortMark: profile.values['brand.shortMark'],
    logoStyle: profile.values['brand.logoStyle'],
    iconImage: profile.values['brand.iconImage'],
  });
}

function atomicPrivateWrite(filePath, contents, directory) {
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let fd = null;
  try {
    assertPrivateDirectory(directory);
    const existing = lstatOptional(filePath);
    if (existing) safeStoredFile(filePath);
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, contents, {encoding: 'utf8'});
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    assertPrivateDirectory(directory);
    const current = lstatOptional(filePath);
    if (current) safeStoredFile(filePath);
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
    safeStoredFile(filePath);
    const directoryFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function profileFileInStore(id, dataDir, ensureStore) {
  if (typeof id !== 'string' || !PROFILE_ID.test(id)) return null;
  const directory = ensureStore(dataDir);
  return {directory, filePath: path.join(directory, `${id}.json`)};
}

function readProfileFromStore(id, dataDir, ensureStore) {
  const location = profileFileInStore(id, dataDir, ensureStore);
  if (!location || !lstatOptional(location.filePath)) return null;
  safeStoredFile(location.filePath);
  return normalizeStoredUnionProfileRecord(JSON.parse(fs.readFileSync(location.filePath, 'utf8')));
}

export function saveUnionProfile(input, dataDir) {
  const profile = normalizeUnionProfileRecord(input);
  assertLegacyBrandContract(profile);
  const directory = ensureUnionProfileStore(dataDir);
  const filePath = path.join(directory, `${profile.id}.json`);
  const contents = `${JSON.stringify(profile, null, 2)}\n`;
  const size = Buffer.byteLength(contents);
  if (size > MAX_PROFILE_FILE_BYTES) throw new Error('并集方案文件超过 20 MB');

  const files = storedFiles(directory);
  const previous = files.find((entry) => entry.filePath === filePath);
  if (!previous && files.length >= MAX_PROFILE_COUNT) throw new Error('最多保存 24 个并集方案');
  const aggregate = files.reduce((total, entry) => total + entry.stat.size, 0) -
    (previous?.stat.size ?? 0) + size;
  if (aggregate > MAX_PROFILE_TOTAL_BYTES) throw new Error('并集方案总容量超过 96 MB');
  atomicPrivateWrite(filePath, contents, directory);
  return profile;
}

export function getUnionProfile(id, dataDir) {
  if (typeof id !== 'string' || !PROFILE_ID.test(id)) return null;
  const directory = ensureUnionProfileStore(dataDir);
  const filePath = path.join(directory, `${id}.json`);
  if (!lstatOptional(filePath)) return null;
  safeStoredFile(filePath);
  return normalizeStoredUnionProfileRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function listUnionProfiles(dataDir) {
  const directory = ensureUnionProfileStore(dataDir);
  return storedFiles(directory)
    .map(({filePath}) => normalizeStoredUnionProfileRecord(JSON.parse(fs.readFileSync(filePath, 'utf8'))))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Save a design-only union profile for a currently blocked Agent. The record
 * stays byte-for-byte in the same full profile shape as executable profiles,
 * but lives in a separate private directory. A future explicit promotion can
 * therefore use a no-replace hard-link validation and source unlink rather
 * than rewrite the profile payload.
 */
export function saveUnionProfileDraft(input, dataDir) {
  const profile = normalizeUnionProfileRecord(input);
  assertLegacyBrandContract(profile);
  const directory = ensureUnionProfileDraftStore(dataDir);
  const filePath = path.join(directory, `${profile.id}.json`);
  const contents = `${JSON.stringify(profile, null, 2)}\n`;
  const size = Buffer.byteLength(contents);
  if (size > MAX_PROFILE_FILE_BYTES) throw new Error('并集草稿文件超过 20 MB');

  const files = storedFiles(directory);
  const previous = files.find((entry) => entry.filePath === filePath);
  if (!previous && files.length >= MAX_PROFILE_COUNT) throw new Error('最多保存 24 个并集草稿');
  const aggregate = files.reduce((total, entry) => total + entry.stat.size, 0) -
    (previous?.stat.size ?? 0) + size;
  if (aggregate > MAX_PROFILE_TOTAL_BYTES) throw new Error('并集草稿总容量超过 96 MB');
  atomicPrivateWrite(filePath, contents, directory);
  return profile;
}

export function getUnionProfileDraft(id, dataDir) {
  return readProfileFromStore(id, dataDir, ensureUnionProfileDraftStore);
}

export function listUnionProfileDrafts(dataDir) {
  const directory = ensureUnionProfileDraftStore(dataDir);
  return storedFiles(directory)
    .map(({filePath}) => normalizeStoredUnionProfileRecord(JSON.parse(fs.readFileSync(filePath, 'utf8'))))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function deleteUnionProfileDraft(id, dataDir) {
  const location = profileFileInStore(id, dataDir, ensureUnionProfileDraftStore);
  if (!location || !lstatOptional(location.filePath)) return null;
  safeStoredFile(location.filePath);
  const profile = normalizeUnionProfileRecord(JSON.parse(fs.readFileSync(location.filePath, 'utf8')));
  fs.unlinkSync(location.filePath);
  const directoryFd = fs.openSync(location.directory, 'r');
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  return profile;
}

/**
 * Move a verified draft into the executable store without changing its union
 * profile payload. The caller is responsible for all entitlement, capability,
 * and ID-conflict checks before calling this primitive.
 */
export function promoteUnionProfileDraft(id, dataDir) {
  const source = profileFileInStore(id, dataDir, ensureUnionProfileDraftStore);
  const destination = profileFileInStore(id, dataDir, ensureUnionProfileStore);
  if (!source || !destination || !lstatOptional(source.filePath)) return null;
  if (lstatOptional(destination.filePath)) throw new Error('并集方案 ID 已存在，不能提升草稿');
  const sourceStat = safeStoredFile(source.filePath);
  const profile = normalizeUnionProfileRecord(JSON.parse(fs.readFileSync(source.filePath, 'utf8')));
  const capabilityMap = getClientCapabilityMap(profile.targetClientId);
  if (capabilityMap.runtimeStatus !== 'available') {
    const error = new Error(`${profile.targetClientId} 尚未完成运行时适配，不能提升设计草稿`);
    error.code = 'DRAFT_PROMOTION_UNAVAILABLE';
    throw error;
  }
  const destinationFiles = storedFiles(destination.directory);
  if (destinationFiles.length >= MAX_PROFILE_COUNT) throw new Error('可执行并集方案最多保存 24 个');
  const aggregate = destinationFiles.reduce((total, entry) => total + entry.stat.size, 0) + sourceStat.size;
  if (aggregate > MAX_PROFILE_TOTAL_BYTES) throw new Error('可执行并集方案总容量超过 96 MB');

  // link() gives us an atomic no-replace destination creation.  A plain
  // rename() could overwrite a file created by another local process between
  // the existence check above and the move.  Once the destination link is
  // verified, unlinking the source completes the move without ever replacing
  // an unrelated profile.
  let destinationLinked = false;
  try {
    fs.linkSync(source.filePath, destination.filePath);
    destinationLinked = true;
    const sourceAfterLink = fs.lstatSync(source.filePath);
    const destinationAfterLink = fs.lstatSync(destination.filePath);
    if (sourceAfterLink.nlink !== 2 || destinationAfterLink.nlink !== 2 ||
        sourceAfterLink.dev !== destinationAfterLink.dev ||
        sourceAfterLink.ino !== destinationAfterLink.ino ||
        !sourceAfterLink.isFile() || !destinationAfterLink.isFile() ||
        sourceAfterLink.isSymbolicLink() || destinationAfterLink.isSymbolicLink() ||
        !ownedByCurrentUser(sourceAfterLink) || !ownedByCurrentUser(destinationAfterLink) ||
        (sourceAfterLink.mode & 0o077) !== 0 || (destinationAfterLink.mode & 0o077) !== 0) {
      throw new Error('并集草稿提升链接安全检查失败');
    }
    fs.unlinkSync(source.filePath);
    destinationLinked = false;
    fs.chmodSync(destination.filePath, 0o600);
    safeStoredFile(destination.filePath);
    for (const directory of new Set([source.directory, destination.directory])) {
      const directoryFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    }
    return profile;
  } catch (error) {
    // If link() succeeded but the source is still present, roll the temporary
    // hard link back to its original one-link draft state.  A process crash in
    // the tiny interval is still fail-closed: both stores reject nlink=2
    // files instead of exposing a half-promoted profile.
    if (destinationLinked) {
      try {
        const sourceAfterError = fs.lstatSync(source.filePath);
        const destinationAfterError = fs.lstatSync(destination.filePath);
        if (sourceAfterError.nlink === 2 && destinationAfterError.nlink === 2 &&
            sourceAfterError.dev === destinationAfterError.dev &&
            sourceAfterError.ino === destinationAfterError.ino) {
          fs.unlinkSync(destination.filePath);
        }
      } catch {}
    }
    throw error;
  }
}

function setLegacyPath(root, dottedPath, value) {
  const parts = dottedPath.split('.');
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    cursor[part] ??= {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function bridgeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function unionProfileToLegacyV1(input, clientId) {
  const profile = normalizeUnionProfileRecord(input);
  if (profile.targetClientId !== clientId) {
    throw bridgeError('UNION_PROFILE_CLIENT_MISMATCH', '并集方案与目标客户端不匹配');
  }
  const capabilityMap = getClientCapabilityMap(clientId);
  if (capabilityMap.runtimeStatus !== 'available') {
    throw bridgeError('CLIENT_CAPABILITY_BLOCKED', `${clientId} 当前能力映射处于 blocked，禁止生成注入配置`);
  }

  const projection = compileUnionProfileForClient(profile, clientId);
  const legacy = {schemaVersion: 1, id: profile.id, name: profile.name};
  for (const [fieldId, value] of Object.entries(projection.values)) {
    const descriptor = getUnionField(fieldId);
    if (!descriptor?.legacyV1Path) {
      throw bridgeError('UNION_BRIDGE_MAPPING_MISSING', `并集字段缺少固定 legacy 映射：${fieldId}`);
    }
    setLegacyPath(legacy, descriptor.legacyV1Path, value);
  }

  // Current Codex builds mark the legacy banner CSS capability unavailable,
  // so it is intentionally absent from the normal projection above. Keep the
  // complete declarative banner recipe in the intermediate legacy profile for
  // the dedicated Codex home runtime adapter. StudioServer.compileFor() still
  // removes the old CSS `banner` capability, so retaining these values cannot
  // re-enable that unsupported injection path.
  if (clientId === 'codex') {
    for (const fieldId of [
      'codex.banner.enabled',
      'codex.banner.image',
      'codex.banner.opacity',
      'codex.banner.height',
      'codex.banner.width',
      'codex.banner.position',
    ]) {
      if (!Object.hasOwn(profile.values, fieldId)) continue;
      const descriptor = getUnionField(fieldId);
      setLegacyPath(legacy, descriptor.legacyV1Path, profile.values[fieldId]);
    }
  }
  return normalizeProfile(legacy);
}
