import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Storage } from '@google-cloud/storage';
import { PDFParse } from 'pdf-parse';
import { Artifact } from '../api/schemas/runtime_schemas';
import { getRuntimeRepository } from './runtime_repository';

const storage = new Storage();
const maxBytes = Number(process.env.MAX_ARTIFACT_BYTES ?? 20 * 1024 * 1024);
const maxContextChars = Number(process.env.MAX_CONTEXT_CHARS ?? 250_000);

function backend(): string {
  return process.env.RUNTIME_BACKEND ?? (process.env.NODE_ENV === 'production' ? 'cloud' : 'local');
}

function parseGsUri(uri: string): { bucket: string; object: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error('Cloud artifacts must use gs:// URIs');
  return { bucket: match[1], object: match[2] };
}

function allowedBuckets(): Set<string> {
  return new Set((process.env.ALLOWED_INPUT_BUCKETS ?? '').split(',').map(value => value.trim()).filter(Boolean));
}

async function localFile(artifact: Artifact): Promise<Buffer> {
  if (!artifact.uri.startsWith('file://')) throw new Error('Local artifacts must use file:// URIs');
  const configuredRoot = path.resolve(process.env.LOCAL_INPUT_ROOT ?? process.cwd());
  const [root, candidate] = await Promise.all([
    fs.realpath(configuredRoot),
    fs.realpath(fileURLToPath(artifact.uri)),
  ]);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    if (candidate !== root) throw new Error('Artifact is outside LOCAL_INPUT_ROOT');
  }
  const stat = await fs.stat(candidate);
  if (!stat.isFile() || !stat.size || stat.size > maxBytes) {
    throw new Error(`Artifact size must be between 1 and ${maxBytes} bytes`);
  }
  if (artifact.size_bytes && artifact.size_bytes !== stat.size) throw new Error('Artifact size mismatch');
  return fs.readFile(candidate);
}

async function extract(buffer: Buffer, artifact: Artifact): Promise<string> {
  if (buffer.length > maxBytes) throw new Error(`Artifact size must be between 1 and ${maxBytes} bytes`);
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (artifact.sha256 && artifact.sha256.toLowerCase() !== digest) throw new Error('Artifact hash mismatch');
  if (artifact.mime_type === 'application/pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      return (await parser.getText()).text.slice(0, maxContextChars);
    } finally {
      await parser.destroy();
    }
  }
  return buffer.toString('utf8', 0, maxContextChars);
}

export class ArtifactStore {
  static async readArtifact(artifact: Artifact): Promise<string> {
    if (backend() === 'local') return extract(await localFile(artifact), artifact);
    const { bucket, object } = parseGsUri(artifact.uri);
    const allowed = allowedBuckets();
    if (allowed.size && !allowed.has(bucket)) throw new Error(`Bucket ${bucket} is not allowed`);
    const file = storage.bucket(bucket).file(object);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    if (!size || size > maxBytes) throw new Error(`Artifact size must be between 1 and ${maxBytes} bytes`);
    if (artifact.size_bytes && artifact.size_bytes !== size) throw new Error('Artifact size mismatch');
    const [buffer] = await file.download();
    const detected = metadata.contentType?.split(';')[0];
    if (detected && detected !== artifact.mime_type) throw new Error(`Artifact MIME mismatch: ${detected}`);
    return extract(buffer, artifact);
  }

  static async saveGeneratedArtifact(requestId: string, type: string, name: string,
    mimeType: Artifact['mime_type'], content: string): Promise<Artifact> {
    const id = `art_${randomUUID()}`;
    const bytes = Buffer.from(content);
    let uri: string;
    if (backend() === 'local') {
      const target = path.resolve(process.env.LOCAL_DATA_DIR ?? '.ego-runtime', 'artifacts', requestId, id, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { mode: 0o600 });
      uri = pathToFileURL(target).href;
    } else {
      const bucket = process.env.OUTPUT_BUCKET;
      if (!bucket) throw new Error('OUTPUT_BUCKET is required');
      const object = `${requestId}/${id}/${name}`;
      await storage.bucket(bucket).file(object).save(bytes, { resumable: false, contentType: mimeType });
      uri = `gs://${bucket}/${object}`;
    }
    const artifact: Artifact = { id, name, mime_type: mimeType, uri,
      sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length };
    await getRuntimeRepository().saveArtifact(artifact, requestId, type);
    return artifact;
  }
}
