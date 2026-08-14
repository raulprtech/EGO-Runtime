import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeManifest } from '../src/runtime/manifest';
import {
  getNigmaAdapterPolicy,
  setNigmaAdapterPolicyForTests,
} from '../src/runtime/nigma_handoff';

describe('Nigma runtime-owned policy file', () => {
  let directory = '';

  afterEach(async () => {
    delete process.env.NIGMA_HANDOFF_ENABLED;
    delete process.env.NIGMA_ADAPTER_POLICY_FILE;
    setNigmaAdapterPolicyForTests(undefined);
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    directory = '';
  });

  it('loads an exact local policy only when the integration is enabled', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ego-nigma-policy-'));
    const fixture = JSON.parse(await fs.readFile(
      new URL('./fixtures/nigma-handoff-v1.json', import.meta.url), 'utf8',
    )) as { ego_policy: unknown };
    const file = path.join(directory, 'policy.json');
    await fs.writeFile(file, JSON.stringify(fixture.ego_policy));
    process.env.NIGMA_HANDOFF_ENABLED = 'true';
    process.env.NIGMA_ADAPTER_POLICY_FILE = file;

    await expect(getNigmaAdapterPolicy()).resolves.toMatchObject({
      runtime_id: 'ego-runtime', runtime_version: '0.7.0',
    });
    expect(createRuntimeManifest().integrations.nigma).toEqual({
      protocol: 'nigma.runtime-handoff/v1', supported: true, configured: true,
    });
  });

  it('does not expose a configured integration from a policy path alone', async () => {
    process.env.NIGMA_ADAPTER_POLICY_FILE = '/not/read/while/disabled.json';
    expect(createRuntimeManifest().integrations.nigma.configured).toBe(false);
    await expect(getNigmaAdapterPolicy()).rejects.toMatchObject({
      code: 'NIGMA_HANDOFF_DISABLED', status: 404,
    });
  });
});
