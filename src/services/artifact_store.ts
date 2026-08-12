import { createHash, randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { PDFParse } from 'pdf-parse';
import { Artifact } from '../api/schemas/runtime_schemas';
import { getFirestore, COLLECTIONS } from './firestore';

const storage = new Storage();
const maxBytes = Number(process.env.MAX_ARTIFACT_BYTES ?? 20 * 1024 * 1024);
const maxContextChars = Number(process.env.MAX_CONTEXT_CHARS ?? 250_000);

function parseGsUri(uri: string): { bucket: string; object: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new Error('Artifacts must use gs:// URIs');
  return { bucket: match[1], object: match[2] };
}
function allowedBuckets(): Set<string> {
  return new Set((process.env.ALLOWED_INPUT_BUCKETS ?? '').split(',').map(v => v.trim()).filter(Boolean));
}

export class ArtifactStore {
  static async readArtifact(artifact: Artifact): Promise<string> {
    const { bucket, object } = parseGsUri(artifact.uri);
    const allowed = allowedBuckets();
    if (allowed.size && !allowed.has(bucket)) throw new Error(`Bucket ${bucket} is not allowed`);
    const file = storage.bucket(bucket).file(object);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);
    if (!size || size > maxBytes) throw new Error(`Artifact size must be between 1 and ${maxBytes} bytes`);
    if (artifact.size_bytes && artifact.size_bytes !== size) throw new Error('Artifact size mismatch');
    const [buffer] = await file.download();
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (artifact.sha256 && artifact.sha256.toLowerCase() !== digest) throw new Error('Artifact hash mismatch');
    const detected = metadata.contentType?.split(';')[0];
    if (detected && detected !== artifact.mime_type) throw new Error(`Artifact MIME mismatch: ${detected}`);
    if (artifact.mime_type === 'application/pdf') {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try { return (await parser.getText()).text.slice(0, maxContextChars); }
      finally { await parser.destroy(); }
    }
    return buffer.toString('utf8', 0, maxContextChars);
  }

  static async saveGeneratedArtifact(requestId: string, type: string, name: string, mimeType: Artifact['mime_type'], content: string): Promise<Artifact> {
    const bucket = process.env.OUTPUT_BUCKET;
    if (!bucket) throw new Error('OUTPUT_BUCKET is required');
    const id = `art_${randomUUID()}`;
    const object = `${requestId}/${id}/${name}`;
    const bytes = Buffer.from(content);
    await storage.bucket(bucket).file(object).save(bytes, { resumable: false, contentType: mimeType });
    const artifact: Artifact = { id, name, mime_type: mimeType, uri: `gs://${bucket}/${object}`,
      sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length };
    await getFirestore().collection(COLLECTIONS.ARTIFACTS).doc(id).create({
      ...artifact, request_id: requestId, type, created_at: new Date().toISOString(),
    });
    return artifact;
  }
}
