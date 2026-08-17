import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../src/services/artifact_store';

const DOCX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('DOCX artifact extraction', () => {
  let directory = '';
  let oldRoot: string | undefined;
  let oldBackend: string | undefined;

  beforeEach(async () => {
    oldRoot = process.env.LOCAL_INPUT_ROOT;
    oldBackend = process.env.RUNTIME_BACKEND;
    directory = await fs.mkdtemp('/tmp/ego-docx-');
    process.env.LOCAL_INPUT_ROOT = directory;
    process.env.RUNTIME_BACKEND = 'local';
  });

  afterEach(async () => {
    if (oldRoot === undefined) delete process.env.LOCAL_INPUT_ROOT;
    else process.env.LOCAL_INPUT_ROOT = oldRoot;
    if (oldBackend === undefined) delete process.env.RUNTIME_BACKEND;
    else process.env.RUNTIME_BACKEND = oldBackend;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('extracts text from a synthetic local DOCX', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`);
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>Aprendizaje espaciado y recuperación activa.</w:t></w:r></w:p></w:body>
      </w:document>`);
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const target = path.join(directory, 'lesson.docx');
    await fs.writeFile(target, bytes);

    const text = await ArtifactStore.readArtifact({
      id: 'docx-test', name: 'lesson.docx', mime_type: DOCX_MEDIA_TYPE,
      uri: pathToFileURL(target).href,
      sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length,
    });

    expect(text).toContain('Aprendizaje espaciado');
    expect(text).toContain('recuperación activa');
  });
});
