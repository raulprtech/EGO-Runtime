import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson, sha256 } from '../runtime/integrity';

const MATERIAL_ID = /^material-[a-f0-9]{32}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ALLOWED_MEDIA = new Map([
  ['application/pdf', new Set(['.pdf'])],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Set(['.docx'])],
  ['text/plain', new Set(['.txt'])],
  ['text/markdown', new Set(['.md', '.markdown'])],
  ['application/json', new Set(['.json'])],
]);

export type MaterialStatus = 'active' | 'released';

export interface MaterialRecord {
  protocol_version: 'ego.material-record/v1';
  material_id: string;
  name: string;
  media_type: string;
  uri: string;
  sha256: string;
  size_bytes: number;
  owner_ref_sha256: string;
  permission: 'read:referenced-learning-materials';
  status: MaterialStatus;
  created_at: string;
  released_at: string | null;
  record_digest: string;
}

export class MaterialStoreError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

function maxBytes(): number {
  const configured = Number(process.env.MAX_STAGED_MATERIAL_BYTES ?? 15 * 1024 * 1024);
  return Number.isInteger(configured) && configured > 0 && configured <= 20 * 1024 * 1024
    ? configured : 15 * 1024 * 1024;
}

function ownerDigest(ownerRef: string): string {
  if (!ownerRef || ownerRef.length > 200) {
    throw new MaterialStoreError('MATERIAL_OWNER_INVALID', 400, 'A bounded material owner is required');
  }
  return sha256(`material-owner:${ownerRef}`);
}

function safeName(name: string, mediaType: string): string {
  const cleaned = path.basename(name).replace(/[\u0000-\u001f]/g, '_');
  if (!cleaned || cleaned.length > 255) {
    throw new MaterialStoreError('MATERIAL_NAME_INVALID', 400, 'Material name is invalid');
  }
  const extensions = ALLOWED_MEDIA.get(mediaType);
  if (!extensions || !extensions.has(path.extname(cleaned).toLowerCase())) {
    throw new MaterialStoreError(
      'MATERIAL_TYPE_UNSUPPORTED', 415, 'Material type or extension is unsupported',
    );
  }
  const extension = path.extname(cleaned).toLowerCase();
  const stem = path.basename(cleaned, extension)
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 100) || 'material';
  return `${stem}${extension}`;
}

async function roots(): Promise<{ input: string; staging: string }> {
  if ((process.env.RUNTIME_BACKEND ?? 'local') !== 'local') {
    throw new MaterialStoreError(
      'MATERIAL_STAGING_LOCAL_ONLY', 501, 'Material staging is available only in local mode',
    );
  }
  const input = await fs.realpath(path.resolve(process.env.LOCAL_INPUT_ROOT ?? process.cwd()))
    .catch(() => { throw new MaterialStoreError('MATERIAL_ROOT_UNAVAILABLE', 503, 'Local input root is unavailable'); });
  const requested = path.resolve(
    process.env.LOCAL_MATERIAL_STAGING_ROOT ?? path.join(input, '.ego-materials'),
  );
  const relative = path.relative(input, requested);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new MaterialStoreError(
      'MATERIAL_ROOT_UNSAFE', 503, 'Material staging root must be inside LOCAL_INPUT_ROOT',
    );
  }
  await fs.mkdir(requested, { recursive: true, mode: 0o700 });
  await fs.chmod(requested, 0o700);
  if (((await fs.stat(requested)).mode & 0o777) !== 0o700) {
    throw new MaterialStoreError(
      'MATERIAL_STORAGE_PERMISSIONS_UNSAFE', 503,
      'Material staging root cannot enforce owner-only permissions',
    );
  }
  const staging = await fs.realpath(requested);
  const actualRelative = path.relative(input, staging);
  if (!actualRelative || actualRelative.startsWith(`..${path.sep}`) || path.isAbsolute(actualRelative)) {
    throw new MaterialStoreError('MATERIAL_ROOT_UNSAFE', 503, 'Material staging root escaped LOCAL_INPUT_ROOT');
  }
  return { input, staging };
}

function recordDigest(record: Omit<MaterialRecord, 'record_digest'>): string {
  return sha256(canonicalJson(record));
}

function validateRecord(value: unknown, expectedId: string): MaterialRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MaterialStoreError('MATERIAL_RECORD_INVALID', 500, 'Material record is invalid');
  }
  const record = value as MaterialRecord;
  const { record_digest: digest, ...core } = record;
  if (
    record.protocol_version !== 'ego.material-record/v1'
    || record.material_id !== expectedId
    || !MATERIAL_ID.test(record.material_id)
    || !DIGEST.test(record.sha256)
    || !DIGEST.test(record.owner_ref_sha256)
    || !DIGEST.test(digest)
    || !['active', 'released'].includes(record.status)
    || recordDigest(core) !== digest
  ) {
    throw new MaterialStoreError('MATERIAL_RECORD_INVALID', 500, 'Material record failed integrity validation');
  }
  return record;
}

async function readRecord(directory: string, materialId: string): Promise<MaterialRecord> {
  try {
    const value = JSON.parse(await fs.readFile(path.join(directory, 'record.json'), 'utf8'));
    return validateRecord(value, materialId);
  } catch (error) {
    if (error instanceof MaterialStoreError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new MaterialStoreError('MATERIAL_NOT_FOUND', 404, 'Material was not found');
    }
    throw new MaterialStoreError('MATERIAL_RECORD_INVALID', 500, 'Material record is unavailable');
  }
}

async function writeRecord(directory: string, record: MaterialRecord): Promise<void> {
  const temporary = path.join(directory, `.record-${process.pid}-${Date.now()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, path.join(directory, 'record.json'));
  await fs.chmod(path.join(directory, 'record.json'), 0o600);
  if (((await fs.stat(path.join(directory, 'record.json'))).mode & 0o777) !== 0o600) {
    throw new MaterialStoreError(
      'MATERIAL_STORAGE_PERMISSIONS_UNSAFE', 503,
      'Material record cannot enforce owner-only permissions',
    );
  }
}

export class MaterialStore {
  static async stage(input: {
    bytes: Buffer; name: string; mediaType: string; ownerRef: string; idempotencyKey: string;
  }): Promise<{ record: MaterialRecord; disposition: 'staged' | 'already_staged' }> {
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
      throw new MaterialStoreError('MATERIAL_IDEMPOTENCY_INVALID', 400, 'A valid idempotency key is required');
    }
    if (!input.bytes.length || input.bytes.length > maxBytes()) {
      throw new MaterialStoreError('MATERIAL_SIZE_INVALID', 413, 'Material size is outside the allowed range');
    }
    const name = safeName(input.name, input.mediaType);
    const owner_ref_sha256 = ownerDigest(input.ownerRef);
    const materialId = `material-${createHash('sha256')
      .update(`material-id:${owner_ref_sha256}:${input.idempotencyKey}`).digest('hex').slice(0, 32)}`;
    const { staging } = await roots();
    const directory = path.join(staging, materialId);
    try {
      const existing = await readRecord(directory, materialId);
      const contentDigest = createHash('sha256').update(input.bytes).digest('hex');
      if (
        existing.status !== 'active'
        || existing.name !== name
        || existing.media_type !== input.mediaType
        || existing.owner_ref_sha256 !== owner_ref_sha256
        || existing.sha256 !== contentDigest
        || existing.size_bytes !== input.bytes.length
      ) {
        throw new MaterialStoreError('MATERIAL_IDEMPOTENCY_CONFLICT', 409, 'Material key already has another state or payload');
      }
      const content = await fs.readFile(path.join(directory, name));
      if (createHash('sha256').update(content).digest('hex') !== existing.sha256) {
        throw new MaterialStoreError('MATERIAL_CONTENT_INVALID', 500, 'Staged material failed integrity validation');
      }
      return { record: existing, disposition: 'already_staged' };
    } catch (error) {
      if (!(error instanceof MaterialStoreError) || error.code !== 'MATERIAL_NOT_FOUND') throw error;
    }

    await fs.mkdir(directory, { recursive: false, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    if (((await fs.stat(directory)).mode & 0o777) !== 0o700) {
      throw new MaterialStoreError(
        'MATERIAL_STORAGE_PERMISSIONS_UNSAFE', 503,
        'Material directory cannot enforce owner-only permissions',
      );
    }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new MaterialStoreError('MATERIAL_STORAGE_UNSAFE', 500, 'Material directory is unsafe');
    }
    const target = path.join(directory, name);
    await fs.writeFile(target, input.bytes, { flag: 'wx', mode: 0o600 });
    await fs.chmod(target, 0o600);
    if (((await fs.stat(target)).mode & 0o777) !== 0o600) {
      throw new MaterialStoreError(
        'MATERIAL_STORAGE_PERMISSIONS_UNSAFE', 503,
        'Material content cannot enforce owner-only permissions',
      );
    }
    const now = new Date().toISOString();
    const core: Omit<MaterialRecord, 'record_digest'> = {
      protocol_version: 'ego.material-record/v1', material_id: materialId,
      name, media_type: input.mediaType, uri: pathToFileURL(target).href,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      size_bytes: input.bytes.length, owner_ref_sha256,
      permission: 'read:referenced-learning-materials', status: 'active',
      created_at: now, released_at: null,
    };
    const record = { ...core, record_digest: recordDigest(core) };
    await writeRecord(directory, record);
    return { record, disposition: 'staged' };
  }

  static async get(materialId: string, ownerRef: string): Promise<MaterialRecord> {
    if (!MATERIAL_ID.test(materialId)) {
      throw new MaterialStoreError('MATERIAL_ID_INVALID', 400, 'Material id is invalid');
    }
    const { staging } = await roots();
    const record = await readRecord(path.join(staging, materialId), materialId);
    if (record.owner_ref_sha256 !== ownerDigest(ownerRef)) {
      throw new MaterialStoreError('MATERIAL_OWNER_MISMATCH', 403, 'Material belongs to another owner');
    }
    if (record.status === 'active') {
      const content = await fs.readFile(path.join(staging, materialId, record.name)).catch(() => null);
      if (!content || content.length !== record.size_bytes
          || createHash('sha256').update(content).digest('hex') !== record.sha256) {
        throw new MaterialStoreError('MATERIAL_CONTENT_INVALID', 500, 'Staged material failed integrity validation');
      }
    }
    return record;
  }

  static async release(materialId: string, ownerRef: string): Promise<MaterialRecord> {
    const record = await this.get(materialId, ownerRef);
    if (record.status === 'released') return record;
    const { staging } = await roots();
    const directory = path.join(staging, materialId);
    await fs.unlink(path.join(directory, record.name)).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
    const { record_digest: _oldDigest, ...oldCore } = record;
    const core: Omit<MaterialRecord, 'record_digest'> = {
      ...oldCore, status: 'released', released_at: new Date().toISOString(),
    };
    const released = { ...core, record_digest: recordDigest(core) };
    await writeRecord(directory, released);
    return released;
  }
}
